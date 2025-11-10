const AgentPayment = require('../models/agent-payment-model'); 
const AgentStock = require('../models/agent-stock-model');      
const User = require('../models/user-model');                   
const Razorpay = require('razorpay');

const agentPaymentCtrl = {};

//! <--------------------CHECK RAZORPAY--------------------> !\\

const getRazorpayInstance = () => {
  try {
    const keyId = process.env.RAZORPAY_KEY_ID?.trim();         
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    
    if (!keyId || !keySecret) {
      console.warn('Razorpay credentials not configured'); 
      return null;
    }
    
    return new Razorpay({
      key_id: keyId,    
      key_secret: keySecret
    });
  } catch (error) {
    console.error('Error initializing Razorpay:', error);
    return null;
  }
};

//! <--------------------CREATE ORDER--------------------> !\\

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
    
    const admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    
    const razorpay = getRazorpayInstance();
    if (!razorpay) {
      return res.status(500).json({ error: 'Payment gateway not configured' });
    }
    
    // Razorpay minimum amount is 1 INR = 100 paise
    const orderAmount = Math.round(Math.max(amount, 1) * 100);
    
    if (orderAmount < 100) {
      return res.status(400).json({ error: 'Payment amount must be at least ₹1' });
    }
    
    const receipt = `AGENT_${agentId}_${Date.now()}`.substring(0, 40);
    
    let razorpayOrder;
    try {
      razorpayOrder = await razorpay.orders.create({
        amount: orderAmount,      
        currency: 'INR',          
        receipt: receipt,         
        notes: {                 
          agentId: agentId.toString(),
          adminId: admin._id.toString(),
          description: description || 'Agent payment to admin'
        }
      });
    } catch (razorpayError) {
      console.error('Razorpay order creation error:', {
        error: razorpayError.message,
        errorDescription: razorpayError.error?.description,
        errorCode: razorpayError.error?.code,
        statusCode: razorpayError.statusCode,
        agentId: agentId,
        amount: orderAmount,
        amountInRupees: amount
      });
      
      let errorMessage = 'Failed to create payment order. Please try again.';
      let errorCode = 'PAYMENT_ERROR';
      
      // Handle specific Razorpay errors
      if (razorpayError.error?.description) {
        errorMessage = razorpayError.error.description;
      } else if (razorpayError.statusCode === 401) {
        errorMessage = 'Payment gateway authentication failed. Please contact administrator.';
        errorCode = 'AUTH_ERROR';
      }
      
      return res.status(500).json({ 
        error: errorMessage,
        code: errorCode,
        details: process.env.NODE_ENV === 'development' ? razorpayError.message : undefined
      });
    }
    
    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    
    res.status(200).json({
      orderId: razorpayOrder.id,        
      amount: razorpayOrder.amount,     
      currency: razorpayOrder.currency,
      receipt: razorpayOrder.receipt,
      keyId: keyId // Include keyId for frontend
    });
  } catch (error) {
    console.error('Razorpay order creation error:', error);
    res.status(500).json({ 
      error: 'Failed to create payment order',
      details: error.message 
    });
  }
};

//! <--------------------VERIFY PAYMENT--------------------> !\\

agentPaymentCtrl.verifyPayment = async (req, res) => {
  try {
    const { orderId, paymentId, signature, amount, totalDue } = req.body;
    const agentId = req.UserId;
    const userRole = req.role;

    if (userRole !== "agent") {
      return res.status(403).json({ error: "Only agents can make payments to admin" });
    }

    if (!orderId || !paymentId || !signature || !amount) {
      return res.status(400).json({ error: "Missing payment verification data" });
    }

    const admin = await User.findOne({ role: "admin" });
    if (!admin) return res.status(404).json({ error: "Admin not found" });

    // Verify Razorpay signature
    const crypto = require("crypto");
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

    const generatedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(orderId + "|" + paymentId)
      .digest("hex");

    if (generatedSignature !== signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // ✅ NEW LOGIC: handle partial online payment
    const onlinePaid = Number(amount);
    // If totalDue is not provided, calculate from unpaid stocks
    let totalAmountDue = Number(totalDue) || 0;
    if (!totalDue || totalAmountDue === 0) {
      const unpaidStocks = await AgentStock.find({ 
        agentId: agentId,
        paymentStatus: 'pending'
      });
      totalAmountDue = unpaidStocks.reduce((sum, stock) => sum + (stock.totalAmount || 0), 0);
    }
    const remainingCash = totalAmountDue - onlinePaid;

    const paymentRecord = new AgentPayment({
      agent: agentId,
      admin: admin._id,
      onlinePaid,
      cashPaid: 0,
      totalDue: totalAmountDue,
      remainingCash: remainingCash > 0 ? remainingCash : 0,
      amount: onlinePaid,
      method: "online",
      status: remainingCash > 0 ? "partial" : "completed",
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
      transactionID: paymentId,
      paymentDate: new Date(),
      description: "Online payment to admin",
    });

    await paymentRecord.save();

    const populatedPayment = await AgentPayment.findById(paymentRecord._id)
      .populate("agent", "agentname email phoneNo")
      .populate("admin", "username email");

    res.status(200).json({
      message: "Online payment recorded",
      payment: populatedPayment,
    });
  } catch (error) {
    console.error("verifyPayment error:", error);
    res.status(500).json({ error: "Failed to verify payment" });
  }
};


//! <--------------------CASH PAYMENT--------------------> !\\

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
    
    const admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    
    const unpaidStocks = await AgentStock.find({ 
      agentId: agentId,
      paymentStatus: 'pending'
    }).sort({ assignedDate: 1 });
    
    const stockIds = [];
    let remainingAmount = amount;
    
    for (const stock of unpaidStocks) {
      if (remainingAmount <= 0) break; 
      
      const stockAmount = parseFloat(stock.totalAmount || 0);
      
      if (remainingAmount >= stockAmount) {
        stock.paymentStatus = 'paid';          
        stockIds.push(stock._id);              
        remainingAmount -= stockAmount;   
        await stock.save();                     
      } else {
        // Partial payment - mark as paid if exact match (within 0.01 tolerance)
        if (Math.abs(remainingAmount - stockAmount) < 0.01) {
          stock.paymentStatus = 'paid';
          stockIds.push(stock._id);
          remainingAmount = 0;
          await stock.save();
        }
      }
    }
  
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

//! <--------------------PAYMENT HISTORY--------------------> !\\

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
    
    const stocks = await AgentStock.find({ agentId })
      .populate('cylinderId', 'price cylinderName cylinderType'); 
    
    // Calculate total stock amount from ALL stocks (both paid and unpaid)
    const totalStockAmount = stocks.reduce((sum, s) => sum + (Number(s.totalAmount || 0)), 0);
    
    // Calculate total paid from payments (including partial payments)
    // For partial/paid/completed payments: use the maximum of (onlinePaid + cashPaid) or amount
    // This handles both new payments (with onlinePaid/cashPaid) and old payments (with only amount)
    // For pending/failed payments: don't count them as paid yet
    console.log(`[DEBUG] Processing ${payments.length} payments for agent ${agentId}`);
    
    const totalPaidFromPayments = payments.reduce((sum, p) => {
      // Get raw values - handle both Mongoose documents and plain objects
      const rawOnlinePaid = p.onlinePaid !== undefined ? p.onlinePaid : (p.get ? p.get('onlinePaid') : undefined);
      const rawCashPaid = p.cashPaid !== undefined ? p.cashPaid : (p.get ? p.get('cashPaid') : undefined);
      const rawAmount = p.amount !== undefined ? p.amount : (p.get ? p.get('amount') : undefined);
      const rawStatus = p.status !== undefined ? p.status : (p.get ? p.get('status') : undefined);
      
      const onlinePaid = Number(rawOnlinePaid || 0);
      const cashPaid = Number(rawCashPaid || 0);
      const amount = Number(rawAmount || 0);
      const status = String(rawStatus || 'unknown');
      
      // Skip pending or failed payments
      if (status === 'pending' || status === 'failed') {
        console.log(`[Payment ${p._id}] Skipped - status: ${status}`);
        return sum;
      }
      
      // Calculate payment amount: use the maximum of (onlinePaid + cashPaid) or amount
      // This ensures we always get the correct value regardless of which fields are set
      const partialTotal = onlinePaid + cashPaid;
      const paymentAmount = Math.max(partialTotal, amount);
      
      console.log(`[Payment ${p._id}] status=${status}, onlinePaid=${onlinePaid}, cashPaid=${cashPaid}, amount=${amount}, partialTotal=${partialTotal}, calculated=${paymentAmount}`);
      
      return sum + paymentAmount;
    }, 0);
    
    console.log(`[DEBUG] Total paid from payments: ${totalPaidFromPayments}`);
    
    // Calculate unpaid amount: total stock - total paid
    // This accounts for partial payments where stocks might still be marked as 'pending'
    // but some payment has been made
    const unpaidStockAmount = Math.max(0, totalStockAmount - totalPaidFromPayments);
    
    // Get unpaid stocks list (for display purposes)
    const unpaidStocks = stocks.filter(s => s.paymentStatus === 'pending');
    
    // Paid amount is the total paid from payments
    const paidStockAmount = totalPaidFromPayments;
    
    // Debug logging to help diagnose issues
    console.log('Agent Payment History Calculation:', {
      agentId: agentId.toString(),
      totalStockAmount,
      unpaidStockAmount,
      totalPaidFromPayments,
      paidStockAmount,
      stocksCount: stocks.length,
      unpaidStocksCount: unpaidStocks.length,
      paymentsCount: payments.length,
      allPaymentsStatus: payments.map(p => ({ id: p._id.toString(), status: p.status, amount: p.amount, onlinePaid: p.onlinePaid, cashPaid: p.cashPaid })),
      stocksBreakdown: stocks.map(s => ({ 
        id: s._id, 
        amount: s.totalAmount, 
        status: s.paymentStatus,
        isUnpaid: s.paymentStatus === 'pending'
      })),
      paymentsBreakdown: payments.map(p => {
        const onlinePaid = Number(p.onlinePaid || 0);
        const cashPaid = Number(p.cashPaid || 0);
        const amount = Number(p.amount || 0);
        let calculatedPaid = 0;
        
        if (p.status === 'pending' || p.status === 'failed') {
          calculatedPaid = 0;
        } else {
          const partialTotal = onlinePaid + cashPaid;
          calculatedPaid = Math.max(partialTotal, amount);
        }
        
        return {
          id: p._id,
          status: p.status,
          method: p.method,
          onlinePaid: p.onlinePaid,
          cashPaid: p.cashPaid,
          amount: p.amount,
          totalDue: p.totalDue,
          calculatedPaid: calculatedPaid,
          partialTotal: onlinePaid + cashPaid
        };
      })
    });
  
    res.status(200).json({
      payments: payments,                                    
      totalPayments: payments.length,                       
      totalAmount: totalPaidFromPayments, // Total amount paid (online + cash)
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

//! <--------------------ALL AGENT PAYMENTS--------------------> !\\
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
  
    // Calculate total amount received (including partial payments)
    // For partial/paid/completed payments: prefer onlinePaid + cashPaid if available, otherwise use amount
    // For pending/failed payments: don't count them
    const totalAmountReceived = payments.reduce((sum, p) => {
      // Skip pending or failed payments
      if (p.status === 'pending' || p.status === 'failed') {
        return sum;
      }
      
      // For partial, paid, or completed payments, try to use onlinePaid + cashPaid first
      const onlinePaid = Number(p.onlinePaid || 0);
      const cashPaid = Number(p.cashPaid || 0);
      const hasPartialFields = onlinePaid > 0 || cashPaid > 0;
      
      if (hasPartialFields) {
        // If onlinePaid or cashPaid exists, use their sum
        return sum + onlinePaid + cashPaid;
      } else {
        // Otherwise, use the amount field
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

//! <--------------------PAYMENT STATS--------------------> !\\

agentPaymentCtrl.getAgentPaymentStats = async (req, res) => {

  try {
    const { agentId } = req.params;
    const userRole = req.role;
    
    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Only admin can view agent payment statistics' });
    }
    
    const stocks = await AgentStock.find({ agentId })
      .populate('cylinderId', 'price cylinderName cylinderType');
    
    const totalStockAmount = stocks.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
    
    const unpaidStockAmount = stocks
      .filter(s => s.paymentStatus === 'pending')
      .reduce((sum, s) => sum + (s.totalAmount || 0), 0);
  
    const paidStockAmount = stocks
      .filter(s => s.paymentStatus === 'paid')
      .reduce((sum, s) => sum + (s.totalAmount || 0), 0);
    

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

//! <--------------------CREATE CASH PAYMENT BY ADMIN--------------------> !\\

agentPaymentCtrl.createCashPaymentByAdmin = async (req, res) => {
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

    // Find the agent
    const agent = await User.findById(agentId);
    if (!agent || agent.role !== 'agent') {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Get unpaid stocks for this agent
    const unpaidStocks = await AgentStock.find({ 
      agentId: agentId,
      paymentStatus: 'pending'
    }).sort({ assignedDate: 1 });

    const stockIds = [];
    let remainingAmount = Number(amount);
    const totalStockAmount = unpaidStocks.reduce((sum, stock) => sum + (stock.totalAmount || 0), 0);

    // Mark stocks as paid based on payment amount
    for (const stock of unpaidStocks) {
      if (remainingAmount <= 0) break; 
      
      const stockAmount = parseFloat(stock.totalAmount || 0);
      
      if (remainingAmount >= stockAmount) {
        stock.paymentStatus = 'paid';          
        stockIds.push(stock._id);              
        remainingAmount -= stockAmount;   
        await stock.save();                     
      } else {
        // Partial payment - mark as paid if exact match (within 0.01 tolerance)
        if (Math.abs(remainingAmount - stockAmount) < 0.01) {
          stock.paymentStatus = 'paid';
          stockIds.push(stock._id);
          remainingAmount = 0;
          await stock.save();
        }
      }
    }

    // Determine status based on whether all stocks are paid
    const paymentStatus = remainingAmount >= 0 && stockIds.length === unpaidStocks.length ? 'completed' : 'completed';
    const totalDue = totalStockAmount;
    const remainingCash = Math.max(0, totalDue - amount);

    const agentPayment = new AgentPayment({
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
    });
    
    await agentPayment.save();

    const populatedPayment = await AgentPayment.findById(agentPayment._id)
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

//! <--------------------UPDATE CASH PAID BY ADMIN--------------------> !\\

agentPaymentCtrl.updateCashPaid = async (req, res) => {
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

    // Find the payment record
    const payment = await AgentPayment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ error: 'Payment record not found' });
    }

    // Check if this is a partial payment (online payment with remaining cash)
    if (payment.status !== 'partial' && payment.method !== 'online') {
      return res.status(400).json({ error: 'Can only update cash paid for partial online payments' });
    }

    const totalCashPaid = Number(cashPaid);
    const onlinePaid = Number(payment.onlinePaid || 0);
    const totalDue = Number(payment.totalDue || 0);
    const totalPaid = onlinePaid + totalCashPaid;

    // Validate that cash paid doesn't exceed remaining amount
    const remainingCash = totalDue - onlinePaid;
    if (totalCashPaid > remainingCash) {
      return res.status(400).json({ 
        error: `Cash paid (₹${totalCashPaid}) cannot exceed remaining amount (₹${remainingCash})` 
      });
    }

    // Update payment record
    payment.cashPaid = totalCashPaid;
    payment.remainingCash = remainingCash - totalCashPaid;
    
    // Update status based on whether payment is complete
    if (totalPaid >= totalDue) {
      payment.status = 'paid';
      payment.amount = totalPaid; // Update total amount
    } else {
      payment.status = 'partial';
      payment.amount = onlinePaid; // Keep amount as online paid for now
    }

    await payment.save();

    // Update stock payment status if payment is complete
    if (payment.status === 'paid' && payment.stockIds && payment.stockIds.length > 0) {
      await AgentStock.updateMany(
        { _id: { $in: payment.stockIds } },
        { paymentStatus: 'paid' }
      );
    }

    const populatedPayment = await AgentPayment.findById(payment._id)
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

module.exports = agentPaymentCtrl;
