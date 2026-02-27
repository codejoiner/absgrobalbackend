  let dotenv= require('dotenv')
  dotenv.config()
  let con =require('../conn/connection')
  let cron =require('node-cron')
  let axios= require('axios')
  let credituser= require('../credituser/credituser')
const { HttpsProxyAgent } = require('https-proxy-agent');
 const crypto = require("crypto");
 let bcrypt=require('bcrypt')
 let transporter= require('../mailconfig/BrevoMail')
 let speakeasy=require('speakeasy')


const poolDeposit = async () => {
  let conn; 
  try {
    conn = await con.getConnection();

    const [pendingWallets] = await conn.execute(
      'SELECT paymentid FROM pending_wallets'
    );

    if (!pendingWallets.length) return;

    for (const w of pendingWallets) {
      try {
        const response = await axios.get(
          `${process.env.NOWPAYMENTURL}/v1/payment/${w.paymentid}`,
          {
            headers: {
              "x-api-key": process.env.NOWPAYAPIKEY
            }
          }
        );

        if (!response?.data) continue;

        const status = response.data.payment_status?.toLowerCase();
        if (status !== 'finished') continue;

        const userid = response.data.order_id;
        const amount = Number(response.data.actually_paid);
        const providerPaymentId = response.data.payment_id;

        const [existing] = await conn.execute(
          'SELECT id FROM deposits WHERE paymentid=? LIMIT 1',
          [providerPaymentId]
        );

        if (existing.length) {
          await conn.execute(
            'DELETE FROM pending_wallets WHERE paymentid=?',
            [providerPaymentId]
          );
          continue;
        }

        await conn.beginTransaction();

        const [result] = await conn.execute(
          `INSERT INTO deposits
           (userid, deposedamount, status, paymentid, credited)
           VALUES (?,?,?,?,?)`,
          [userid, amount, status, providerPaymentId, 0]
        );

        await credituser(userid, amount, conn);

        await conn.execute(
          'UPDATE deposits SET credited=1 WHERE id=?',
          [result.insertId]
        );

        await conn.execute(
          'DELETE FROM pending_wallets WHERE paymentid=?',
          [providerPaymentId]
        );

        await conn.commit();

      } catch (err) {
        if (conn) await conn.rollback();
        console.error("Payment processing error:", err.message);
      }
    }

  } catch (err) {
    console.error("Pool deposit fatal error:", err.message);
  } finally {
    if (conn) conn.release();   }
};



let Withdraw = async (req, res) => {

  if (!req.user || !req.user.uid) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { uid } = req.user;
  let connection;

  try {

    connection = await con.getConnection();

    const {amountalongsidefees, withdrawaddress } = req.body;
   console.log(amountalongsidefees)
    if (!amountalongsidefees || !withdrawaddress) {
      return res.status(400).json({ message: "Fill out all fields" });
    }

    const withdrawedamount = Number(amountalongsidefees);

    if (isNaN(withdrawedamount) || withdrawedamount < 1) {
      return res.status(400).json({ message: "Minimum withdraw is 1 USD" });
    }

    const addressRegex = /^[a-zA-Z0-9 ]+$/;
    if (!addressRegex.test(withdrawaddress)) {
      return res.status(400).json({
        message: "Address should not contain special characters"
      });
    }

    await connection.beginTransaction();

    const [updateResult] = await connection.execute(
      `UPDATE userbalance
       SET amount = amount - ?
       WHERE userid = ? AND amount >= ?`,
      [withdrawedamount, uid, withdrawedamount]
    );

    if (updateResult.affectedRows === 0) {
      await connection.rollback();
      return res.status(400).json({ message: "Insufficient balance" });
    }

    await connection.execute(
      `INSERT INTO withdrawrequest (userid, withdrawedamount, wallets)
       VALUES (?,?,?)`,
      [uid, withdrawedamount, withdrawaddress]
    );

    await connection.commit();

    return res.status(200).json({
      message: "Withdraw Initiated, will be processed soon"
    });

  } catch (err) {

    if (connection) await connection.rollback();

    console.log("Withdraw error:", err.message);

    return res.status(500).json({
      message: "Something went wrong"
    });

  } finally {

    if (connection) connection.release();

  }
};
let isProcessing = false;

const processWithdraw = async () => {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const API_KEY = process.env.NOWPAYAPIKEY;
    const BASEURL = process.env.NOWPAYMENTURL;
    const Email = process.env.NOWPAYMENTEMAIL;
    const Password = process.env.NOWPAYMENTPASSWORD;
    const proxyUrl = process.env.WEBSHAREPROXYURL;
    const TOTP_SECRET = process.env.NOWPAYMENTS_2FA_SECRET;
    const currency = "usdtbsc";

    const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

    const axiosConfig = {
      httpsAgent: agent,
      proxy: false,
      headers: { 
        'x-api-key': API_KEY, 
        'Content-Type': 'application/json' 
      }
    };

    const [pending] = await con.execute(`
      SELECT id, userid, withdrawedamount, wallets 
      FROM withdrawrequest 
      WHERE status='pending'
      LIMIT 20
    `);

    if (!pending || pending.length === 0) {
      isProcessing = false;
      return;
    }

    const authRes = await axios.post(`${BASEURL}/v1/auth`, { 
      email: Email, 
      password: Password 
    }, axiosConfig);
    
    const jwtToken = authRes.data.token;
    const authHeader = { 
      ...axiosConfig.headers, 
      'Authorization': `Bearer ${jwtToken}` 
    };

    let balanceRes = await axios.get(`${BASEURL}/v1/balance`, { 
      headers: authHeader, 
      httpsAgent: agent,
      proxy: false 
    });

    let myBalance = balanceRes.data[currency]?.amount || 0;
   console.log(myBalance)
    for (const req of pending) {
      try {
        const amountToPay = parseFloat(req.withdrawedamount);
        if (myBalance < amountToPay) continue;


        const [updateRes] = await con.execute(
          `UPDATE withdrawrequest SET status='processing' WHERE id=? AND status='pending'`,
          [req.id]
        );

        if (updateRes.affectedRows === 0) continue;

        const payoutRes = await axios.post(
          `${BASEURL}/v1/payout`,
          { 
            withdrawals: [
              { address: req.wallets, currency: currency, amount: amountToPay }
            ] 
          },
          { ...axiosConfig, headers: authHeader }
        );

        const payoutId = payoutRes.data.id;
        const batchId = payoutRes.data.withdrawals?.[0]?.batch_withdrawal_id;

        await con.execute(
          `UPDATE withdrawrequest SET batchwithdrawId=?, payoutid=? WHERE id=?`,
          [batchId, payoutId, req.id]
        );

        const code2fa = speakeasy.totp({
          secret: TOTP_SECRET,
          encoding: 'base32'
        });

        const verifyRes = await axios.post(
          `${BASEURL}/v1/payout/${payoutId}/verify`,
          { verification_code: code2fa },
          { ...axiosConfig, headers: authHeader }
        );

        const statusFromResponse = verifyRes.data.status || "FAILED";

        if (statusFromResponse === "VERIFIED") {

          const payoutStatusRes = await axios.get(
            `${BASEURL}/v1/payout/${payoutId}`,
            { ...axiosConfig, headers: authHeader }
          );

          const finalStatus = payoutStatusRes.data.status;

          if (finalStatus === "FINISHED") {

            await con.execute(
              `UPDATE withdrawrequest SET status='finished' WHERE batchwithdrawId=?`,
              [batchId]
            );

            myBalance -= amountToPay;

          }

        } else {

          await con.execute(
            `UPDATE withdrawrequest SET status='pending' WHERE id=?`,
            [req.id]
          );

          console.error(`Verification failed for withdraw id ${req.id}, status: ${statusFromResponse}`);
        }

      } catch (err) {
        console.error(err.response?.data || err.message);
        await con.execute(
          `UPDATE withdrawrequest SET status='pending' WHERE id=?`,
          [req.id]
        );
      }
    }

  } catch (err) {
    console.error(err.response?.data || err.message);
  } finally {
    isProcessing = false;
  }
};



const ResetEmail = async (req, res) => {
  const { email } = req.body;

  try {
    const connection = await con.getConnection();

    const emailregexp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailregexp.test(email)) {
      return res.status(400).json({ message: "Invalid email" });
    }

    const [user] = await connection.execute(
      `SELECT userid FROM users WHERE email = ?`,
      [email.trim()]
    );

    if (user.length === 0) {
      return res.status(403).json({ message: "Invalid email!" });
    }

    const uid = user[0].userid;

    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM resetpassword
       WHERE userid = ?
       AND expire_at > NOW()`,
      [uid]
    );

    if (rows[0].count>= 3) {
      return res.status(409).json({message: "Maximum reset requests reached. Try again later.",
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    await connection.query(
      `INSERT INTO resetpassword(userid, email, token, expire_at)
       VALUES (?, ?, ?, NOW() + INTERVAL 15 MINUTE)`,
      [uid, email, hashedToken]
    );

    const resetLink = `https://absgrobal.online/reset/${hashedToken}`;
    

    const emailStatus = await transporter({
      to: email.trim(),
      subject: "ABSGROBAL RECOVERY LINK",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd;">
          <h2>ABSGROBAL RESET PASSWORD</h2>
          <p>You requested a password reset. Click the button below:</p>
          <a href="${resetLink}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
          <p>This link will expire in 15 minutes.</p>
          <p>If you didn't request this, ignore this email.</p>
        </div>
      `,
      text: `Reset your password here: ${resetLink}`

    });

    if (emailStatus.success) {
      return res.status(200).json({ message: "Password reset email sent" });
    } else {
      return res.status(500).json({ message: "Failed to send email", error: emailStatus.error });
    }

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};


const ReceivetokenANDReset = async (req, res) => {
  let connection;

  try {
    const { token, password } = req.body;


    if (!token || !password) {
      return res.status(400).json({ message: "Password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    connection = await con.getConnection();

  

    const [rows] = await connection.execute(`
      SELECT userid
      FROM resetpassword
      WHERE token = ?
      AND used = 0
      AND expire_at > NOW()
      LIMIT 1
    `, [token]);

    if (rows.length===0) {
      connection.release();
      return res.status(400).json({ message: "Invalid or expired reset link" });
    }

    const userid = rows[0].userid;
    const hashedPassword = await bcrypt.hash(password, 10);

    await connection.beginTransaction();

    await connection.execute(`UPDATE users SET password = ? WHERE userid = ?`, [hashedPassword, userid]);
    await connection.execute(`UPDATE resetpassword SET used = 1 WHERE token = ?`, [token]);

    await connection.commit();
    connection.release();

    return res.json({ message: "Password reset successful" });

  } catch (err) {
    console.error(err.message);

    if (connection) {
      await connection.rollback().catch(() => {});
      connection.release();
    }

    return res.status(500).json({ message: "Something went wrong" });
  }
};



const truncateResetPasswordTable = async () => {
  let connection;

  try {
    connection = await con.getConnection();

    await connection.execute(`TRUNCATE TABLE resetpassword`);

    connection.release();

    console.log("resetpassword table truncated successfully");
    return true;
  } catch (err) {
    if (connection) connection.release();
    console.error("Error truncating resetpassword table:", err.message);
    return false;
  }
};

  





  module.exports={
    Withdraw,poolDeposit
    ,processWithdraw,ResetEmail,ReceivetokenANDReset,truncateResetPasswordTable
  }






