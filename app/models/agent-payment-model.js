
const mongoose = require('mongoose');

const agentPaymentSchema = new mongoose.Schema({

  agent: {
    type: mongoose.Schema.Types.ObjectId,  
    ref: 'user',                           
    required: true                         
  },
  admin: {
    type: mongoose.Schema.Types.ObjectId,  
    ref: 'user',                            
    required: true                          
  },
  amount: {
    type: Number,   
    required: true, 
    min: 0          
  },
  method: {
    type: String,                           
    enum: ['cash', 'online'],            
    required: true                          
  },
  status: {
    type: String,                                   
    enum: ['pending', 'completed', 'failed'],       
    default: 'pending'                              
  },
  description: {
    type: String,                          
    default: 'Payment to admin'            
  },
  razorpayOrderId: {
    type: String 
  },
  razorpayPaymentId: {
    type: String  
  },
  razorpaySignature: {
    type: String  
  },
  transactionID: {
    type: String  
  },
  paymentDate: {
    type: Date,            
    default: Date.now       
  },
  notes: {
    type: String  
  },
  stockIds: [{
    type: mongoose.Schema.Types.ObjectId,  
    ref: 'agentStock'                      
  }]
}, { timestamps: true }); 


module.exports = mongoose.model('AgentPayment', agentPaymentSchema);
