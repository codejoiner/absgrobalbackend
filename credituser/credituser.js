const con = require('../conn/connection');

const credituser = async (userid, amount, conn = null) => {

  const db = conn || con; 

  try {

    const creditAmount = Number(amount);

    if (!creditAmount || creditAmount <= 0) {
      throw new Error("Invalid credit amount");
    }

    const [rows] = await db.execute(
      "SELECT amount FROM userbalance WHERE userid=? FOR UPDATE",
      [userid]
    );

    if (rows.length === 0) {

      await db.execute(
        `INSERT INTO userbalance(userid, amount)
         VALUES (?, ?)`,
        [userid, creditAmount]
      );

    } else {

      await db.execute(
        `UPDATE userbalance 
         SET amount = amount + ?
         WHERE userid = ?`,
        [creditAmount, userid]
      );
    }

  } catch (error) {

    console.log(`Error crediting user ${userid}:`, error.message);
    throw error; 
  }
};

module.exports = credituser;
