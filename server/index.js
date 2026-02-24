 require('dotenv').config()
let express= require('express')
let approutes=require('../appRoutes/routes')
const morgan= require('morgan')
const con= require('../conn/connection')

const cors=require('cors')
const app=express()


app.use(cors())
app.use(express.json())
app.use(morgan('dev'))


app.use('/',approutes)

const Server=app.listen(process.env.APPPORT,(error)=>{
    if(!error){
        console.log(`server running on ${process.env.APPPORT}`)
    }
})


const shutdowngracefull= async(error)=>{
   console.log('server shutdown due to un Expected Error  ',error.message)
   Server.close(()=>{
    con.end()
   })

   process.exit(0)
}

process.on('uncaughtException',shutdowngracefull);
process.on('unhandledRejection', shutdowngracefull);

module.exports=app;

