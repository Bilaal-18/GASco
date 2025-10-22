const mongoose = require('mongoose');
const bookingSchema = new mongoose.model({
    customer:{type:mongoose.Schema.Types.ObjectId, ref :"user", required:true},
    distirbutor:{type:mongoose.Schema.Types.ObjectId, ref :"distributor", required: true},
    cylinder:{type:mongoose.Schema.Types.ObjectId,ref :"cylinder", required:true},
    quantity:{type:Number,required:true},
    status:{
        type:String,
        enum:["pending","confirmed","delivered","cancelled"],
        default:"pending"
    },
    deliveryDate:Date
},{timestamps:true});

const booking = mongoose.model('booking', bookingSchema);
module.exports=booking;