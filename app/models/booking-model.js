const mongoose = require('mongoose');
const bookingSchema = new mongoose.Schema({
    customer:{
        type:mongoose.Schema.Types.ObjectId,
         ref :"user",
          required:true
        },
    agent:{
        type:mongoose.Schema.Types.ObjectId,
         ref :"user",
          required: true
        },
    cylinder:{
        type:mongoose.Schema.Types.ObjectId,
        ref :"cylinder", 
        required:true
    },
    quantity:{
        type:Number,
        required:true,
        min:1
    },
    status:{
        type:String,
        enum:["pending","confirmed","delivered","cancelled"],
        default:"pending"
    },
     paymentStatus: { 
        type: String,
         enum: ["pending", "paid"], 
         default: "pending" 
        },
    paymentMethod: {
        type: String,
        enum: ["online", "cash"],
        default: "cash"
    },
    deliveryDate: {
        type: Date,
        required: false
    },
    isReturned:{
         type:Boolean,
         default:false
         },
    createdAt:{
        type:Date,
        default:Date.now()
    }
},{timestamps:true});

const booking = mongoose.model('booking', bookingSchema);
module.exports=booking;