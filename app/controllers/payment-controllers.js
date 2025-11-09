const Payment = require('../models/payment-model');
const Booking = require('../models/booking-model');
const Cylinder = require('../models/cylinder-model');
const User = require('../models/user-model');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const paymentCtrl = {};

let razorpay = null;

const getRazorpayInstance = () => {
  try {
    if (!razorpay) {
      // Trim whitespace from environment variables to avoid issues
      const keyId = process.env.RAZORPAY_KEY_ID?.trim();
      const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
      
      if (!keyId || !keySecret) {
        console.error('Razorpay credentials not configured. Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET');
        throw new Error('Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in environment variables.');
      }
      
      razorpay = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
      });
    }
    
    return razorpay;
  } catch (error) {
    console.error('Error initializing Razorpay instance:', error);
    throw error;
  }
};

//! -------------------- CREATE RAZORPAY ORDER -------------------- //

paymentCtrl.createRazorpayOrder = async (req, res) => {

  try {
    // Check if Razorpay credentials are configured
    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    
    if (!keyId || !keySecret) {
      console.error('Razorpay credentials not configured');
      return res.status(500).json({ 
        error: 'Payment gateway not configured. Please contact administrator.' 
      });
    }

    const { bookingId } = req.body;
    const userId = req.UserId;
    const userRole = req.role;

    if (!bookingId) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    const booking = await Booking.findById(bookingId)
      .populate('cylinder')
      .populate('customer');

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (userRole === 'customer') {
      const bookingCustomerId = booking.customer?._id || booking.customer;
      if (bookingCustomerId?.toString() !== userId?.toString()) {
        return res.status(403).json({ error: 'Unauthorized: You can only pay for your own bookings' });
      }
    } else if (userRole === 'agent') {
      const bookingAgentId = booking.agent?._id || booking.agent;
      if (bookingAgentId?.toString() !== userId?.toString()) {
        return res.status(403).json({ error: 'Unauthorized: You can only pay for bookings assigned to you' });
      }
    }

    if (booking.paymentStatus === 'paid') {
      return res.status(400).json({ error: 'Booking is already paid' });
    }

    if (booking.status !== 'delivered') {
      return res.status(400).json({ 
        error: 'Payment can only be made after the cylinder is delivered. Please wait for delivery confirmation.' 
      });
    }

    if (booking.paymentMethod !== 'online') {
      return res.status(400).json({ 
        error: 'This booking is set for cash payment. Please contact your agent for cash payment.' 
      });
    }

    const cylinder = booking.cylinder;
    if (!cylinder || !cylinder.price) {
      return res.status(400).json({ error: 'Cylinder price not found' });
    }

    // Calculate amount in paise (Razorpay requires amount in smallest currency unit)
    const amount = Math.round((cylinder.price * booking.quantity) * 100);
    
    // Razorpay minimum amount is 1 INR = 100 paise
    if (amount < 100) {
      return res.status(400).json({ error: 'Payment amount must be at least ₹1' });
    } 

  
    const shortBookingId = bookingId.toString().slice(-8);
    const timestamp = Date.now().toString().slice(-8);
    const receipt = `B${shortBookingId}${timestamp}`; 
    
    const options = {
      amount: amount,
      currency: 'INR',
      receipt: receipt,
      notes: {
        bookingId: bookingId.toString(),
        customerId: userId.toString(),
        cylinderName: cylinder.cylinderName || cylinder.cylinderType,
        quantity: booking.quantity.toString(),
      },
    };

    let razorpayOrder;
    try {
      const razorpayInstance = getRazorpayInstance();
      razorpayOrder = await razorpayInstance.orders.create(options);
    } catch (razorpayError) {
      console.error('Razorpay order creation error:', {
        error: razorpayError.message,
        errorDescription: razorpayError.error?.description,
        statusCode: razorpayError.statusCode,
        bookingId: bookingId,
        amount: amount,
        currency: 'INR'
      });
      
      // Provide more specific error messages
      let errorMessage = 'Failed to create payment order. Please try again.';
      if (razorpayError.error?.description) {
        errorMessage = razorpayError.error.description;
      } else if (razorpayError.statusCode === 401) {
        errorMessage = 'Payment gateway authentication failed. Please contact administrator.';
      } else if (razorpayError.statusCode === 400) {
        errorMessage = razorpayError.error?.description || 'Invalid payment request. Please check booking details.';
      }
      
      return res.status(500).json({ 
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? razorpayError.message : undefined
      });
    }

    res.status(200).json({
      message: 'Order created successfully',
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: keyId, // Use the trimmed keyId
    });
  } catch (err) {
    console.error('Error creating Razorpay order:', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
};

//! -------------------- VERIFY RAZORPAY PAYMENT -------------------- //
paymentCtrl.verifyPayment = async (req, res) => {
  try {
    // Check if Razorpay secret key is configured
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    
    if (!keySecret) {
      console.error('Razorpay key secret not configured');
      return res.status(500).json({ 
        error: 'Payment gateway not configured. Please contact administrator.' 
      });
    }

    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, bookingId } = req.body;
    const userId = req.UserId;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !bookingId) {
      return res.status(400).json({ error: 'Missing payment details' });
    }

    // Verify payment signature
    const signatureString = `${razorpayOrderId}|${razorpayPaymentId}`;
    const generatedSignature = crypto
      .createHmac('sha256', keySecret) // Use trimmed key secret
      .update(signatureString)
      .digest('hex');

    console.log('[Payment Verification] Signature verification:', {
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      signatureString: signatureString,
      keySecretLength: keySecret.length,
      generatedSignatureLength: generatedSignature.length,
      receivedSignatureLength: razorpaySignature.length,
      signaturesMatch: generatedSignature === razorpaySignature
    });

    if (generatedSignature !== razorpaySignature) {
      console.error('[Payment Verification] Invalid payment signature:', {
        generated: generatedSignature.substring(0, 20) + '...',
        received: razorpaySignature.substring(0, 20) + '...',
        orderId: razorpayOrderId,
        paymentId: razorpayPaymentId,
        signatureString: signatureString,
        keySecretConfigured: !!keySecret,
        keySecretLength: keySecret?.length || 0
      });
      return res.status(400).json({ 
        error: 'Invalid payment signature. Please contact support if this issue persists.',
        details: process.env.NODE_ENV === 'development' ? 'Signature mismatch' : undefined
      });
    }

    const booking = await Booking.findById(bookingId)
      .populate('cylinder')
      .populate('customer')
      .populate('agent');

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Check authorization - allow both customer and agent to verify payment
    const bookingCustomerId = booking.customer?._id || booking.customer;
    const bookingAgentId = booking.agent?._id || booking.agent;
    const userRole = req.role;
    
    const isAuthorized = 
      (userRole === 'customer' && bookingCustomerId?.toString() === userId?.toString()) ||
      (userRole === 'agent' && bookingAgentId?.toString() === userId?.toString()) ||
      (userRole === 'admin');
    
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized: You are not authorized to verify this payment' });
    }

    // Check if payment already exists for this booking (prevent duplicate payments)
    const existingPayment = await Payment.findOne({
      booking: bookingId,
      razorpayPaymentId: razorpayPaymentId
    });

    if (existingPayment) {
      console.warn('Duplicate payment attempt detected:', {
        bookingId,
        paymentId: razorpayPaymentId,
        existingPaymentId: existingPayment._id
      });
      return res.status(400).json({ 
        error: 'Payment already processed for this booking',
        payment: existingPayment
      });
    }

    // Check if booking is already paid
    if (booking.paymentStatus === 'paid') {
      return res.status(400).json({ error: 'Booking is already paid' });
    }

    const cylinder = booking.cylinder;
    if (!cylinder || !cylinder.price) {
      return res.status(400).json({ error: 'Cylinder price not found' });
    }

    const amount = cylinder.price * booking.quantity;

    // Create payment record
    // Note: Payment model method enum only allows "cash" or "online", so use "online" for Razorpay
    const payment = new Payment({
      booking: bookingId,
      customer: bookingCustomerId,
      agent: bookingAgentId,
      amount: amount,
      method: 'online', // Use 'online' instead of 'razorpay' to match payment model enum
      status: 'completed',
      razorpayOrderId: razorpayOrderId,
      razorpayPaymentId: razorpayPaymentId,
      razorpaySignature: razorpaySignature,
      transactionID: razorpayPaymentId,
      paymentDate: new Date(),
    });

    try {
      await payment.save();
      console.log('[Payment Verification] Payment saved successfully:', payment._id);
    } catch (saveError) {
      console.error('[Payment Verification] Error saving payment:', saveError);
      throw new Error(`Failed to save payment: ${saveError.message}`);
    }
    
    // Update booking payment status
    try {
      booking.paymentStatus = 'paid';
      await booking.save();
      console.log('[Payment Verification] Booking payment status updated:', booking._id);
    } catch (saveError) {
      console.error('[Payment Verification] Error updating booking:', saveError);
      // Payment is already saved, so we should still return success
      // but log the error
    }

    try {
      const populatedPayment = await Payment.findById(payment._id)
        .populate('booking')
        .populate('customer')
        .populate('agent');

      console.log('[Payment Verification] Payment verified and completed successfully');

      res.status(200).json({
        message: 'Payment verified and completed successfully',
        payment: populatedPayment,
        booking: booking,
      });
    } catch (populateError) {
      console.error('[Payment Verification] Error populating payment:', populateError);
      // Payment is saved, return the payment without population
      res.status(200).json({
        message: 'Payment verified and completed successfully',
        payment: payment,
        booking: booking,
      });
    }
  } catch (err) {
    console.error('[Payment Verification] Error verifying payment:', err);
    console.error('[Payment Verification] Error stack:', err.stack);
    console.error('[Payment Verification] Error details:', {
      name: err.name,
      message: err.message,
      code: err.code
    });
    res.status(500).json({ 
      error: 'Failed to verify payment',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      code: process.env.NODE_ENV === 'development' ? err.code : undefined
    });
  }
};

//! -------------------- GET PAYMENT HISTORY -------------------- //

paymentCtrl.getPaymentHistory = async (req, res) => {
  try {
    const userId = req.UserId;
    const userRole = req.role;

    let payments;

    if (userRole === 'customer') {
      payments = await Payment.find({ customer: userId })
        .populate('booking')
        .populate('customer')
        .populate('agent')
        .sort({ createdAt: -1 });
    } else if (userRole === 'agent') {
      payments = await Payment.find({ agent: userId })
        .populate('booking')
        .populate('customer')
        .populate('agent')
        .sort({ createdAt: -1 });
    } else if (userRole === 'admin') {
      payments = await Payment.find()
        .populate('booking')
        .populate('customer')
        .populate('agent')
        .sort({ createdAt: -1 });
    } else {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    res.status(200).json({
      message: 'Payment history fetched successfully',
      payments: payments,
    });
  } catch (err) {
    console.error('Error fetching payment history:', err);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
};

//! -------------------- GET PAYMENT BY ID -------------------- //
paymentCtrl.getPaymentById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.UserId;
    const userRole = req.role;

    const payment = await Payment.findById(id)
      .populate('booking')
      .populate('customer')
      .populate('agent');

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Check authorization
    if (userRole === 'customer') {
      const paymentCustomerId = payment.customer?._id || payment.customer;
      if (paymentCustomerId?.toString() !== userId?.toString()) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
    } else if (userRole === 'agent') {
      const paymentAgentId = payment.agent?._id || payment.agent;
      if (paymentAgentId?.toString() !== userId?.toString()) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
    }

    res.status(200).json({
      message: 'Payment fetched successfully',
      payment: payment,
    });
  } catch (err) {
    console.error('Error fetching payment:', err);
    res.status(500).json({ error: 'Failed to fetch payment' });
  }
};

module.exports = paymentCtrl;

