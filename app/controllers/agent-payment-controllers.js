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
        statusCode: razorpayError.statusCode,
        agentId: agentId,
        amount: orderAmount
      });
      
      let errorMessage = 'Failed to create payment order. Please try again.';
      if (razorpayError.error?.description) {
        errorMessage = razorpayError.error.description;
      } else if (razorpayError.statusCode === 401) {
        errorMessage = 'Payment gateway authentication failed. Please contact administrator.';
      }
      
      return res.status(500).json({ 
        error: errorMessage,
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
    const { orderId, paymentId, signature, amount, description, notes } = req.body;
    const agentId = req.UserId;   
    const userRole = req.role;    
    
    if (userRole !== 'agent') {
      return res.status(403).json({ error: 'Only agents can make payments to admin' });
    }
    
    if (!orderId || !paymentId || !signature || !amount) {
      return res.status(400).json({ error: 'Payment verification data is required (orderId, paymentId, signature, amount)' });
    }
  
    const admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    
    // Check if Razorpay secret key is configured
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    
    if (!keySecret) {
      console.error('Razorpay key secret not configured');
      return res.status(500).json({ 
        error: 'Payment gateway not configured. Please contact administrator.' 
      });
    }
    
    const crypto = require('crypto');
  
    // Verify payment signature
    const signatureString = `${orderId}|${paymentId}`;
    const generatedSignature = crypto
      .createHmac('sha256', keySecret) // Use trimmed key secret
      .update(signatureString)                   
      .digest('hex');                                   
    
    console.log('[Agent Payment Verification] Signature verification:', {
      orderId: orderId,
      paymentId: paymentId,
      signatureString: signatureString,
      keySecretLength: keySecret.length,
      generatedSignatureLength: generatedSignature.length,
      receivedSignatureLength: signature.length,
      signaturesMatch: generatedSignature === signature
    });
    
    if (generatedSignature !== signature) {
      console.error('[Agent Payment Verification] Invalid payment signature:', {
        generated: generatedSignature.substring(0, 20) + '...',
        received: signature.substring(0, 20) + '...',
        orderId: orderId,
        paymentId: paymentId,
        signatureString: signatureString,
        keySecretConfigured: !!keySecret,
        keySecretLength: keySecret?.length || 0
      });
      return res.status(400).json({ 
        error: 'Invalid payment signature. Please contact support if this issue persists.',
        details: process.env.NODE_ENV === 'development' ? 'Signature mismatch' : undefined
      });
    }

    // Check if payment already exists for this order (prevent duplicate payments)
    const existingPayment = await AgentPayment.findOne({
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId
    });

    if (existingPayment) {
      console.warn('Duplicate payment attempt detected:', {
        orderId,
        paymentId,
        existingPaymentId: existingPayment._id
      });
      return res.status(400).json({ 
        error: 'Payment already processed for this order',
        payment: existingPayment
      });
    }

    // Validate amount
    const paymentAmount = parseFloat(amount);
    if (!paymentAmount || paymentAmount <= 0) {
      return res.status(400).json({ error: 'Invalid payment amount' });
    }
  
    const unpaidStocks = await AgentStock.find({ 
      agentId: agentId,              
      paymentStatus: 'pending'        
    }).sort({ assignedDate: 1 });    
    
    const stockIds = [];              
    let remainingAmount = paymentAmount;    
    
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
      amount: paymentAmount,                     
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
    
    const populatedPayment = await AgentPayment.findById(agentPayment._id)
      .populate('agent', 'agentname username email phoneNo')
      .populate('admin', 'username email');
    
    res.status(200).json({
      message: 'Payment verified and recorded successfully',
      payment: populatedPayment,
      stockIds: stockIds
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to verify payment',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
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
      amount: paymentAmount,
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
    
    const totalStockAmount = stocks.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
    
    const unpaidStockAmount = stocks
      .filter(s => s.paymentStatus === 'pending') 
      .reduce((sum, s) => sum + (s.totalAmount || 0), 0);
    
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

module.exports = agentPaymentCtrl;
