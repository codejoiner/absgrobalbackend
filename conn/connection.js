let mysqlconnector =require('mysql2/promise')
require('dotenv').config()
const  fs= require('fs')

let con=mysqlconnector.createPool({
    host:process.env.DBHOST,
    user:process.env.DBUSER,
    port:process.env.DBPORT,
    password:process.env.DBPW,
    database:process.env.DBNAME,
    waitForConnections:true,
    queueLimit:0,
    //  ssl:{
    //     rejectUnauthorized:true,
    //      ca:fs.readFileSync('conn/sslca/ca.pem')
    //   },
    //     typeCast:function(field,next){
    //         if(field.type==='DATE'){
    //             return field.string()
    //         }
    //         return next()
    //     }


})


module.exports=con