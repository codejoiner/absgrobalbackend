

let axios= require('axios')

let dotenv=require('dotenv')
const { pool } = require('../conn/connection')
const con = require('../conn/connection')
dotenv.config()
const cron=require('node-cron')
const credituser=require('../credituser/credituser')
let {poolDeposit,processWithdraw,truncateResetPasswordTable}=require('../subcontroller/subcontroller')

const APIKEY=process.env.NOWPAYAPIKEY




let RequestAddress = async (req, res) => {
  try {
    const { uid } = req.user;
 
    const response = await axios.post(
      `${process.env.NOWPAYMENTURL}/v1/payment`,
      {
        price_amount: 1,
        price_currency: 'usd',
        pay_currency: "usdtbsc",
        order_id: uid.toString()
      },
      {
        headers: { 
          "x-api-key": APIKEY, 
          "Content-Type": "application/json"
        }
      }
    );

    const { payment_id, pay_address } = response.data;

    if (payment_id && pay_address) {
      await pool.execute(
        `INSERT INTO pending_wallets(userid, paymentid, pendingwallets) VALUES (?,?,?)`,
        [uid, payment_id, pay_address]
      );
      return res.status(200).json({ address: pay_address });
    } else {
      return res.status(500).json({ message: "Payment API did not return an address" });
    }

  } catch (e) {
    if (e.code === 'ECONNABORTED') {
      return res.status(504).json({ message: "Request timed out, please try again" });
    }
    console.log('Error in RequestAddress Controller', e.response?.data?.message || e.message);
    return res.status(500).json({ message:"something went wrong" });
  }
};



const Purchaseproduct = async (req, res) => {
  if (!req.user?.uid) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { uid, invcode } = req.user;
  let conn;

  try {
    conn = await con.getConnection();
    await conn.beginTransaction();

    const { title, costestmented, daily, term, total } = req.body;
    const amount = Number(costestmented);
     
    const [lockpurchase] = await conn.execute(
  `SELECT id FROM projects WHERE userid=? AND price=? LIMIT 1 FOR UPDATE`,
  [uid, amount]
);
    if(lockpurchase.length===1) {
       await conn.rollback();
    return res.status(400).json({message:'already purchased'})

    }
    

    if (!amount || amount <= 0) {
      await conn.rollback();
      return res.status(400).json({ message: "Invalid amount" });
    }

    const [balanceRows] = await conn.execute(
      "SELECT amount FROM userbalance WHERE userid=? FOR UPDATE",
      [uid]
    );

    if (!balanceRows.length || balanceRows[0].amount < amount) {
      await conn.rollback();
      return res.status(400).json({ message: "Insufficient balance" });
    }

    await conn.execute(
      `UPDATE userbalance SET amount = amount - ? WHERE userid=?`,
      [amount, uid]
    );

    const startdate = new Date();
    const enddate = new Date();
    enddate.setDate(startdate.getDate() + Number(term));
    const lastcrediteddate = startdate.toISOString().slice(0,10);

    await conn.execute(
      `INSERT INTO projects(
        userid, title, price, starteddate, enddate, dailyprofit, totalprofit, lastcrediteddate
      ) VALUES (?,?,?,?,?,?,?,?)`,
      [uid, title, amount, startdate, enddate, daily, total, lastcrediteddate]
    );

    if (invcode) {
      const [existingPurchases] = await conn.execute(
        `SELECT COUNT(*) as count FROM projects WHERE userid=? AND title=?`,
        [uid, title]
      );

      if (existingPurchases[0].count === 1) {
        const [invitorRows] = await conn.execute(
          `SELECT userid, invitorcode FROM users WHERE uniquereffcode=?`,
          [invcode]
        );

        if (!invitorRows.length) {
       await conn.commit();

           return res.status(200).json({
          message: "Purchase completed successfully." 

      });
        }

        const directInviterId = invitorRows[0].userid;
        const directCommission = amount * 0.12;

        await credituser(directInviterId, directCommission, conn);
        await conn.execute(
          `INSERT INTO commission(userid, commissions) VALUES (?,?)`,
          [directInviterId, directCommission]
        );

        const parentCode = invitorRows[0].invitorcode;
        console.log(parentCode)
        if (parentCode) {
          const [parentRows] = await conn.execute(
            `SELECT userid FROM users WHERE uniquereffcode=?`,
            [parentCode]
          );

          if (parentRows.length) {
            const parentId = parentRows[0].userid;
            const parentCommission = amount * 0.05;

            await credituser(parentId, parentCommission, conn);
            await conn.execute(
              `INSERT INTO commission(userid, commissions) VALUES (?,?)`,
              [parentId, parentCommission]
            );
          }
        }
      }
    }

    await conn.commit();

    return res.status(200).json({
       message: "Purchase completed successfully."
    });

  } catch (e) {
    if (conn) await conn.rollback();
    console.log("Purchase error:", e);
    return res.status(500).json({ message: "Something went wrong" });
  } finally {
    if (conn) conn.release();
  }
};








const dailyEarnTracker = async () => {
  try {

    const today = new Date();

    const [projects] = await con.execute(
      `SELECT * FROM projects WHERE status=?`,
      ['Running']
    );

    for (let project of projects) {

      let conn;

      try {

        conn = await con.getConnection();
        await conn.beginTransaction();

        const {
          id,
          userid,
          dailyprofit,
          enddate,
          lastcrediteddate,
          starteddate,
          status,
          totalearned
        } = project;

        const startDate = starteddate ? new Date(starteddate) : null;
        const lastCreditDate = lastcrediteddate
          ? new Date(lastcrediteddate)
          : startDate;

        const endDate = enddate ? new Date(enddate) : null;

        let effectiveEnd;

        if (endDate && endDate < today) {

          effectiveEnd = endDate;

          if (status !== 'closed') {
            await conn.execute(
              `UPDATE projects SET status=? WHERE id=?`,
              ['closed', id]
            );
          }

        } else {
          effectiveEnd = today;
        }

        const msPerDay = 86400000;

        const missedDays = Math.floor(
          (effectiveEnd.getTime() - lastCreditDate.getTime()) / msPerDay
        );

        if (missedDays <= 0) {
          await conn.rollback();
          conn.release();
          continue;
        }

        const totalEarnings = Number(dailyprofit) * missedDays;
        const livetotalearned = Number(totalearned) + totalEarnings;

        await credituser(userid, totalEarnings, conn);

        await conn.execute(
          `UPDATE projects 
           SET lastcrediteddate=?, totalearned=? 
           WHERE id=?`,
          [effectiveEnd, livetotalearned, id]
        );

        await conn.execute(
          `INSERT INTO profits(userid, profits) VALUES (?,?)`,
          [userid, totalEarnings]
        );

        await conn.commit();

      } catch (err) {

        if (conn) await conn.rollback();
        console.log("Daily tracker project error:", err);

      } finally {

        if (conn) conn.release();
      }
    }

  } catch (e) {

    console.log("Error in daily earn tracker:", e);
  }
};






let History=async(req,res)=>{  
  if(!req.user||!req.user.uid) return false
   let {uid}=req.user
  
 try{

const [result] = await con.execute(`
SELECT userid, withdrawedamount as amount,'withdraw' AS type, created_at FROM withdrawrequest WHERE userid=?
  UNION ALL 
  SELECT userid, deposedamount as amount, 'deposit' AS type, created_at FROM deposits WHERE userid=? 
  UNION ALL SELECT userid, profits as amount, 'profit' AS type, created_at FROM profits WHERE userid=?
  UNION ALL 
   SELECT userid, commissions as amount, 'commission' AS type, created_at FROM commission WHERE userid=?
  ORDER BY created_at ASC
`, [uid, uid, uid, uid]);


       if(result.length===0){
        return res.status(404).json({message:"Live operation not available"})
       }
     
       return res.status(200).json(result)
   
 }
 catch(e){
  console.log('Error in History controller',e.message)
  return res.status(500).json({message:"server Error"})
 }
}



let Asset=async(req,res)=>{
  if(!req.user||!req.user.uid)return false
   let {uid}=req.user

   console.log(uid)

  try{

    const [result]=await con .execute(`SELECT userid,title,dailyprofit,totalprofit,price,
       status,totalearned FROM projects WHERE userid=?`,[uid]) 

       if(result.length===0){
        return res.status(404).json({message:"No active projects"})
       }

       return res.status(200).json(result)


  }
  catch(e){
    console.log('error in Asset controllers')
    return res.status(500).json({message:'something went wrong'})
  }
}


const dashinfo = async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { uid } = req.user;

  try {
    const [result] = await con.execute(`
      SELECT 
        u.userid,
        COALESCE(b.amount, 0.00) AS balance,
        COALESCE(p.total_earned, 0) AS total_earned,
        COALESCE(p.total_price, 0) AS total_price,
        COALESCE(p.total_projects, 0) AS total_projects
      FROM users u
      LEFT JOIN userbalance b 
        ON u.userid = b.userid
      LEFT JOIN (
          SELECT 
            userid,
            SUM(totalearned) AS total_earned,
            SUM(price) AS total_price,
            COUNT(id) AS total_projects
          FROM projects
          WHERE status = 'Running'
          GROUP BY userid
      ) p 
        ON u.userid = p.userid
      WHERE u.userid = ?
    `, [uid]);

    return res.status(200).json({
      success: true,
      response: result[0] || {}
    });

  } catch (e) {
    console.log("Error in dashinfo controller:", e.message);
    return res.status(500).json({
      success: false,
      message: "Something went wrong"
    });
  }
};

let Team= async(req,res)=>{
  if(!req.user||!req.user.uid) return res.status(401).json({message:'unauthorized'}) 
  let {uid,uniquecode}=req.user
  try{
   const [response]=await con.execute(`SELECT
     (SELECT COALESCE(SUM(commissions),0) FROM commission WHERE userid = ?) AS total_commission, 
     (SELECT COUNT(*) FROM users WHERE invitorcode =?) AS total_invited_users`,[uid,uniquecode])

     return res.status(200).json({data:response[0]})
    


  }
  catch(err){
    return res.status(500).json({message:"something went wrong"})
  }
}







cron.schedule('0 0 * * *',async()=>{
  await dailyEarnTracker()
  await truncateResetPasswordTable()
  console.log('excuted')
},{
  timezone:"africa/kigali"
})

cron.schedule('*/30 * * * * *',async()=>{
    await poolDeposit()
  await processWithdraw()
},{
  timezone:"africa/kigali"

})

module.exports={
    RequestAddress,
    Purchaseproduct,
    History,Asset,dashinfo,Team
    
}