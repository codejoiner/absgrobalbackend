const jwt=require('jsonwebtoken')
const bcrypt=require('bcrypt')
require('dotenv').config()
let crypto =require('crypto')

const con=require('../conn/connection')




let Login = async (req, res) => {
    try {
        const { mobile, password } = req.body;

        if (!mobile || !password) {
            return res.status(400).json({ message: 'input required' });
        }

        const mobilenum = Number(mobile);

        if (isNaN(mobilenum)) {
            return res.status(400).json({ message: 'Invalid mobile number' });
        }

        let [cred] = await con.execute(
            `SELECT * FROM users WHERE mobile=?`,
            [mobilenum]
        );

        if (cred.length === 0) {
            return res.status(401).json({ message: 'invalid credentials try again' });
        }


        let ismatch = await bcrypt.compare(password, cred[0].password);

        if (!ismatch) {
            return res.status(401).json({ message: "invalid credentials try again" });
        }
        let user= cred[0]
       
        const token= jwt.sign({uid:user.userid,
            uniquecode:user.uniquereffcode,
            mobile:user.mobile,invcode:user.invitorcode},
            process.env.JWT_SECRET,{expiresIn:'2h'})
           
            return res.status(201).json({tkn:token})
         

    } catch (e) {
        console.log('Error in Login controller', e.message);
        return res.status(500).json({ message: "Login failed try again" });
    }
};



function generateReferralCode() {
    return "USD" + crypto.randomBytes(2).toString("hex").toUpperCase();
}

let Register = async (req, res) => {

    try {
        const {email, mobile, password,reffcode } = req.body;

        if (!email || !mobile || !password) {
            return res.status(400).json({ message: "Please fill out all fields" });
        }

       
        const [existingUser] = await con.execute(
            "SELECT email, mobile FROM users WHERE email=? OR mobile=?",
            [email, mobile]
        );

        if (existingUser.length > 0) {

            if (existingUser[0].email === email) {
                return res.status(409).json({
                    message: "Email already taken try again"
                });
            }

            if (existingUser[0].mobile === mobile) {
                return res.status(409).json({
                    message: "Phone number already taken try again"
                });
            }
        }

       let salt= await bcrypt.genSalt(10)
        const hashedPassword = await bcrypt.hash(password, salt);

       
        const referralCode = generateReferralCode();

        const [result] = await con.execute(
            `INSERT INTO users (email, mobile, password, uniquereffcode,invitorcode)
             VALUES (?, ?, ?, ?,?)`,
            [email, mobile, hashedPassword, referralCode,reffcode]
        );
    if(result.affectedRows===1){
          return res.status(201).json({
            message: "your account already created Login now",
        });
    }
        

    } catch (e) {
        console.log("Error in Register:", e.message);
        return res.status(500).json({
            message: "Something went wrong, try again"
        });
    }
};




module.exports = {
    Login,
    Register
};
