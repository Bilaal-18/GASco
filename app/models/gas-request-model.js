const mongoose = require('mongoose');

const gasRequestSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user",
    required: true
  },
  cylinderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "cylinder",
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending"
  },
  remarks: {
    type: String,
    default: ""
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  reviewedAt: {
    type: Date
  }
}, { timestamps: true });

module.exports = mongoose.model("gasRequest", gasRequestSchema);

