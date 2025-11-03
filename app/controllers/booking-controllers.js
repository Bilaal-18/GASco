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

module.exports = bookingCtrl;
