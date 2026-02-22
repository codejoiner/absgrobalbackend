

let express=require('express')
let router= express.Router()


let {RequestAddress,Purchaseproduct,History, Asset, dashinfo,Team}= require('../mainController/controllers')
let {Login,Register}=require('../subcontroller/user')
let authMiddleware=require('../subcontroller/authmiddleware')
let {Withdraw,ResetEmail,ReceivetokenANDReset}=require('../subcontroller/subcontroller')



router.post('/address',authMiddleware,RequestAddress)
router.post('/purchase',authMiddleware,Purchaseproduct)
router.get('/history',authMiddleware,History)
router.get('/asset',authMiddleware,Asset)
router.get('/dashin-info', authMiddleware,dashinfo)
router.post('/Withdraw',authMiddleware,Withdraw)
router.get('/Team-data',authMiddleware,Team)
router.post('/forgot-password',ResetEmail)
router.put('/reset-password',ReceivetokenANDReset)
router.post('/login',Login)
router.post('/register',Register)





module.exports=router