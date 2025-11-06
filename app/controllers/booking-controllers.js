const Booking = require("../models/booking-model");
const Cylinder = require("../models/cylinder-model");
const User = require("../models/user-model");
const AgentStock = require("../models/agent-stock-model");

const bookingCtrl = {};

//! -------------------- CREATE BOOKING -------------------- //
bookingCtrl.NewBooking = async (req, res) => {
  try {
    const { quantity, cylinderId } = req.body;
    const customerId = req.UserId;

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: "Quantity must be greater than 0" });
    }
    if (!cylinderId) {
      return res.status(400).json({ error: "Cylinder ID is required" });
    }

    const customer = await User.findById(customerId).populate("agent");
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const agent = customer.agent;
    if (!agent) return res.status(404).json({ error: "Agent not assigned to customer" });

    const cylinder = await Cylinder.findById(cylinderId);
    if (!cylinder) return res.status(404).json({ error: "Cylinder not found" });

    const agentStock = await AgentStock.findOne({ agentId: agent._id, cylinderId });
    if (!agentStock || agentStock.quantity < quantity) {
      return res.status(400).json({ error: "Selected quantity not available" });
    }

    const booking = new Booking({
      customer: customerId,
      agent: agent._id,
      cylinder: cylinderId,
      quantity,
    });

    await booking.save();

    agentStock.quantity -= quantity;
    agentStock.lastUpdated = Date.now();
    await agentStock.save();

    res.status(201).json({ message: "Booking made successfully", booking });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Error making the booking" });
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
      .populate("customer", "username businessName phoneNo")
      .populate("agent", "agentname phoneNo")
      .populate("cylinder", "cylinderType weight price");

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

    let booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

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
    res.status(200).json({ message: "Booking updated successfully", booking });
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

    // Check if user has permission to cancel this booking
    if (userRole === "customer") {
      const bookingCustomerId = booking.customer?._id || booking.customer;
      if (bookingCustomerId?.toString() !== userId?.toString()) {
        return res.status(403).json({ error: "Unauthorized: You can only cancel your own bookings" });
      }
      // Customers can only cancel pending bookings
      if (booking.status !== "pending" && booking.status !== "requested") {
        return res.status(400).json({ error: "Cannot cancel booking after confirmation" });
      }
    } else if (userRole === "agent") {
      const bookingAgentId = booking.agent?._id || booking.agent;
      if (bookingAgentId?.toString() !== userId?.toString()) {
        return res.status(403).json({ error: "Unauthorized: You can only cancel bookings for your customers" });
      }
    }

    // Only cancel if not already cancelled or delivered
    if (booking.status === "cancelled") {
      return res.status(400).json({ error: "Booking is already cancelled" });
    }
    if (booking.status === "delivered" || booking.status === "completed") {
      return res.status(400).json({ error: "Cannot cancel a delivered or completed booking" });
    }

    // Store original status before updating
    const originalStatus = booking.status;

    // Update booking status to cancelled
    booking.status = "cancelled";
    await booking.save();

    // Return stock to agent if booking was confirmed
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
      .populate("customer", "username businessName phoneNo")
      .populate("agent", "agentname phoneNo")
      .populate("cylinder", "cylinderType weight price");

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
      .populate("agent", "agentname phoneNo")
      .populate("cylinder", "cylinderType weight price cylinderName")
      .sort({ createdAt: -1 });

    res.status(200).json({ message: "Customer bookings fetched successfully", bookings });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Something went wrong while fetching customer bookings" });
  }
};

module.exports = bookingCtrl;
