const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    paymentType: {
        type: String,
        enum: ['customer', 'agent'],
        required: true,
    },
    customer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
    },
    agent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
    },
    admin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
    },
    booking: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'booking',
    },
    stockIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'agentStock',
    }],
    amount: {
        type: Number,
        required: true,
        min: 0,
    },
    method: {
        type: String,
        enum: ['cash', 'online', 'upi'],
        required: true,
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded', 'partial'],
        default: 'pending',
    },
    transactionID: {
        type: String,
        required: true,
    },
    paymentDate: {
        type: Date,
        default: Date.now,
    },
    description: {
        type: String,
    },
    notes: {
        type: String,
    },
    onlinePaid: {
        type: Number,
        default: 0,
    },
    cashPaid: {
        type: Number,
        default: 0,
    },
    totalDue: {
        type: Number,
        default: 0,
    },
    remainingCash: {
        type: Number,
        default: 0,
    }
}, {
    timestamps: true
});

paymentSchema.index({ customer: 1, paymentType: 1 });
paymentSchema.index({ agent: 1, paymentType: 1 });
paymentSchema.index({ booking: 1 });
paymentSchema.index({ transactionID: 1 });

const payment = mongoose.model('payment', paymentSchema);
module.exports = payment;
