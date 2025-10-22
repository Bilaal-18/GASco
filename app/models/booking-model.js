const mongoose = require('mongoose');
const bookingSchema = new mongoose.Schema({
    customer:{type:mongoose.Schema.Types.ObjectId, ref :"user", required:true},
    agent:{type:mongoose.Schema.Types.ObjectId, ref :"user", required: true},
    cylinder:{type:mongoose.Schema.Types.ObjectId,ref :"cylinder", required:true},
    quantity:{type:Number,required:true,min:1},
    status:{
        type:String,
        enum:["pending","confirmed","delivered","cancelled"],
        default:"pending"
    },
    deliveryDate:Date
},{timestamps:true});

const booking = mongoose.model('booking', bookingSchema);
module.exports=booking;