let mysqlconnector =require('mysql2/promise')
require('dotenv').config()

let con=mysqlconnector.createPool({
    host:process.env.DBHOST,
    user:process.env.DBUSER,
    port:process.env.DBPORT,
    database:process.env.DBNAME,
    waitForConnections:true,
    queueLimit:0,


})


module.exports=con