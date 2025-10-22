const { required } = require("joi");
const mongoose = require("mongoose");

const agentStockSchema = new mongoose.Schema(
  {
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    cylinderId: { type: mongoose.Schema.Types.ObjectId,ref:"cylinder", required: true },
    quantity: { type: Number, default: 0,required:true },
    lastUpdated: { type: Date, default: Date.now() },
  },
  { timestamps: true }
);

module.exports = mongoose.model("agentStock", agentStockSchema);
