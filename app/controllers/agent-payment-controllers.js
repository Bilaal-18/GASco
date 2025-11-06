const AgentPayment = require('../models/agent-payment-model');
const AgentStock = require('../models/agent-stock-model');
const User = require('../models/user-model');

const agentPaymentCtrl = {};

// Get Razorpay instance
const getRazorpayInstance = () => {
  try {
    const Razorpay = require('razorpay');
    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

    if (!keyId || !keySecret) {
      console.warn('Razorpay credentials not configured');
      return null;
    }

    return new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  } catch (error) {
    console.error('Error initializing Razorpay:', error);
    return null;
  }
};

//! -------------------- CREATE RAZORPAY ORDER FOR AGENT PAYMENT -------------------- //
agentPaymentCtrl.createRazorpayOrder = async (req, res) => {
  try {
    const { amount, description } = req.body;
    const agentId = req.UserId;
    const userRole = req.role;

    if (userRole !== 'agent') {
      return res.status(403).json({ error: 'Only agents can make payments to admin' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    // Get admin user
    const admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const razorpay = getRazorpayInstance();
    if (!razorpay) {
      return res.status(500).json({ error: 'Payment gateway not configured' });
    }

    const orderAmount = Math.round(amount * 100); // Convert to paise
    const receipt = `AGENT_${agentId}_${Date.now()}`.substring(0, 40);

    const order = await razorpay.orders.create({
      amount: orderAmount,
      currency: 'INR',
      receipt: receipt,
      notes: {
        agentId: agentId.toString(),
        adminId: admin._id.toString(),
        description: description || 'Agent payment to admin'
      }
    });

    res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt
    });
  } catch (error) {
    console.error('Razorpay order creation error:', error);
    res.status(500).json({ 
      error: 'Failed to create payment order',
      details: error.message 
    });
  }
};

//! -------------------- VERIFY RAZORPAY PAYMENT -------------------- //
agentPaymentCtrl.verifyPayment = async (req, res) => {
  try {
    const { orderId, paymentId, signature, amount, description, notes } = req.body;
    const agentId = req.UserId;
    const userRole = req.role;

    if (userRole !== 'agent') {
      return res.status(403).json({ error: 'Only agents can make payments to admin' });
    }

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ error: 'Payment verification data is required' });
    }

    // Get admin user
    const admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    // Verify signature
    const crypto = require('crypto');
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    if (generatedSignature !== signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    // Find unpaid stock items
    const unpaidStocks = await AgentStock.find({ 
      agentId: agentId,
      paymentStatus: 'pending'
    }).sort({ assignedDate: 1 });

    const stockIds = [];
    let remainingAmount = amount;
    
    // Allocate payment to stock items
    for (const stock of unpaidStocks) {
      if (remainingAmount <= 0) break;
      
      if (remainingAmount >= stock.totalAmount) {
        stock.paymentStatus = 'paid';
        stockIds.push(stock._id);
        remainingAmount -= stock.totalAmount;
        await stock.save();
      } else {
        // Partial payment - for now, we'll mark as paid if amount matches exactly
        if (remainingAmount === stock.totalAmount) {
          stock.paymentStatus = 'paid';
          stockIds.push(stock._id);
          remainingAmount = 0;
          await stock.save();
        }
      }
    }

    // Create payment record
    const agentPayment = new AgentPayment({
      agent: agentId,
      admin: admin._id,
      amount: amount,
      method: 'razorpay',
      status: 'completed',
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
      transactionID: paymentId,
      paymentDate: new Date(),
      description: description || 'Razorpay payment to admin',
      notes: notes,
      stockIds: stockIds
    });

    await agentPayment.save();

    res.status(200).json({
      message: 'Payment verified and recorded successfully',
      payment: agentPayment
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ 
      error: 'Failed to verify payment',
      details: error.message 
    });
  }
};

//! -------------------- CREATE CASH PAYMENT -------------------- //
agentPaymentCtrl.createCashPayment = async (req, res) => {
  try {
    const { amount, description, notes } = req.body;
    const agentId = req.UserId;
    const userRole = req.role;

    if (userRole !== 'agent') {
      return res.status(403).json({ error: 'Only agents can make payments to admin' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    // Get admin user
    const admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    // Find unpaid stock items
    const unpaidStocks = await AgentStock.find({ 
      agentId: agentId,
      paymentStatus: 'pending'
    }).sort({ assignedDate: 1 });

    const stockIds = [];
    let remainingAmount = amount;
    
    // Allocate payment to stock items
    for (const stock of unpaidStocks) {
      if (remainingAmount <= 0) break;
      
      if (remainingAmount >= stock.totalAmount) {
        stock.paymentStatus = 'paid';
        stockIds.push(stock._id);
        remainingAmount -= stock.totalAmount;
        await stock.save();
      } else {
        if (remainingAmount === stock.totalAmount) {
          stock.paymentStatus = 'paid';
          stockIds.push(stock._id);
          remainingAmount = 0;
          await stock.save();
        }
      }
    }

    // Create cash payment record
    const agentPayment = new AgentPayment({
      agent: agentId,
      admin: admin._id,
      amount: amount,
      method: 'cash',
      status: 'completed',
      paymentDate: new Date(),
      description: description || 'Cash payment to admin',
      notes: notes,
      transactionID: `CASH_${agentId}_${Date.now()}`,
      stockIds: stockIds
    });

    await agentPayment.save();

    res.status(200).json({
      message: 'Cash payment recorded successfully',
      payment: agentPayment
    });
  } catch (error) {
    console.error('Cash payment error:', error);
    res.status(500).json({ 
      error: 'Failed to record cash payment',
      details: error.message 
    });
  }
};

//! -------------------- GET AGENT PAYMENT HISTORY -------------------- //
agentPaymentCtrl.getAgentPaymentHistory = async (req, res) => {
  try {
    const agentId = req.UserId;
    const userRole = req.role;

    if (userRole !== 'agent') {
      return res.status(403).json({ error: 'Only agents can view their payment history' });
    }

    const payments = await AgentPayment.find({ agent: agentId })
      .populate('admin', 'username email')
      .sort({ createdAt: -1 });

    // Calculate amount owed from stock received
    const stocks = await AgentStock.find({ agentId })
      .populate('cylinderId', 'price cylinderName cylinderType');
    
    // Calculate total amount from all stock
    const totalStockAmount = stocks.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
    
    // Calculate unpaid stock amount
    const unpaidStockAmount = stocks
      .filter(s => s.paymentStatus === 'pending')
      .reduce((sum, s) => sum + (s.totalAmount || 0), 0);
    
    // Calculate paid stock amount
    const paidStockAmount = stocks
      .filter(s => s.paymentStatus === 'paid')
      .reduce((sum, s) => sum + (s.totalAmount || 0), 0);

    res.status(200).json({
      payments: payments,
      totalPayments: payments.length,
      totalAmount: payments.reduce((sum, p) => sum + (p.amount || 0), 0),
      stockInfo: {
        totalStockAmount: totalStockAmount,
        unpaidStockAmount: unpaidStockAmount,
        paidStockAmount: paidStockAmount,
        unpaidStocks: stocks.filter(s => s.paymentStatus === 'pending'),
      },
    });
  } catch (error) {
    console.error('Error fetching agent payment history:', error);
    res.status(500).json({ 
      error: 'Failed to fetch payment history',
      details: error.message 
    });
  }
};

//! -------------------- GET ALL AGENT PAYMENTS (ADMIN) -------------------- //
agentPaymentCtrl.getAllAgentPayments = async (req, res) => {
  try {
    const userRole = req.role;

    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Only admin can view all agent payments' });
    }

    const payments = await AgentPayment.find()
      .populate('agent', 'agentname username email phoneNo')
      .populate('admin', 'username email')
      .populate('stockIds')
      .sort({ createdAt: -1 });

    const summary = {
      total: payments.length,
      completed: payments.filter(p => p.status === 'completed').length,
      pending: payments.filter(p => p.status === 'pending').length,
      totalAmount: payments.reduce((sum, p) => sum + (p.amount || 0), 0),
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

//! -------------------- GET AGENT PAYMENT STATS (ADMIN) -------------------- //
agentPaymentCtrl.getAgentPaymentStats = async (req, res) => {
  try {
    const { agentId } = req.params;
    const userRole = req.role;

    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Only admin can view agent payment statistics' });
    }

    // Get agent stock information
    const stocks = await AgentStock.find({ agentId })
      .populate('cylinderId', 'price cylinderName cylinderType');
    
    // Calculate total amount from all stock
    const totalStockAmount = stocks.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
    
    // Calculate unpaid stock amount
    const unpaidStockAmount = stocks
      .filter(s => s.paymentStatus === 'pending')
      .reduce((sum, s) => sum + (s.totalAmount || 0), 0);
    
    // Calculate paid stock amount
    const paidStockAmount = stocks
      .filter(s => s.paymentStatus === 'paid')
      .reduce((sum, s) => sum + (s.totalAmount || 0), 0);

    // Get agent payments
    const payments = await AgentPayment.find({ agent: agentId })
      .populate('agent', 'username email phoneNo')
      .populate('admin', 'username email');

    const paymentInfo = {
      totalPayments: payments.length,
      totalAmountPaid: payments
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + (p.amount || 0), 0),
      completedPayments: payments.filter(p => p.status === 'completed').length,
      pendingPayments: payments.filter(p => p.status === 'pending').length,
    };

    res.status(200).json({
      stockInfo: {
        totalStockAmount: totalStockAmount,
        unpaidStockAmount: unpaidStockAmount,
        paidStockAmount: paidStockAmount,
        totalStockItems: stocks.length,
        paidStockItems: stocks.filter(s => s.paymentStatus === 'paid').length,
        unpaidStockItems: stocks.filter(s => s.paymentStatus === 'pending').length,
      },
      paymentInfo: paymentInfo
    });
  } catch (error) {
    console.error('Error fetching agent payment stats:', error);
    res.status(500).json({ 
      error: 'Failed to fetch agent payment statistics',
      details: error.message 
    });
  }
};

module.exports = agentPaymentCtrl;

