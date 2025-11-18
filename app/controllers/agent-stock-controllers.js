const inventary = require("../models/inventary-model");
const agentStock = require("../models/agent-stock-model"); 
const cylinder = require("../models/cylinder-model");
const Booking = require("../models/booking-model");
 const User = require('../models/user-model');
const agentStockValidation = require("../validation/agent-stock-validation");


const agentStockCtrl = {};

//! <--------------------ADD AGENT STOCK-------------------> !\\

agentStockCtrl.addStock = async (req, res) => {
  const body = req.body;

  const { error, value } = agentStockValidation.validate(body, { abortEarly: false });
  if (error) {
    return res.status(400).json({ error: "Validation failed", details: error.details });
  }

  const { cylinderId, agentId, quantity } = value;

  try {
    const inventory = await inventary.findOne({ cylinderId }).populate("cylinderId", "price cylinderType weight");

    if (!inventory || inventory.totalQuantity < quantity) {
      return res.status(400).json({ error: "Stock not available" });
    }

    inventory.totalQuantity -= quantity;
    await inventory.save();
    const totalAmount = inventory.cylinderId.price * quantity;

   let agentStockDoc = await agentStock.findOne({ agentId, cylinderId });

    if (agentStockDoc) {
      agentStockDoc.quantity += quantity;
      agentStockDoc.totalAmount += totalAmount;
      await agentStockDoc.save();
    } else {
    
      agentStockDoc = new agentStock({
        agentId,
        cylinderId,
        quantity,
        totalAmount,
      });
      await agentStockDoc.save();
    }
    await agentStockDoc.populate("cylinderId", "cylinderName cylinderType weight price");

    const allAgentStock = await agentStock
      .find({ agentId })
      .populate("cylinderId", "cylinderName cylinderType weight price");

    res.status(201).json({
      message: "Stock assigned to agent successfully",
      newlyAdded: agentStockDoc,
      allAgentStock,
    });
  } catch (err) {
    console.error("Error assigning stock to agent:", err);
    res.status(500).json({ error: "Error assigning stock to agent" });
  }
};


//! <--------------------SINGLE AGENT STOCK-------------------> !\\

agentStockCtrl.OwnStock = async(req,res) =>{
 
  const agentId = req.params.id;

  try{
  
    const Ownstock = await agentStock.find({agentId}) 
      .populate("cylinderId")
    
    if(Ownstock.length == 0 ){
      return res.status(200).json({Ownstock:[], totalAmount: 0});
    }
    
    const totalAmount = Ownstock.reduce((sum,s) => sum + (s.totalAmount || 0), 0);

    res.json({Ownstock, totalAmount});
  }catch(err){
    console.log(err);
    res.status(500).json({error:"something went wrong"});
  }
}

//! <--------------------ALL AGENT STOCK-------------------> !\\

agentStockCtrl.ListAll = async(req,res) => {
    try{
        const AgentStock = await agentStock.find()
        .populate("agentId","agentname ")
        .populate("cylinderId","cylinderType weight price");
        console.log(AgentStock);
        if(!AgentStock){
          return res.status(404).json({error:"agent Stock not found"})
        }
        res.status(201).json({message:"List of all agent stock availabe",AgentStock})
    }catch(err){
        console.log(err);
        res.status(500).json({error:"something went wrong"});
    }
}

//! <--------------------UPDATE STOCK-------------------> !\\

agentStockCtrl.updateStock = async (req, res) => {
  const { agentId } = req.params;
  const { cylinderId, quantity } = req.body;

  try {
    const stock = await agentStock
      .findOne({ agentId, cylinderId })
      .populate("cylinderId", "price cylinderType weight");

    if (!stock) {
      return res.status(404).json({ error: "Agent stock not found" });
    }

    const mainInventory = await inventary.findOne({ cylinderId });
    if (!mainInventory) {
      return res.status(404).json({ error: "Cylinder not found in main inventory" });
    }
    const diff = quantity - stock.quantity; 

    if (diff > 0 && mainInventory.totalQuantity < diff) {
      return res.status(400).json({ error: "Not enough stock in main inventory" });
    }

    mainInventory.totalQuantity -= diff; 
    await mainInventory.save();

    const totalAmount = stock.cylinderId.price * quantity;
    stock.quantity = quantity;
    stock.totalAmount = totalAmount;
    await stock.save();

    return res.status(200).json({
      message: "Agent stock and main inventory updated successfully",
      updatedAgentStock: stock,
      updatedMainInventory: mainInventory,
    });
  } catch (err) {
    console.error("Error updating agent stock:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

//! <-------------------- DELETE STOCK --------------------> !\\

agentStockCtrl.deleteStock = async (req, res) => {
  try {
    const { agentId, cylinderId } = req.params;
    const userRole = req.role;
    const authenticatedUserId = req.UserId;

    if (userRole === 'agent') {
      if (authenticatedUserId.toString() !== agentId.toString()) {
        return res.status(403).json({ error: "You can only delete your own stock" });
      }
    } else if (userRole !== 'admin') {
      return res.status(403).json({ error: "Only admin and agents can delete stock" });
    }

    const stock = await agentStock.findOneAndDelete({ agentId, cylinderId });
    if (!stock) {
      return res.status(404).json({ error: "Agent stock not found" });
    }

    const mainInventory = await inventary.findOne({ cylinderId });
    if (mainInventory) {
      mainInventory.totalQuantity += stock.quantity;
      mainInventory.updatedAt = Date.now();
      await mainInventory.save();
    }

    res.status(200).json({
      message: "Agent stock deleted and quantity restored to main inventory",
      restoredQuantity: stock.quantity,
      updatedInventory: mainInventory,
    });
    
  } catch (err) {
    console.error("Error deleting agent stock:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

//! <-------------------- AGENT SUMMARY --------------------> !\\

agentStockCtrl.getAgentSummary = async (req, res) => {
  const {  agentId } = req.params;

  try {
    const stocks = await agentStock.find({ agentId }).populate("cylinderId", "price");

    if (!stocks.length) {
      return res.status(404).json({ error: "No stock found for this agent" });
    }

    const totalCylinders = stocks.reduce((sum, s) => sum + s.quantity, 0);
    const totalValue = stocks.reduce((sum, s) => sum + s.totalAmount, 0);

    res.status(200).json({
      message: "Agent summary retrieved successfully",
      totalCylinders,
      totalValue,
      totalItems: stocks.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching agent summary" });
  }
};

//! <--------------------GENERATE REPORT--------------------> !\\

agentStockCtrl.generateReport = async (req, res) => {
  const {  agentId } = req.params;
  const { period } = req.query;

  try {
    const query = { agentId };
    const stocks = await agentStock
      .find(query)
      .populate("cylinderId", "cylinderType price weight");

    const totalCylinders = stocks.reduce((sum, s) => sum + s.quantity, 0);
    const totalValue = stocks.reduce((sum, s) => sum + s.totalAmount, 0);

    res.status(200).json({
      message: `${period} report generated`,
      period,
      totalCylinders,
      totalValue,
      stocks,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error generating report" });
  }
};

//! <--------------------AGENT STATS--------------------> !\\

agentStockCtrl.getStats = async (req, res) => {
  const agentId = req.UserId;

  if (!agentId) {
    return res.status(401).json({ error: "Agent ID not found" });
  }
  try {
    const stocks = await agentStock.find({ agentId }).populate("cylinderId", "price");
    
    const bookings = await Booking.find({ agent: agentId })
      .populate("cylinder", "price")
      .populate("customer", "username");

    const stockReceived = stocks.reduce((sum, stock) => sum + (stock.quantity || 0), 0);
    
    const cylindersDelivered = bookings
      .filter(b => b.status === "delivered")
      .reduce((sum, booking) => sum + (booking.quantity || 0), 0);
    
    const pendingReturns = bookings.filter((b) => !b.isReturned && b.status === "delivered").length;
    
    const amountCollected = bookings
      .filter((b) => b.paymentStatus === "paid" && b.cylinder && b.cylinder.price)
      .reduce((sum, b) => {
        const price = b.cylinder.price || 0;
        const quantity = b.quantity || 0;
        return sum + (price * quantity);
      }, 0);
    
    const pendingPayments = bookings
      .filter((b) => b.paymentStatus === "pending" && b.cylinder && b.cylinder.price)
      .reduce((sum, b) => {
        const price = b.cylinder.price || 0;
        const quantity = b.quantity || 0;
        return sum + (price * quantity);
      }, 0);

    const stats = {
      stockReceived,
      cylindersDelivered,
      pendingReturns,
      amountCollected,
      pendingPayments,
    };

    res.json(stats);
  } catch (err) {
    console.error("Error in getStats:", err);
    res.status(500).json({ error: "Failed to load dashboard data" });
  }
};

//! <--------------------GET CUSTOMER AGENT AVAILABLE CYLINDERS--------------------> !\\

agentStockCtrl.getCustomerAgentCylinders = async (req, res) => {
  try {
    const customerId = req.UserId;
    const userRole = req.role;

    if (userRole !== 'customer') {
      return res.status(403).json({ error: 'access denied' });
    }

   
    const customer = await User.findById(customerId);
    
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    if (!customer.agent) {
      return res.status(400).json({ 
        error: 'No agent assigned. Please contact admin to assign an agent.' 
      });
    }

    
    const agentStocks = await agentStock.find({ 
      agentId: customer.agent,
      quantity: { number: 0 } 
    }).populate('cylinderId', 'cylinderName cylinderType weight price');

  
    const cylinders = agentStocks.map(stock => ({
      _id: stock.cylinderId._id,
      cylinderName: stock.cylinderId.cylinderName,
      cylinderType: stock.cylinderId.cylinderType,
      weight: stock.cylinderId.weight,
      price: stock.cylinderId.price,
      totalQuantity: stock.quantity, 
    }));

    res.status(200).json({
      message: 'Available cylinders fetched successfully',
      cylinders: cylinders
    });
  } catch (err) {
    console.error('Error fetching customer agent cylinders:', err);
    res.status(500).json({ error: 'Failed to fetch available cylinders' });
  }
};

module.exports = agentStockCtrl;