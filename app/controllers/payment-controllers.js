const Razorpay = require("razorpay");
const crypto = require("crypto");
const Payment = require("../models/payment-model");
const Booking = require("../models/booking-model");
const AgentStock = require("../models/agent-stock-model");
const User = require("../models/user-model");
require("dotenv").config();

// Initialize Razorpay instance
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const paymentController = {};

//! -------------------- CREATE RAZORPAY ORDER -------------------- //
// Works for both customer and agent payments
paymentController.createRazorpayOrder = async (req, res) => {
    console.log("Payment creation endpoint hit");
    try {
        const { amount, bookingId, paymentType, description } = req.body;
        const userId = req.UserId;
        const userRole = req.role;
        
        console.log("Request body:", { amount, bookingId, paymentType, userRole });

        if (!amount) {
            return res.status(400).json({ error: "Missing required fields: amount" });
        }

        // Ensure amount is positive
        if (amount <= 0) {
            return res.status(400).json({ error: "Amount must be greater than zero" });
        }

        // Determine payment type from role if not provided
        let finalPaymentType = paymentType;
        if (!finalPaymentType) {
            if (userRole === 'agent') {
                finalPaymentType = 'agent';
            } else if (userRole === 'customer') {
                finalPaymentType = 'customer';
            } else {
                return res.status(400).json({ error: "Payment type must be specified" });
            }
        }

        // Validate bookingId for customer payments
        if (finalPaymentType === 'customer' && !bookingId) {
            return res.status(400).json({ error: "Booking ID is required for customer payments" });
        }

        console.log("Creating Razorpay Order...");

        const order = await razorpay.orders.create({
            amount: amount * 100, // Convert to paise
            currency: "INR",
            receipt: `receipt_${Date.now()}_${finalPaymentType}`,
        });

        console.log("Razorpay Order Response:", order);

        if (!order || !order.id) {
            console.error("Error: Order ID is missing in the Razorpay response");
            return res.status(500).json({
                error: "Failed to create Razorpay order. Order ID is missing",
            });
        }

        console.log("Order ID:", order.id);

        res.json({
            orderId: order.id,
            key: process.env.RAZORPAY_KEY_ID,
            amount: order.amount,
            currency: order.currency,
        });
    } catch (err) {
        console.error("Error creating payment order:", err);
        res.status(500).json({ error: "Failed to create payment order" });
    }
};

//! -------------------- VERIFY RAZORPAY PAYMENT -------------------- //
// Works for both customer and agent payments
paymentController.verifyPayment = async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            bookingId,
            paymentType,
            amount,
            totalDue, // For agent payments
            description,
        } = req.body;

        const userId = req.UserId;
        const userRole = req.role;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ error: "Missing payment verification data" });
        }

        // Verify signature
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                error: "Payment verification failed - Invalid signature",
            });
        }

        // Determine payment type
        let finalPaymentType = paymentType;
        if (!finalPaymentType) {
            if (userRole === 'agent') {
                finalPaymentType = 'agent';
            } else if (userRole === 'customer') {
                finalPaymentType = 'customer';
            }
        }

        // Create payment record (only store transaction ID and amount, not Razorpay details)
        const paymentData = {
            paymentType: finalPaymentType,
            amount: Number(amount) || 0,
            method: 'online',
            status: 'completed',
            transactionID: razorpay_payment_id, // Use Razorpay payment ID as transaction ID
            paymentDate: new Date(),
            description: description || `Online payment via Razorpay`,
        };

        if (finalPaymentType === 'customer') {
            // Customer payment
            if (!bookingId) {
                return res.status(400).json({ error: "Booking ID is required for customer payments" });
            }

            const booking = await Booking.findById(bookingId);
            if (!booking) {
                return res.status(404).json({ error: "Booking not found" });
            }

            paymentData.customer = userId;
            paymentData.booking = bookingId;
            paymentData.agent = booking.agent || null;

            // Update booking payment status
            booking.paymentStatus = 'paid';
            await booking.save();

        } else if (finalPaymentType === 'agent') {
            // Agent payment to admin
            const admin = await User.findOne({ role: 'admin' });
            if (!admin) {
                return res.status(404).json({ error: "Admin not found" });
            }

            paymentData.agent = userId;
            paymentData.admin = admin._id;
            paymentData.onlinePaid = Number(amount) || 0;
            paymentData.cashPaid = 0;
            
            // Calculate total due if not provided
            let calculatedTotalDue = Number(totalDue) || 0;
            if (!totalDue || calculatedTotalDue === 0) {
                const unpaidStocks = await AgentStock.find({
                    agentId: userId,
                    paymentStatus: 'pending'
                });
                calculatedTotalDue = unpaidStocks.reduce((sum, stock) => sum + (stock.totalAmount || 0), 0);
            }
            
            paymentData.totalDue = calculatedTotalDue;
            paymentData.remainingCash = Math.max(0, calculatedTotalDue - (Number(amount) || 0));

            // Update agent stock payment status
            const unpaidStocks = await AgentStock.find({
                agentId: userId,
                paymentStatus: 'pending'
            }).sort({ assignedDate: 1 });

            const stockIds = [];
            let remainingAmount = Number(amount) || 0;

            for (const stock of unpaidStocks) {
                if (remainingAmount <= 0) break;
                const stockAmount = parseFloat(stock.totalAmount || 0);
                if (remainingAmount >= stockAmount) {
                    stock.paymentStatus = 'paid';
                    stockIds.push(stock._id);
                    remainingAmount -= stockAmount;
                    await stock.save();
                }
            }

            paymentData.stockIds = stockIds;
            paymentData.status = remainingAmount >= 0 && stockIds.length === unpaidStocks.length ? 'completed' : 'partial';
        }

        const payment = new Payment(paymentData);
        await payment.save();

        // Populate payment data
        const populatedPayment = await Payment.findById(payment._id)
            .populate('customer', 'username email phoneNo')
            .populate('agent', 'agentname username email phoneNo')
            .populate('admin', 'username email')
            .populate('booking')
            .populate('stockIds');

        res.json({
            success: true,
            message: "Payment verified successfully",
            payment: populatedPayment,
        });
    } catch (err) {
        console.error("Error verifying payment:", err);
        res.status(500).json({ 
            success: false, 
            error: "Failed to verify payment",
            message: err.message 
        });
    }
};

//! -------------------- CREATE CASH PAYMENT -------------------- //
paymentController.createCashPayment = async (req, res) => {
    try {
        const { amount, bookingId, paymentType, description, notes, totalDue } = req.body;
        const userId = req.UserId;
        const userRole = req.role;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: "Valid amount is required" });
        }

        // Determine payment type
        let finalPaymentType = paymentType;
        if (!finalPaymentType) {
            if (userRole === 'agent') {
                finalPaymentType = 'agent';
            } else if (userRole === 'customer') {
                finalPaymentType = 'customer';
            }
        }

        const paymentData = {
            paymentType: finalPaymentType,
            amount: Number(amount),
            method: 'cash',
            status: 'completed',
            transactionID: `CASH_${userId}_${Date.now()}`,
            paymentDate: new Date(),
            description: description || 'Cash payment',
            notes: notes,
        };

        if (finalPaymentType === 'customer') {
            if (!bookingId) {
                return res.status(400).json({ error: "Booking ID is required for customer payments" });
            }

            const booking = await Booking.findById(bookingId);
            if (!booking) {
                return res.status(404).json({ error: "Booking not found" });
            }

            paymentData.customer = userId;
            paymentData.booking = bookingId;
            paymentData.agent = booking.agent || null;

            booking.paymentStatus = 'paid';
            await booking.save();

        } else if (finalPaymentType === 'agent') {
            const admin = await User.findOne({ role: 'admin' });
            if (!admin) {
                return res.status(404).json({ error: "Admin not found" });
            }

            paymentData.agent = userId;
            paymentData.admin = admin._id;
            paymentData.cashPaid = Number(amount);
            paymentData.onlinePaid = 0;
            paymentData.totalDue = Number(totalDue) || 0;
            paymentData.remainingCash = Math.max(0, (Number(totalDue) || 0) - Number(amount));

            // Update agent stock payment status
            const unpaidStocks = await AgentStock.find({
                agentId: userId,
                paymentStatus: 'pending'
            }).sort({ assignedDate: 1 });

            const stockIds = [];
            let remainingAmount = Number(amount);

            for (const stock of unpaidStocks) {
                if (remainingAmount <= 0) break;
                const stockAmount = parseFloat(stock.totalAmount || 0);
                if (remainingAmount >= stockAmount) {
                    stock.paymentStatus = 'paid';
                    stockIds.push(stock._id);
                    remainingAmount -= stockAmount;
                    await stock.save();
                }
            }

            paymentData.stockIds = stockIds;
            paymentData.status = remainingAmount >= 0 && stockIds.length === unpaidStocks.length ? 'completed' : 'partial';
        }

        const payment = new Payment(paymentData);
        await payment.save();

        const populatedPayment = await Payment.findById(payment._id)
            .populate('customer', 'username email phoneNo')
            .populate('agent', 'agentname username email phoneNo')
            .populate('admin', 'username email')
            .populate('booking')
            .populate('stockIds');

        res.status(201).json({
            message: "Cash payment recorded successfully",
            payment: populatedPayment,
        });
    } catch (err) {
        console.error("Error creating cash payment:", err);
        res.status(500).json({ error: "Failed to record cash payment", message: err.message });
    }
};

//! -------------------- GET PAYMENT HISTORY -------------------- //
paymentController.getPaymentHistory = async (req, res) => {
    try {
        const userId = req.UserId;
        const userRole = req.role;
        const { paymentType } = req.query;

        let query = {};

        if (userRole === 'customer') {
            query = { customer: userId, paymentType: 'customer' };
        } else if (userRole === 'agent') {
            // Agent can see both their payments to admin and customer payments they processed
            if (paymentType === 'agent') {
                query = { agent: userId, paymentType: 'agent' };
            } else if (paymentType === 'customer') {
                query = { agent: userId, paymentType: 'customer' };
            } else {
                query = { $or: [
                    { agent: userId, paymentType: 'agent' },
                    { agent: userId, paymentType: 'customer' }
                ]};
            }
        } else if (userRole === 'admin') {
            // Admin can see all payments
            if (paymentType) {
                query = { paymentType };
            }
        }

        const payments = await Payment.find(query)
            .populate('customer', 'username email phoneNo')
            .populate('agent', 'agentname username email phoneNo')
            .populate('admin', 'username email')
            .populate('booking')
            .populate('stockIds')
            .sort({ createdAt: -1 });

        // For agent payments, include stock info
        let stockInfo = null;
        if (userRole === 'agent' && paymentType === 'agent') {
            const stocks = await AgentStock.find({ agentId: userId })
                .populate('cylinderId', 'price cylinderName cylinderType');
            
            const totalStockAmount = stocks.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
            const unpaidStockAmount = stocks
                .filter(s => s.paymentStatus === 'pending')
                .reduce((sum, s) => sum + (s.totalAmount || 0), 0);
            const paidStockAmount = stocks
                .filter(s => s.paymentStatus === 'paid')
                .reduce((sum, s) => sum + (s.totalAmount || 0), 0);
            
            stockInfo = {
                totalStockAmount,
                unpaidStockAmount,
                paidStockAmount,
                unpaidStocks: stocks.filter(s => s.paymentStatus === 'pending'),
            };
        }

        const response = {
            payments: payments,
            count: payments.length
        };

        if (stockInfo) {
            response.stockInfo = stockInfo;
        }

        res.json(response);
    } catch (err) {
        console.error("Error fetching payment history:", err);
        res.status(500).json({ error: "Failed to fetch payment history", message: err.message });
    }
};

//! -------------------- GET PAYMENT BY ID -------------------- //
paymentController.getPaymentById = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.UserId;
        const userRole = req.role;

        const payment = await Payment.findById(id)
            .populate('customer', 'username email phoneNo')
            .populate('agent', 'agentname username email phoneNo')
            .populate('admin', 'username email')
            .populate('booking')
            .populate('stockIds');

        if (!payment) {
            return res.status(404).json({ error: "Payment not found" });
        }

        // Check authorization
        if (userRole === 'customer' && payment.customer?._id?.toString() !== userId) {
            return res.status(403).json({ error: "Unauthorized access" });
        }
        if (userRole === 'agent' && payment.agent?._id?.toString() !== userId && payment.customer?._id?.toString() !== userId) {
            return res.status(403).json({ error: "Unauthorized access" });
        }

        res.json(payment);
    } catch (err) {
        console.error("Error fetching payment:", err);
        res.status(500).json({ error: "Failed to fetch payment", message: err.message });
    }
};

//! -------------------- GET ALL AGENT PAYMENTS (ADMIN) -------------------- //
paymentController.getAllAgentPayments = async (req, res) => {
    try {
        const userRole = req.role;
        
        if (userRole !== 'admin') {
            return res.status(403).json({ error: 'Only admin can view all agent payments' });
        }
        
        const payments = await Payment.find({ paymentType: 'agent' })
            .populate('agent', 'agentname username email phoneNo')
            .populate('admin', 'username email')
            .populate('stockIds')
            .sort({ createdAt: -1 });

        const totalAmountReceived = payments.reduce((sum, p) => {
            if (p.status === 'pending' || p.status === 'failed') {
                return sum;
            }
            
            const onlinePaid = Number(p.onlinePaid || 0);
            const cashPaid = Number(p.cashPaid || 0);
            const hasPartialFields = onlinePaid > 0 || cashPaid > 0;
            
            if (hasPartialFields) {
                return sum + onlinePaid + cashPaid;
            } else {
                return sum + (Number(p.amount || 0));
            }
        }, 0);

        const summary = {
            total: payments.length,
            completed: payments.filter(p => p.status === 'completed' || p.status === 'paid').length,
            pending: payments.filter(p => p.status === 'pending').length,
            partial: payments.filter(p => p.status === 'partial').length,
            totalAmount: totalAmountReceived,
            pendingAmount: payments
                .filter(p => p.status === 'pending')
                .reduce((sum, p) => sum + (p.amount || 0), 0),
        };
        
        res.status(200).json({
            payments: payments,
            summary: summary
        });
    } catch (error) {
        console.error('Error fetching all agent payments:', error);
        res.status(500).json({
            error: 'Failed to fetch agent payments',
            details: error.message
        });
    }
};

//! -------------------- CREATE CASH PAYMENT BY ADMIN -------------------- //
paymentController.createCashPaymentByAdmin = async (req, res) => {
    try {
        const { agentId, amount, description, notes } = req.body;
        const userRole = req.role;
        const adminId = req.UserId;

        if (userRole !== 'admin') {
            return res.status(403).json({ error: 'Only admin can create cash payments for agents' });
        }

        if (!agentId || !amount || amount <= 0) {
            return res.status(400).json({ error: 'Valid agent ID and amount are required' });
        }

        const agent = await User.findById(agentId);
        if (!agent || agent.role !== 'agent') {
            return res.status(404).json({ error: 'Agent not found' });
        }

        const unpaidStocks = await AgentStock.find({
            agentId: agentId,
            paymentStatus: 'pending'
        }).sort({ assignedDate: 1 });

        const stockIds = [];
        let remainingAmount = Number(amount);
        const totalStockAmount = unpaidStocks.reduce((sum, stock) => sum + (stock.totalAmount || 0), 0);

        for (const stock of unpaidStocks) {
            if (remainingAmount <= 0) break;
            
            const stockAmount = parseFloat(stock.totalAmount || 0);
            
            if (remainingAmount >= stockAmount) {
                stock.paymentStatus = 'paid';
                stockIds.push(stock._id);
                remainingAmount -= stockAmount;
                await stock.save();
            } else {
                if (Math.abs(remainingAmount - stockAmount) < 0.01) {
                    stock.paymentStatus = 'paid';
                    stockIds.push(stock._id);
                    remainingAmount = 0;
                    await stock.save();
                }
            }
        }

        const paymentStatus = remainingAmount >= 0 && stockIds.length === unpaidStocks.length ? 'completed' : 'completed';
        const totalDue = totalStockAmount;
        const remainingCash = Math.max(0, totalDue - amount);

        const paymentData = {
            paymentType: 'agent',
            agent: agentId,
            admin: adminId,
            amount: Number(amount),
            cashPaid: Number(amount),
            onlinePaid: 0,
            totalDue: totalDue,
            remainingCash: remainingCash,
            method: 'cash',
            status: paymentStatus,
            paymentDate: new Date(),
            description: description || 'Cash payment recorded by admin',
            notes: notes,
            transactionID: `CASH_ADMIN_${agentId}_${Date.now()}`,
            stockIds: stockIds
        };
        
        const payment = new Payment(paymentData);
        await payment.save();

        const populatedPayment = await Payment.findById(payment._id)
            .populate("agent", "agentname email phoneNo")
            .populate("admin", "username email");

        res.status(200).json({
            message: 'Cash payment recorded successfully',
            payment: populatedPayment
        });
    } catch (error) {
        console.error('Admin cash payment error:', error);
        res.status(500).json({
            error: 'Failed to record cash payment',
            details: error.message
        });
    }
};

//! -------------------- UPDATE CASH PAID BY ADMIN -------------------- //
paymentController.updateCashPaid = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const { cashPaid } = req.body;
        const userRole = req.role;

        if (userRole !== 'admin') {
            return res.status(403).json({ error: 'Only admin can update cash paid amount' });
        }

        if (!cashPaid || cashPaid < 0) {
            return res.status(400).json({ error: 'Valid cash paid amount is required' });
        }

        const payment = await Payment.findById(paymentId);
        if (!payment) {
            return res.status(404).json({ error: 'Payment record not found' });
        }
        if (payment.status !== 'partial' && payment.method !== 'online') {
            return res.status(400).json({ error: 'Can only update cash paid for partial online payments' });
        }

        const totalCashPaid = Number(cashPaid);
        const onlinePaid = Number(payment.onlinePaid || 0);
        const totalDue = Number(payment.totalDue || 0);
        const totalPaid = onlinePaid + totalCashPaid;

        const remainingCash = totalDue - onlinePaid;
        if (totalCashPaid > remainingCash) {
            return res.status(400).json({
                error: `Cash paid (₹${totalCashPaid}) cannot exceed remaining amount (₹${remainingCash})`
            });
        }
        payment.cashPaid = totalCashPaid;
        payment.remainingCash = remainingCash - totalCashPaid;
        
        if (totalPaid >= totalDue) {
            payment.status = 'completed';
            payment.amount = totalPaid;
        } else {
            payment.status = 'partial';
            payment.amount = onlinePaid;
        }

        await payment.save();

        if (payment.status === 'completed' && payment.stockIds && payment.stockIds.length > 0) {
            await AgentStock.updateMany(
                { _id: { $in: payment.stockIds } },
                { paymentStatus: 'paid' }
            );
        }

        const populatedPayment = await Payment.findById(payment._id)
            .populate('agent', 'agentname email phoneNo')
            .populate('admin', 'username email');

        res.status(200).json({
            message: 'Cash paid amount updated successfully',
            payment: populatedPayment,
        });
    } catch (error) {
        console.error('Error updating cash paid amount:', error);
        res.status(500).json({
            error: 'Failed to update cash paid amount',
            details: error.message
        });
    }
};

module.exports = paymentController;
