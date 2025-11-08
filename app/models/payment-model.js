const mongoose = require('mongoose');
const paymentSchema = new mongoose.Schema({
    booking:{type:mongoose.Schema.Types.ObjectId, ref : 'booking', required: true},
    customer:{type:mongoose.Schema.Types.ObjectId, ref : 'user', required: true},
    agent:{type:mongoose.Schema.Types.ObjectId, ref : 'user'},
    amount:{type:Number, required: true},
    method:{type:String,enum:["cash","online"],required:true},
    status:{type:String,enum:["pending","completed","failed","refunded"],default:"pending"},
    razorpayOrderId:{type:String},
    razorpayPaymentId:{type:String},
    razorpaySignature:{type:String},
    transactionID:{type:String},
    paymentDate:{type:Date}
},{timestamps:true});

const payment = mongoose.model('payment', paymentSchema);
module.exports= payment;