const inventary = require("../models/inventary-model");
const agentStock = require("../models/agent-stock-model"); 
const cylinder = require("../models/cylinder-model");
const agentStockValidation = require("../validation/agent-stock-validation");

const agentStockCtrl = {};

//! <--------------------ADD AGENT STOCK-------------------> !\\

agentStockCtrl.addStock = async(req,res) => {
    const body = req.body;

    const {error,value} = agentStockValidation.validate(body,{abortEarly:false});
    if(error){
      return res.status(404).json({error:"validation failed"});
    }

    const {cylinderId,agentId,quantity} = value;
    
    try{
        const Inventary = await inventary.findOne({cylinderId});
        if(!Inventary || Inventary.totalQuantity < quantity ){
            return res.status(400).json({error:"Stock not avaliable"});
        }
        
        Inventary.totalQuantity -= quantity;
        await Inventary.save();

        let AgentStock = await agentStock.findOne({agentId,cylinderId});
        if(AgentStock){
            AgentStock.quantity += quantity;
            await AgentStock.save()
        }else{
            AgentStock = new agentStock({agentId,cylinderId,quantity});
            await AgentStock.save();
        }
        await AgentStock.populate("cylinderId","cylinderType weight price");

        const allAgentStock = await agentStock.find({agentId}).populate("cylinderId", "cylinderType weight price");
        res.status(201).json({message:"stock assigned to agent",newlyAdded:AgentStock,allAgentStock});
    }catch(err){
        console.log(err);
        res.status(500).json({error:"error assigning stock"})
    }
};

//! <--------------------SINGLE AGENT STOCK-------------------> !\\

agentStockCtrl.OwnStock = async(req,res) =>{
  const {agentId} = req.params;
  try{
  
    const Ownstock = await agentStock.find(agentId).populate("cylinderId","cylinderType weight price");
    console.log(Ownstock);
    if(!Ownstock || Ownstock.length == 0 ){
      return res.status(404).json({error:"no stock found "});
    }
    res.json(Ownstock);
  }catch(err){
    console.log(err);
    res.status(404).json({error:"something went wrong"});
  }
}

//! <--------------------ALL AGENT STOCK-------------------> !\\

agentStockCtrl.ListAll = async(req,res) => {
    try{
        const Agents = await agentStock.find().populate("cylinderId","cyliderType weight price available");
        const groupByAgent = Agents.reduce((acc,stock) => {
            const agentId = stock.agentId;
            
            if(!acc[agentId]){
                acc[agentId] = {agentId,stocks:[]}
            }
            acc[agentId].stocks.push({
                cylinderId:stock.cylinderId._id,
                cylinderType:stock.cylinderId.cylinderType,
                weight:stock.cylinderId.weight,
                price:stock.cylinderId.price,
                quantity:stock.quantity
            });
            return acc;


        },{})
        res.status(200).json(groupByAgent);
    }catch(err){
        console.log(err);
        res.status(500).json({error:"something went wrong"});
    }
}

//! <--------------------UPDATE STOCK-------------------> !\\

agentStockCtrl.updateStock = async (req, res) => {
    const { agentId } = req.params;
    const {cylinderId,quantity}= req.body;

  try {
    const stock = await agentStock.findOne({ agentId, cylinderId });
    if (!stock) {
      return res.status(404).json({ error: "Agent stock not found" });
    }

    const mainInventory = await inventary.findOne({ cylinderId });
    if (!mainInventory) {
      return res.status(404).json({ error: "Cylinder not found in main inventory" });
    }

    const diff = quantity - stock.quantity;

    stock.quantity = quantity;
    await stock.save();

    mainInventory.totalQuantity -= diff;
    if (mainInventory.totalQuantity < 0) mainInventory.totalQuantity = 0;
    mainInventory.updatedAt = Date.now();
    await mainInventory.save();

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

module.exports = agentStockCtrl;