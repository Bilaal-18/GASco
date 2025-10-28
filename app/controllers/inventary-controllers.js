const inventary = require("../models/inventary-model");
const validateInventary = require("../validation/inventary-validation");
const Cylinder = require("../models/cylinder-model");
const agentStock = require("./agent-stock-controllers");


const inventaryCtrl = {};

//! <--------------------CREATE INVENTARY--------------------> !\\

inventaryCtrl.addStock = async(req,res) => {
    const body = req.body;
    const {error,value} = validateInventary.validate(body);

    if(error){
        console.log(error);
        return res.status(400).json({ error:"validation failure" });
    }
    try{
        const cylinder = await Cylinder.findById(value.cylinderId);
        if(!cylinder){
            return res.status(400).json({message:"cylinder not found"});
        }
        const stock = await inventary.create(value);
        res.status(201).json({messaage:"stock added successfully",stock});
    }catch(err){
        console.log(err);
        res.status(500).json({error:"something went wrong"});;

    }
}

//! <--------------------ALL INVENTARY--------------------> !\\

inventaryCtrl.all = async (req,res) => {
    try{
        const Inventary = await inventary.find().populate("cylinderId","cylinderName cylinderType weight price totalQuantity");
        if(!Inventary){
            return res.status(404).json({error:"Inventary Not Available"})
        }
        res.status(200).json({message:"List of inventary",Inventary});
    }catch(err){
        console.log(err);
        res.status(500).json({error:"something went wrong"});
    }
}

//! <--------------------UPDATE INVENTARY--------------------> !\\

inventaryCtrl.update = async(req,res) => {
    const id = req.params.id;
    const {totalQuantity} = req.body;
    try{
        const updateInventary = await inventary.findByIdAndUpdate(id,{
            totalQuantity,
            updatedAt:Date.now()},
            {new:true}
        )
        if(!updateInventary){
            return res.status(400).json({message:"inventary not available"})
        }
        res.status(200).json({message : "Inventary updated successfully",updateInventary});
    }catch(err){
        console.log(err);
        res.status(500).json({error:"something went wrong"});
    }
}

//! <--------------------DELETE INVENTARY--------------------> !\\

inventaryCtrl.delete = async(req,res) => {
    const id = req.params.id;
    try{
        const Inventary = await inventary.findByIdAndDelete(id);
        await agentStock.DeleteMany({cylinder:id});
        res.status(200).json({message:"inventary successfully deleted",Inventary}); 
    }catch(err){
        console.log(err);
        res.status(500).json({error:"something went wrong"});
    }
}

module.exports = inventaryCtrl;
