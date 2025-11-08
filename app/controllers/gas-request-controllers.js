const GasRequest = require("../models/gas-request-model");
const agentStock = require("../models/agent-stock-model");
const inventary = require("../models/inventary-model");
const gasRequestValidation = require("../validation/gas-request-validation");

const gasRequestCtrl = {};

//! <-------------------- CREATE GAS REQUEST (AGENT) --------------------> !\\

gasRequestCtrl.createRequest = async (req, res) => {
  const body = req.body;
  const agentId = req.UserId;

  const { error, value } = gasRequestValidation.validate(body, { abortEarly: false });
  if (error) {
    return res.status(400).json({ error: "Validation failed", details: error.details });
  }

  const { cylinderId, quantity, remarks } = value;

  try {
    const existingRequest = await GasRequest.findOne({
      agentId,
      cylinderId,
      status: "pending"
    });

    if (existingRequest) {
      return res.status(400).json({ 
        error: "You already have a pending request for this cylinder. Please wait for admin approval." 
      });
    }

    const gasRequest = new GasRequest({
      agentId,
      cylinderId,
      quantity,
      remarks: remarks || ""
    });

    await gasRequest.save();
    await gasRequest.populate("cylinderId", "cylinderType weight price cylinderName");
    await gasRequest.populate("agentId", "agentname email");

    res.status(201).json({
      message: "Gas request submitted successfully",
      request: gasRequest
    });
  } catch (err) {
    console.error("Error creating gas request:", err);
    res.status(500).json({ error: "Error creating gas request" });
  }
};

//! <-------------------- GET ALL REQUESTS (ADMIN) --------------------> !\\

gasRequestCtrl.getAllRequests = async (req, res) => {
  try {
    const { status } = req.query;
    
    const query = {};
    if (status && ["pending", "approved", "rejected"].includes(status)) {
      query.status = status;
    }

    const requests = await GasRequest.find(query)
      .populate("agentId", "agentname email phoneNo")
      .populate("cylinderId", "cylinderType weight price cylinderName")
      .sort({ createdAt: -1 });

    res.status(200).json({
      message: "Gas requests retrieved successfully",
      requests
    });
  } catch (err) {
    console.error("Error fetching gas requests:", err);
    res.status(500).json({ error: "Error fetching gas requests" });
  }
};

//! <-------------------- GET AGENT'S REQUESTS --------------------> !\\

gasRequestCtrl.getAgentRequests = async (req, res) => {
  const agentId = req.UserId;

  try {
    const requests = await GasRequest.find({ agentId })
      .populate("cylinderId", "cylinderType weight price cylinderName")
      .sort({ createdAt: -1 });

    res.status(200).json({
      message: "Agent gas requests retrieved successfully",
      requests
    });
  } catch (err) {
    console.error("Error fetching agent gas requests:", err);
    res.status(500).json({ error: "Error fetching agent gas requests" });
  }
};

//! <-------------------- APPROVE REQUEST (ADMIN) --------------------> !\\

gasRequestCtrl.approveRequest = async (req, res) => {
  const { requestId } = req.params;

  try {
    const request = await GasRequest.findById(requestId)
      .populate("cylinderId", "price cylinderType weight");

    if (!request) {
      return res.status(404).json({ error: "Gas request not found" });
    }

    if (request.status !== "pending") {
      return res.status(400).json({ error: `Request is already ${request.status}` });
    }

    if (!request.cylinderId || !request.cylinderId._id) {
      return res.status(400).json({ error: "Cylinder information not found for this request" });
    }
    const inventory = await inventary.findOne({ cylinderId: request.cylinderId._id });

    if (!inventory || inventory.totalQuantity < request.quantity) {
      return res.status(400).json({ 
        error: "Insufficient stock in inventory to fulfill this request" 
      });
    }
    inventory.totalQuantity -= request.quantity;
    await inventory.save();

    const totalAmount = request.cylinderId.price * request.quantity;

    let agentStockDoc = await agentStock.findOne({ 
      agentId: request.agentId, 
      cylinderId: request.cylinderId._id 
    });

    if (agentStockDoc) {
      agentStockDoc.quantity += request.quantity;
      agentStockDoc.totalAmount += totalAmount;
      await agentStockDoc.save();
    } else {
      agentStockDoc = new agentStock({
        agentId: request.agentId,
        cylinderId: request.cylinderId._id,
        quantity: request.quantity,
        totalAmount: totalAmount,
      });
      await agentStockDoc.save();
    }

    request.status = "approved";
    request.reviewedAt = new Date();
    await request.save();

    await agentStockDoc.populate("cylinderId", "cylinderType weight price");

    res.status(200).json({
      message: "Gas request approved and stock assigned successfully",
      request: request,
      agentStock: agentStockDoc
    });
  } catch (err) {
    console.error("Error approving gas request:", err);
    res.status(500).json({ error: "Error approving gas request" });
  }
};

//! <-------------------- REJECT REQUEST (ADMIN) --------------------> !\\

gasRequestCtrl.rejectRequest = async (req, res) => {
  const { requestId } = req.params;
  const { remarks } = req.body;

  try {
    const request = await GasRequest.findById(requestId);

    if (!request) {
      return res.status(404).json({ error: "Gas request not found" });
    }

    if (request.status !== "pending") {
      return res.status(400).json({ error: `Request is already ${request.status}` });
    }

    request.status = "rejected";
    request.reviewedAt = new Date();
    if (remarks) {
      request.remarks = remarks;
    }
    await request.save();

    res.status(200).json({
      message: "Gas request rejected successfully",
      request: request
    });
  } catch (err) {
    console.error("Error rejecting gas request:", err);
    res.status(500).json({ error: "Error rejecting gas request" });
  }
};

module.exports = gasRequestCtrl;

