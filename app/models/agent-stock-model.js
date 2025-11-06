const { required } = require("joi");
const mongoose = require("mongoose");
const { type } = require("os");

const agentStockSchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true
    },
    cylinderId:{
      type: mongoose.Schema.Types.ObjectId,
      ref:"cylinder",
      required: true
    },
    quantity:{
       type: Number,
        default: 0,
        required:true
      },
    totalAmount:{
      type:Number,
      required:true,
      min:[0],
      default:0
    },
    returnedQuantity:{
      type: Number,
      default: 0
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid"],
      default: "pending",
    },
    assignedDate: {
      type: Date,
      default: Date.now,
    },
    period: {
      type: String,
      enum: ["daily", "monthly"],
      default: "daily"
    },
    lastUpdated: { type: Date, default: Date.now() },
  },
  { timestamps: true }
);

module.exports = mongoose.model("agentStock", agentStockSchema);
