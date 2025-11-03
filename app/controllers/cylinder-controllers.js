const Cylinder = require("../models/cylinder-model");
const cylinderSchema  = require("../validation/cylinder-validation");

const cylinderCtrl={};

//! <--------------------Create Cylinder--------------------> !\\

cylinderCtrl.createCylinder = async(req,res) => {
    const body = req.body;

    try{
        const {error,value} = cylinderSchema.validate(body,{abortEarly: false });
        if(error){
            console.log(error);
           return res.status(400).json({error:error.message})
        }
        const cylinder = new Cylinder(value);
        await cylinder.save();
        res.json(cylinder);
    }catch(err){
        console.log(err);
        res.status(500).json({err:"something went wrong"});
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
    const {type,Name }= req.query;
    if(!type && !Name){
        return res.status(400).json({error:"type or name is required" })
    }
    try{

        const query ={};
        if(type) query.cylinderType = type;
        if(Name) query.cylinderName = Name;

        const cylinder = await Cylinder.find(query);

        if(cylinder.length == 0){
            return res.status(404).json({error:"cylinder not avaliable"});
        }
        res.status(201).json(cylinder);
    }catch(err){
        console.log(err);
        res.status(500).json({error:"something went wrong"})
    }
}

//! <--------------------UPDATE CYLINDER--------------------> !\\

cylinderCtrl.update = async (req,res) => {
    const id = req.params.id;
    const body = req.body;
    try{
        const cylinder = await Cylinder.findByIdAndUpdate(id,body,{new:true});
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
