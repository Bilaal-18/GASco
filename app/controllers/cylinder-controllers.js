const Cylinder = require("../models/cylinder-model");
const cylinderSchema  = require("../validation/cylinder-validation");

const cylinderCtrl={};

//! <--------------------Create Cylinder--------------------> !\\

cylinderCtrl.createCylinder = async(req,res) => {
    const body = req.body;

    try{
        const {error,value} = cylinderSchema.validate(body,{abortEarly: false });
        if(error){
           return res.status(400).json({error:error.details})
        }
        const cylinder = new Cylinder(value);
        await cylinder.save();
        res.json(cylinder);
    }catch(err){
        console.log(err);
        res.status(500).json({error:"something went wrong"});
    }
}

//! <--------------------LIST OF CYLINDERS--------------------> !\\

cylinderCtrl.listcylinder = async (req,res) => {
    try{
        const cylinder = await Cylinder.find();
        res.status(200).json(cylinder);
    }catch(err){
        console.log(err);
        res.status(500).json({error:"something went wrong"});
    }
}

//! <--------------------LIST TYPE SPERATELY--------------------> !\\

cylinderCtrl.typecylinder = async (req,res) => {
    const type = req.query.type;
    if(!type){
        return res.status(400).json({error:"type is required" })
    }
    try{
        const cylinder = await Cylinder.find({cylinderType: type });
        res.status(201).json(cylinder);
    }catch(err){
        console.log(err);
        res.status(500).json({error:"something went wrong"})
    }
}

//! <--------------------UPDATE CYLINDER--------------------> !\\

cylinderCtrl.update = async (req,res) => {
    const id = req.params.id;
    if(!type){
        return res.status(400).json({error:"type is required" });
    }
    try{
        const cylinder = await Cylinder.findByIdAndUpdate(id);
        res.status(200).json(cylinder);
    }catch(err){
        console.log(err);
        res.status(500).json({error:"something went wrong"});
    }
}

//! <--------------------DELETE CYLINDER--------------------> !\\
cylinderCtrl.delete = async (req,res) => {
    const id = req.params.id;
    try{
        const deleteCylinder = await Cylinder.findByIdAndDelete(id);
        if(!deleteCylinder){
           return res.status(404).json({error:"cylinder not available"});
        }
        res.status(200).json(deleteCylinder);
    }catch(err){
        console.log(err);
        res.status(500).json({error:"something went wrong"});
    }
}

module.exports = cylinderCtrl;
