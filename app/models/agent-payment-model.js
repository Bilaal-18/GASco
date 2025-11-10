const mongoose = require('mongoose');

const agentPaymentSchema = new mongoose.Schema(
  {
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user',
      required: true,
    },

    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user',
      required: true,
    },

    /**
     * ✅ Final amount recorded in this entry.
     * For online: amount = onlinePaid
     * For cash: amount = cashPaid
     */
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    /**
     * ✅ Payment method
     */
    method: {
      type: String,
      enum: ['cash', 'online'],
      required: true,
    },

    /**
     * ✅ Payment status
     * - partial → online paid, cash pending
     * - paid → both online + cash completed
     * - completed → single payment mode successful
     */
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'partial', 'paid'],
      default: 'pending',
    },

    description: {
      type: String,
      default: 'Payment to admin',
    },

    /**
     * ✅ Online payment tracking
     */
    onlinePaid: {
      type: Number,
      default: 0,
    },

    /**
     * ✅ Cash tracking after online payment
     */
    cashPaid: {
      type: Number,
      default: 0,
    },

    /**
     * ✅ Total amount due (stock amount)
     */
    totalDue: {
      type: Number,
      default: 0,
    },

    /**
     * ✅ Remaining cash pending after online payment
     */
    remainingCash: {
      type: Number,
      default: 0,
    },

    /**
     * ✅ Razorpay IDs for online payments
     */
    razorpayOrderId: {
      type: String,
    },

    razorpayPaymentId: {
      type: String,
    },

    razorpaySignature: {
      type: String,
    },

    transactionID: {
      type: String,
    },

    paymentDate: {
      type: Date,
      default: Date.now,
    },

    notes: {
      type: String,
    },

    /**
     * ✅ Stocks that this payment covers
     */
    stockIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'agentStock',
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('AgentPayment', agentPaymentSchema);
