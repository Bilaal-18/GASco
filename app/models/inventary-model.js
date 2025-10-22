
const { date } = require('joi');
const mongoose = require('mongoose');
const { ref } = require('process');

const inventarySchema = new mongoose.Schema({
    cylinderId :{type:mongoose.Schema.Types.ObjectId, ref:"cylinder", required:true},
    totalQuantity:{type:Number,
        default:0
    },
    updatedAt:{type:Date,default:Date.now()}
}) 

module.exports= mongoose.model("inventary",inventarySchema);
