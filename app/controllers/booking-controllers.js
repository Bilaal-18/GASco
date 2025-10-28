
const Booking = require("../models/booking-model");
const Cylinder = require("../models/cylinder-model");
const User = require("../models/user-model");
const AgentStock = require("../models/agent-stock-model");



const bookingCtrl = {};

//! <--------------------Create Booking--------------------> !\\

bookingCtrl.NewBooking = async(req,res) => {
    try{
        
        const {quantity, cylinderId} = req.body;
        const customerId = req.UserId;
        console.log(customerId);

        const customer = await User.findById(customerId).populate("agent");
        if(!customer){
            return res.status(404).json({error:"customer not found"})
        }

        const agent = customer.agent;
        
        console.log(agent);
        if(!agent){
            return res.status(404).json({error:"agent not assigned to customer"})
        }
        const cylinder = await Cylinder.findById(cylinderId);
        if(!cylinder){
            return res.status(404).json({error:"cylinder not found"})
        }
   
        console.log(cylinderId);

       
        
        const agentStock = await AgentStock.findOne({
            agentId:agent._id,
            cylinderId
        })
        console.log(agentStock)
        
        if(!agentStock || agentStock.quantity < quantity){
            return res.status(404).json({error:"selected quantity not avalilable"});
        }


        const booking = new Booking({
            customer:customerId,
            agent:agent._id,
            cylinder:cylinderId,
            quantity,
            status:"pending"   
        }) 

        await booking.save();
         agentStock.quantity -= quantity;
        agentStock.lastUpdated = Date.now()
        await agentStock.save();

        res.status(201).json({message:"Booking made successfully",
            booking
        })
    }catch(err){
        console.log(err);
        res.status(400).json({ error:"error making the booking "})
    }

}

module.exports= bookingCtrl;