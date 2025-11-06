const Payment = require('../models/payment-model');
const Booking = require('../models/booking-model');
const Cylinder = require('../models/cylinder-model');
const User = require('../models/user-model');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const paymentCtrl = {};

// Initialize Razorpay instance lazily
let razorpay = null;

const getRazorpayInstance = () => {
  if (!razorpay) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    
    if (!keyId || !keySecret) {
      throw new Error('Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in environment variables.');
    }
    
    razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }
  
  return razorpay;
};

//! -------------------- CREATE RAZORPAY ORDER -------------------- //
paymentCtrl.createRazorpayOrder = async (req, res) => {
  try {
    // Check if Razorpay credentials are configured
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(500).json({ 
        error: 'Payment gateway not configured. Please contact administrator.' 
      });
    }

    const { bookingId } = req.body;
    const userId = req.UserId;
    const userRole = req.role;

    // Find the booking
    const booking = await Booking.findById(bookingId)
      .populate('cylinder')
      .populate('customer');

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Check authorization - customer can pay for their own bookings, agent can pay for their customer bookings
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

    // Check if booking is already paid
    if (booking.paymentStatus === 'paid') {
      return res.status(400).json({ error: 'Booking is already paid' });
    }

    // Calculate total amount
    const cylinder = booking.cylinder;
    if (!cylinder || !cylinder.price) {
      return res.status(400).json({ error: 'Cylinder price not found' });
    }

    const amount = (cylinder.price * booking.quantity) * 100; // Convert to paise

    // Create Razorpay order
    const options = {
      amount: amount,
      currency: 'INR',
      receipt: `booking_${bookingId}_${Date.now()}`,
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
      console.error('Razorpay order creation error:', razorpayError);
      return res.status(500).json({ 
        error: 'Failed to create payment order. Please check Razorpay configuration.' 
      });
    }

    res.status(200).json({
      message: 'Order created successfully',
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('Error creating Razorpay order:', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
};

//! -------------------- VERIFY RAZORPAY PAYMENT -------------------- //
paymentCtrl.verifyPayment = async (req, res) => {
  try {
    // Check if Razorpay credentials are configured
    if (!process.env.RAZORPAY_KEY_SECRET) {
      return res.status(500).json({ 
        error: 'Payment gateway not configured. Please contact administrator.' 
      });
    }

    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, bookingId } = req.body;
    const userId = req.UserId;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !bookingId) {
      return res.status(400).json({ error: 'Missing payment details' });
    }

    // Verify signature
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (generatedSignature !== razorpaySignature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    // Fetch booking details
    const booking = await Booking.findById(bookingId)
      .populate('cylinder')
      .populate('customer')
      .populate('agent');

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Check authorization
    const bookingCustomerId = booking.customer?._id || booking.customer;
    if (bookingCustomerId?.toString() !== userId?.toString()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Calculate amount
    const cylinder = booking.cylinder;
    const amount = cylinder.price * booking.quantity;

    // Create payment record
    const payment = new Payment({
      booking: bookingId,
      customer: userId,
      agent: booking.agent?._id || booking.agent,
      amount: amount,
      method: 'razorpay',
      status: 'completed',
      razorpayOrderId: razorpayOrderId,
      razorpayPaymentId: razorpayPaymentId,
      razorpaySignature: razorpaySignature,
      transactionID: razorpayPaymentId,
      paymentDate: new Date(),
    });

    await payment.save();

    // Update booking payment status
    booking.paymentStatus = 'paid';
    await booking.save();

    // Populate payment before sending
    const populatedPayment = await Payment.findById(payment._id)
      .populate('booking')
      .populate('customer')
      .populate('agent');

    res.status(200).json({
      message: 'Payment verified and completed successfully',
      payment: populatedPayment,
      booking: booking,
    });
  } catch (err) {
    console.error('Error verifying payment:', err);
    res.status(500).json({ error: 'Failed to verify payment' });
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

