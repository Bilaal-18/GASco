const mongoose = require('mongoose');
const paymentSchema = new mongoose.Schema({
    booking:{type:mongoose.Schema.Types.ObjectId, ref : 'booking'},
    amount:{type:Number, required: true},
    method:{type:String,enum:["cash","upi"],required:true},
    status:{type:String,enum:["pending","completed","failed"],default:"pending"},
    transactionID:{type:String}
},{timestamps:true});

const payment = mongoose.model('payment', paymentSchema);
module.exports= payment;