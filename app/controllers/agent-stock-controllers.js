const inventary = require("../models/inventary-model");
const agentStock = require("../models/agent-stock-model"); 
const cylinder = require("../models/cylinder-model");
const Booking = require("../models/booking-model")
const agentStockValidation = require("../validation/agent-stock-validation");
const { Agent } = require("http");

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
    await agentStockDoc.populate("cylinderId", "cylinderType weight price");

    const allAgentStock = await agentStock
      .find({ agentId })
      .populate("cylinderId", "cylinderType weight price");

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
  const agentId = req.params.id || req.UserId; // Support both params and authenticated user
  const authenticatedAgentId = req.UserId;
  
  // If using params, check if agent is accessing their own stock or is admin
  if (req.params.id && authenticatedAgentId.toString() !== agentId.toString()) {
    // Allow if admin, otherwise restrict to own stock
    // This will be handled by authorization middleware
  }
  
  try{
    const finalAgentId = req.params.id || authenticatedAgentId;
    const Ownstock = await agentStock.find({agentId: finalAgentId}).populate("cylinderId","cylinderType weight price");
    
    if(Ownstock.length == 0 ){
      return res.status(200).json({Ownstock: [], totalAmount: 0});
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
  const agentId = req.UserId; // Get agent ID from authenticated user

  if (!agentId) {
    return res.status(401).json({ error: "Agent ID not found" });
  }

  try {
    // Get agent stocks
    const stocks = await agentStock.find({ agentId }).populate("cylinderId", "price");
    
    // Get agent bookings with populated data
    const bookings = await Booking.find({ agent: agentId })
      .populate("cylinder", "price")
      .populate("customer", "username");

    // Calculate stock received
    const stockReceived = stocks.reduce((sum, stock) => sum + (stock.quantity || 0), 0);
    
    // Calculate cylinders delivered (only delivered status)
    const cylindersDelivered = bookings
      .filter(b => b.status === "delivered")
      .reduce((sum, booking) => sum + (booking.quantity || 0), 0);
    
    // Calculate pending returns (delivered but not returned)
    const pendingReturns = bookings.filter((b) => !b.isReturned && b.status === "delivered").length;
    
    // Calculate payment stats from bookings
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

    console.log(`Stats for agent ${agentId}:`, stats);
    console.log(`Found ${stocks.length} stocks and ${bookings.length} bookings`);

    res.json(stats);
  } catch (err) {
    console.error("Error in getStats:", err);
    res.status(500).json({ error: "Failed to load dashboard data" });
  }
};

module.exports = agentStockCtrl;