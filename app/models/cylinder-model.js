const mongoose = require("mongoose");

const cylinderSchema = new mongoose.Schema(
  {
    cylinderName:{
      type:String,
      enum:["Bharath","HP"],
      required:true
    },
    cylinderType:{
      type: String,
       enum: ["commercial","private Commercial"],
        required: true 
      },
    weight:{
      type: Number,
      required: true
    },
    price:{
      type: Number,
       required: true 
      },
    available: {
       type: Boolean,
        default:true 
       },
  },
  { timestamps: true }
);

module.exports = mongoose.model("cylinder", cylinderSchema);
