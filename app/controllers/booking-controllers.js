const Booking = require("../models/booking-model");
const Cylinder = require("../models/cylinder-model");
const User = require("../models/user-model");
const AgentStock = require("../models/agent-stock-model");
const Payment = require("../models/payment-model");
const mongoose = require("mongoose");

const bookingCtrl = {};

//! -------------------- CREATE BOOKING -------------------- //
bookingCtrl.NewBooking = async (req, res) => {
  try {
    const { quantity, cylinderId, paymentMethod, deliveryDate, customerId: requestedCustomerId } = req.body;
    const userRole = req.role;
    const userId = req.UserId;
    
    console.log(`NewBooking request - Role: ${userRole}, UserId: ${userId}`);
    console.log(`Request body:`, { quantity, cylinderId, paymentMethod, deliveryDate, requestedCustomerId });
    
    // Determine customerId based on user role
    let customerId;
    let agentId;
    
    if (userRole === "agent") {
      // Agent is booking on behalf of a customer
      if (!requestedCustomerId) {
        return res.status(400).json({ error: "Customer ID is required when booking as agent" });
      }
      
      // Validate customerId format
      if (!mongoose.Types.ObjectId.isValid(requestedCustomerId)) {
        return res.status(400).json({ error: "Invalid customer ID format" });
      }
      
      customerId = requestedCustomerId;
      agentId = userId; // Agent is the logged-in user
      
      console.log(`Agent ${agentId} booking for customer ${customerId}`);
    } else if (userRole === "customer") {
      // Customer is booking for themselves
      customerId = userId;
      // Agent will be determined from customer's assigned agent
      console.log(`Customer ${customerId} booking for themselves`);
    } else {
      return res.status(403).json({ error: "Unauthorized: Only agents and customers can create bookings" });
    }

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: "Quantity must be greater than 0" });
    }
    if (!cylinderId) {
      return res.status(400).json({ error: "Cylinder ID is required" });
    }
    if (paymentMethod && !["online", "cash"].includes(paymentMethod)) {
      return res.status(400).json({ error: "Payment method must be 'online' or 'cash'" });
    }
    // Validate delivery date if provided
    if (deliveryDate) {
      const delivery = new Date(deliveryDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (delivery < today) {
        return res.status(400).json({ error: "Delivery date cannot be in the past" });
      }
    }

    // If agent is booking, verify the customer is assigned to them FIRST
    if (userRole === "agent") {
      // Convert agentId to ObjectId for reliable query
      const agentObjectId = mongoose.Types.ObjectId.isValid(agentId) 
        ? new mongoose.Types.ObjectId(agentId) 
        : agentId;
      const customerObjectId = mongoose.Types.ObjectId.isValid(customerId) 
        ? new mongoose.Types.ObjectId(customerId) 
        : customerId;
      
      console.log(`Checking customer assignment:`);
      console.log(`  Customer ID: ${customerId} (${customerObjectId})`);
      console.log(`  Agent ID: ${agentId} (${agentObjectId})`);
      
      // First, check if customer exists
      const customerExists = await User.findById(customerObjectId);
      if (!customerExists) {
        console.error(`Customer ${customerId} not found in database`);
        return res.status(404).json({ error: "Customer not found" });
      }
      
      console.log(`Customer found: ${customerExists.username || customerExists.email}`);
      console.log(`Customer's agent field: ${customerExists.agent}`);
      console.log(`Customer's agent type: ${customerExists.agent ? customerExists.agent.constructor.name : 'null'}`);
      
      // Check if customer has an agent assigned
      if (!customerExists.agent) {
        console.error(`Customer ${customerId} has no agent assigned`);
        return res.status(400).json({ 
          error: "This customer does not have an agent assigned. Please contact admin to assign an agent to this customer." 
        });
      }
      
      // Compare agent IDs - convert both to strings for comparison
      const customerAgentIdStr = customerExists.agent.toString();
      const loggedInAgentIdStr = agentObjectId.toString();
      
      console.log(`Comparing agents:`);
      console.log(`  Customer's agent: ${customerAgentIdStr}`);
      console.log(`  Logged in agent: ${loggedInAgentIdStr}`);
      console.log(`  Match: ${customerAgentIdStr === loggedInAgentIdStr}`);
      
      // Verify by querying: if customer is assigned to this agent, the query will find them
      const customerAssigned = await User.findOne({ 
        _id: customerObjectId, 
        agent: agentObjectId,
        role: "customer"
      });
      
      if (!customerAssigned) {
        // Customer exists and has an agent, but it's not the logged-in agent
        console.error(`Customer ${customerId} is NOT assigned to agent ${agentId}`);
        console.error(`  Customer's actual agent: ${customerAgentIdStr}`);
        console.error(`  Logged in agent: ${loggedInAgentIdStr}`);
        return res.status(403).json({ 
          error: "This customer is not assigned to your account. Please select a customer from the list that is assigned to you." 
        });
      }
      
      // Customer is verified and assigned - use this customer record
      const customer = customerAssigned;
      agentId = customer.agent;
      console.log(`✓ Verified: Customer ${customerId} (${customer.username || customer.email}) is assigned to agent ${agentId}`);
      
      // Check if customer has agent assigned (should always be true at this point, but double-check)
      if (!customer.agent) {
        console.error(`Data inconsistency: Customer ${customerId} found in query but agent field is null`);
        return res.status(500).json({ 
          error: "Data error: Customer agent assignment is inconsistent. Please contact support." 
        });
      }
    } else {
      // Customer is booking for themselves
      const customer = await User.findById(customerId);
      if (!customer) {
        console.error(`Customer not found: ${customerId}`);
        return res.status(404).json({ error: "Customer not found" });
      }
      
      // Check if customer has agent assigned
      if (!customer.agent) {
        console.error(`Customer ${customerId} (${customer.username || customer.email}) does not have an agent assigned`);
        return res.status(400).json({ 
          error: "This customer does not have an agent assigned. Please contact admin to assign an agent to this customer." 
        });
      }
      
      // Use their assigned agent
      agentId = customer.agent;
      console.log(`Customer booking for themselves - Using agent: ${agentId}`);
    }

    // Validate cylinder
    if (!mongoose.Types.ObjectId.isValid(cylinderId)) {
      return res.status(400).json({ error: "Invalid cylinder ID format" });
    }
    
    const cylinder = await Cylinder.findById(cylinderId);
    if (!cylinder) {
      console.error(`Cylinder not found: ${cylinderId}`);
      return res.status(404).json({ error: "Cylinder not found" });
    }

    // Validate agentId before querying stock
    const agentIdForStock = mongoose.Types.ObjectId.isValid(agentId) 
      ? new mongoose.Types.ObjectId(agentId) 
      : agentId;
    
    const agentStock = await AgentStock.findOne({ 
      agentId: agentIdForStock, 
      cylinderId: new mongoose.Types.ObjectId(cylinderId)
    });
    
    if (!agentStock) {
      console.error(`No stock found for agent ${agentId} and cylinder ${cylinderId}`);
      return res.status(400).json({ error: "Selected cylinder is not available in your stock" });
    }
    
    if (agentStock.quantity < quantity) {
      console.error(`Insufficient stock: Available ${agentStock.quantity}, Requested ${quantity}`);
      return res.status(400).json({ 
        error: `Insufficient stock. Available: ${agentStock.quantity}, Requested: ${quantity}` 
      });
    }

    const booking = new Booking({
      customer: customerId,
      agent: agentId,
      cylinder: cylinderId,
      quantity,
      paymentMethod: paymentMethod || "cash", 
      paymentStatus: "pending",
      deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
    });

    await booking.save();

    // Update agent stock
    agentStock.quantity -= quantity;
    agentStock.lastUpdated = Date.now();
    await agentStock.save();

    // Populate booking data for response
    const populatedBooking = await Booking.findById(booking._id)
      .populate("customer", "username businessName phoneNo email")
      .populate("agent", "agentname phoneNo")
      .populate("cylinder", "cylinderType weight price");

    res.status(201).json({ message: "Booking made successfully", booking: populatedBooking });
  } catch (err) {
    console.error("Error in NewBooking controller:", err);
    console.error("Error stack:", err.stack);
    console.error("Error message:", err.message);
    
    // Return appropriate error based on error type
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: "Validation error", details: err.message });
    }
    if (err.name === 'CastError') {
      return res.status(400).json({ error: "Invalid ID format", details: err.message });
    }
    
    // Default error response
    res.status(500).json({ 
      error: "Error making the booking",
      details: err.message || "An unexpected error occurred"
    });
  }
};

//! -------------------- ALL BOOKINGS -------------------- //
bookingCtrl.allBookings = async (req, res) => {
  try {
    const listAll = await Booking.find()
      .populate("customer", "username businessName phoneNo")
      .populate("agent", "agentname phoneNo")
      .populate("cylinder", "cylinderType weight price")
      .sort({ createdAt: -1 });

    res.status(200).json({ message: "List of all bookings", listAll });
  } catch (err) {
    console.log(err);
    res.status(400).json({ error: "Something went wrong" });
  }
};

//! -------------------- SINGLE BOOKING -------------------- //
bookingCtrl.singleBooking = async (req, res) => {
  try {
    const id = req.params.id;
    const booking = await Booking.findById(id)
      .populate("customer", "username businessName phoneNo email address location")
      .populate("agent", "agentname username phoneNo email address")
      .populate("cylinder", "cylinderType weight price cylinderName");

    if (!booking) return res.status(404).json({ error: "Booking not found" });

    res.status(200).json({ message: "Fetched booking successfully", booking });
  } catch (err) {
    console.log(err);
    res.status(400).json({ error: "Something went wrong" });
  }
};

//! -------------------- UPDATE BOOKING -------------------- //
bookingCtrl.updateBooking = async (req, res) => {
  try {
    const id = req.params.id;
    const { quantity, status, paymentStatus, isReturned } = req.body;
    const userRole = req.role;

    let booking = await Booking.findById(id)
      .populate("cylinder")
      .populate("customer")
      .populate("agent");
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const originalPaymentStatus = booking.paymentStatus;
    const userId = req.UserId;

    if (userRole === "agent") {
      if (status) booking.status = status;
      if (quantity) booking.quantity = quantity;
      if (paymentStatus) booking.paymentStatus = paymentStatus;
      if (typeof isReturned === "boolean") booking.isReturned = isReturned;
    } else if (userRole === "customer") {
      if (booking.status !== "pending") {
        return res.status(400).json({ error: "Cannot update booking after confirmation" });
      }
      if (quantity) booking.quantity = quantity;
    } else {
      return res.status(403).json({ error: "Unauthorized access" });
    }

    await booking.save();

    if (userRole === "agent" && 
        paymentStatus === "paid" && 
        originalPaymentStatus === "pending" && 
        booking.paymentMethod === "cash" &&
        booking.status === "delivered") {
      try {
        const amount = (booking.cylinder?.price || 0) * (booking.quantity || 0);
        
        const existingPayment = await Payment.findOne({ booking: booking._id });
        
        if (!existingPayment && amount > 0) {
          const payment = new Payment({
            booking: booking._id,
            customer: booking.customer?._id || booking.customer,
            agent: booking.agent?._id || booking.agent,
            amount: amount,
            method: 'cash',
            status: 'completed',
            transactionID: `CASH_${booking._id}_${Date.now()}`,
            paymentDate: new Date(),
          });
          
          await payment.save();
          console.log(`Cash payment record created for booking ${booking._id}`);
        }
      } catch (paymentErr) {
        console.error("Error creating cash payment record:", paymentErr);
      }
    }
    
    const updatedBooking = await Booking.findById(booking._id)
      .populate("customer", "username businessName phoneNo email address location")
      .populate("agent", "agentname username phoneNo email address")
      .populate("cylinder", "cylinderType weight price cylinderName");
    
    res.status(200).json({ message: "Booking updated successfully", booking: updatedBooking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong while updating booking" });
  }
};

//! -------------------- CANCEL BOOKING -------------------- //
bookingCtrl.cancelBooking = async (req, res) => {
  try {
    const id = req.params.id;
    const userRole = req.role;
    const userId = req.UserId;

    const booking = await Booking.findById(id)
      .populate("customer", "_id")
      .populate("agent", "_id");

    if (!booking) return res.status(404).json({ error: "Booking not found" });

    if (userRole === "customer") {
      const bookingCustomerId = booking.customer?._id || booking.customer;
      if (bookingCustomerId?.toString() !== userId?.toString()) {
        return res.status(403).json({ error: "Unauthorized: You can only cancel your own bookings" });
      }
      if (booking.status !== "pending" && booking.status !== "requested") {
        return res.status(400).json({ error: "Cannot cancel booking after confirmation" });
      }
    } else if (userRole === "agent") {
      const bookingAgentId = booking.agent?._id || booking.agent;
      if (bookingAgentId?.toString() !== userId?.toString()) {
        return res.status(403).json({ error: "Unauthorized: You can only cancel bookings for your customers" });
      }
    }
    if (booking.status === "cancelled") {
      return res.status(400).json({ error: "Booking is already cancelled" });
    }
    if (booking.status === "delivered" || booking.status === "completed") {
      return res.status(400).json({ error: "Cannot cancel a delivered or completed booking" });
    }

    const originalStatus = booking.status;

    booking.status = "cancelled";
    await booking.save();

    if (originalStatus === "confirmed" || originalStatus === "active") {
      const agentStock = await AgentStock.findOne({
        agentId: booking.agent,
        cylinderId: booking.cylinder,
      });

      if (agentStock) {
        agentStock.quantity += booking.quantity;
        agentStock.lastUpdated = Date.now();
        await agentStock.save();
      }
    }

    const updatedBooking = await Booking.findById(id)
      .populate("customer", "username businessName phoneNo email address location")
      .populate("agent", "agentname username phoneNo email address")
      .populate("cylinder", "cylinderType weight price cylinderName");

    res.status(200).json({ message: "Booking cancelled successfully", booking: updatedBooking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong while cancelling booking" });
  }
};

//! -------------------- DELETE BOOKING -------------------- //
bookingCtrl.deleteBooking = async (req, res) => {
  try {
    const id = req.params.id;
    const deleteBooking = await Booking.findByIdAndDelete(id);

    if (!deleteBooking) return res.status(404).json({ error: "Booking not found" });

    const agentStock = await AgentStock.findOne({
      agentId: deleteBooking.agent,
      cylinderId: deleteBooking.cylinder,
    });

    if (agentStock) {
      agentStock.quantity += deleteBooking.quantity;
      agentStock.lastUpdated = Date.now();
      await agentStock.save();
    }

    res.status(200).json({ message: "Booking deleted successfully", deleteBooking });
  } catch (err) {
    res.status(500).json({ error: "Something went wrong" });
  }
};

//! -------------------- TODAY’S BOOKINGS -------------------- //
bookingCtrl.getToday = async (req, res) => {
  const { agentId } = req.params;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const bookings = await Booking.find({
      agent: agentId,
      createdAt: { $gte: today },
    })
      .populate("customer", "username")
      .populate("cylinder", "cylinderType");

    res.status(200).json({ message: "Today's bookings fetched", bookings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load today's bookings" });
  }
};

//! -------------------- AGENT BOOKINGS -------------------- //
bookingCtrl.getAgentBookings = async (req, res) => {
  try {
    const agentId = req.UserId;
    const bookings = await Booking.find({ agent: agentId })
      .populate("customer", "username businessName phoneNo email address location")
      .populate("agent", "agentname phoneNo")
      .populate("cylinder", "cylinderType weight price")
      .sort({ createdAt: -1 });

    res.status(200).json({ message: "Agent bookings fetched successfully", bookings });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Something went wrong while fetching bookings" });
  }
};

//! -------------------- CUSTOMER BOOKINGS -------------------- //
bookingCtrl.getCustomerBookings = async (req, res) => {
  try {
    const customerId = req.UserId;
    const bookings = await Booking.find({ customer: customerId })
      .populate("customer", "username businessName phoneNo email address location")
      .populate("agent", "agentname username phoneNo email address")
      .populate("cylinder", "cylinderType weight price cylinderName")
      .sort({ createdAt: -1 });

    res.status(200).json({ message: "Customer bookings fetched successfully", bookings });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Something went wrong while fetching customer bookings" });
  }
};

module.exports = bookingCtrl;
