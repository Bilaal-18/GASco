const { required } = require('joi');
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: String,
  businessname: String,
  vehicleNo: String,
  email: String,
  phoneNo: String,
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String
  },
  location: {
    type: {
      type: String,
      enum: ["Point"],
      default:"Point"
    },
    coordinates: {
      type: [Number],
      required:true,
      index:"2dSphere"
    }
  },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ["customer", "admin", "agent"],
    default: "customer"
  },
  agent: { type: mongoose.Schema.Types.ObjectId, ref: "user" }
}, { timestamps: true });

userSchema.index({ location: "2dSphere" })

const user = mongoose.model('user', userSchema);
module.exports = user;
