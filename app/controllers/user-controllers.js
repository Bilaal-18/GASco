const user = require('../models/user-model');
const {userSchema,agentSchema,adminSchema,userLoginSchema} = require('../validation/user-validation');
const bcryptjs= require("bcryptjs");
const jwt = require('jsonwebtoken');
const axios = require('axios');
const userCtrl={};

//! <-------------------- REGISTER --------------------> !\\

userCtrl.register = async (req, res) => {
  const body = req.body;
  let validationSchema;

  if (body.role == "customer") validationSchema = userSchema;
  else if (body.role == "agent") validationSchema = agentSchema;
  else if (body.role == "admin") validationSchema = adminSchema;
  else return res.status(400).json({ message: "Invalid role" });

  const { error, value } = validationSchema.validate(body, { abortEarly: false });
  if (error) return res.status(400).json({ error: error.details });

  try{

  if (value.role === "admin") {
    const existingAdmin = await user.findOne({ role: "admin" });
    if (existingAdmin) return res.status(400).json({ error: "Admin already exists" });
  }

  const userByEmail = await user.findOne({ email: value.email });
  if (userByEmail) return res.status(400).json({ error: "Email already taken" });

  let newUserData = {...value}

    if(value.role == "customer"){
        if(!value.agent){
            return res.status(400).json({error:"agent should be assigned to customer"})
        }

    const assignedAgent = await user.findOne({ _id: value.agent, role: "agent" });

      if (!assignedAgent) {
        return res.status(400).json({ error: "Invalid or non-existent agent ID" });
      }

        const fullAddress = `${value.address.street}, ${value.address.city}, ${value.address.state}, ${value.address.pincode}`;


    const geoResponse = await axios.get("https://geocode.maps.co/search", {
    params: {
        q: fullAddress,
        api_key:process.env.API_KEY
    }
    });
    console.log(geoResponse);

    if (!geoResponse.data || geoResponse.data.length === 0) {
    return res.status(400).json({ error: "Unable to geocode address" });
    }

    const { lat, lon } = geoResponse.data[0];

    newUserData.location= {
        ...value,
        type: "Point",
        coordinates: [parseFloat(lon), parseFloat(lat)] 
    }
        newUserData.agent = assignedAgent._id;
    } 
    const salt = await bcryptjs.genSalt();
    newUserData.password = await bcryptjs.hash(value.password, salt);

    const newUser =new user(newUserData)
    await newUser.save();

    res.status(201).json({ message: "User registered successfully", user: newUser});

  } catch (err) {
    console.error("Error during registration:", err);
    res.status(500).json({ error: "Something went wrong during registration" });
  }
};


 //! <-------------------- LOGIN --------------------> !\\

 userCtrl.login =async (req,res) => {
    const {error,value} = userLoginSchema.validate(req.body,{abortEarly:false});
    if(error){
       return res.status(400).json({ error: error.details });
    }
    try{
        const User = await user.findOne({ email:value.email });
        if(!User){
           return  res.status(401).json({ error:"invalid email / password" });
        }

        const passwordMatch = await bcryptjs.compare(value.password,User.password);
    
        if(!passwordMatch){
           return res.status(401).json({ error : "invalid email / password"})
        }
        const tokenData = {
            UserId :User._id,
            role:User.role
        };
        const token = jwt.sign(tokenData,process.env.JWT_SECRET,{
            expiresIn:"30d",
        });
        return  res.status(201).json({
            message:"login Successfull",
            token,
            role:User.role
        });
    }catch(err){
     return res.status(500).json({ error:"something went wrong!!!" })
    }
}

 //! <--------------------TOTAL CUSTOMERS --------------------> !\\

userCtrl.customers = async(req,res) => {
    try{
        const customers = await user.find({role:"customer"}).populate("agent","agentname phoneNo email");
        res.status(201).json(customers);

    }catch(err){
        console.log(err);
        res.status(500).json({error:"customer not found"})
    }
}

//! <--------------------TOTAL AGENTS --------------------> !\\

userCtrl.agent = async(req,res) => {
    try{
        const agents = await user.find({ role: "agent" }, "agentname email phoneNo vehicleNo address");

        res.status(201).json(agents);
    }catch(err){
        console.log(err);
        res.status(500).json({error:"agent not found"});
    }
}

//! <--------------------FIND ACCOUNT --------------------> !\\

userCtrl.account = async (req,res) => {
    //const body = req.params.id;
    try{
        const User = await user.findById(req.UserId);
        res.json(User);
    }catch(err){
        console.log(err);
        res.status(500).json({error:"something went wrong"})
    }
}

//! <--------------------UPDATE PASSWORD--------------------> !\\

userCtrl.UpdatePassword = async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const id = req.params.id;

    try {
        const users = await user.findByIdAndUpdate(id);
        if (!users) {
            return res.status(404).json({ error: "User not found" });
        }

        const passwordMatch = await bcryptjs.compare(oldPassword, users.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Incorrect old password" });
        }

        const sameAsOld = await bcryptjs.compare(newPassword, users.password);
        if (sameAsOld) {
            return res.status(400).json({ error: "Old and new passwords cannot be the same" });
        }

        const salt = await bcryptjs.genSalt();
        const hashedPassword = await bcryptjs.hash(newPassword, salt);
        users.password = hashedPassword;
        await users.save();

        res.status(200).json({ message: "Password updated successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Something went wrong!" });
    }
};

//! <--------------------DELETE AGENT--------------------> !\\

userCtrl.removeAgent = async (req,res) => {
    const id = req.params.id;
    try{
        const deleteUser = await user.findByIdAndDelete(id);
        if(!deleteUser){
            return res.status(404).json({error:"user not found"});
        }
        res.status(200).json({message:"user deleted successfully"});
    }catch(err){
        console.log(err);
        res.status(500).json({error:"something went wrong"})
    }
};

//! <--------------------UPDATE AGENT--------------------> !\\

userCtrl.updateAgent = async (req, res) => {
    const id = req.params.id;
    const userId = req.UserId;
    const userRole = req.role;
    const body = req.body;
    
    try {
        // Allow agents to update only their own profile, admins can update any agent
        if (userRole === "agent" && userId.toString() !== id.toString()) {
            return res.status(403).json({ error: "You can only update your own profile" });
        }
        
        const existingAgent = await user.findById(id);
        if (!existingAgent || existingAgent.role !== "agent") {
            return res.status(404).json({ error: "Agent not found" });
        }

        // Check if email is being updated and if it's already taken
        if (body.email && body.email !== existingAgent.email) {
            const emailExists = await user.findOne({ email: body.email });
            if (emailExists) {
                return res.status(400).json({ error: "Email already taken" });
            }
        }

        let updateData = { ...body };

        // If address is being updated, geocode it
        if (body.address && (body.address.street || body.address.city || body.address.state || body.address.pincode)) {
            const addressData = {
                street: body.address.street || existingAgent.address?.street || "",
                city: body.address.city || existingAgent.address?.city || "",
                state: body.address.state || existingAgent.address?.state || "",
                pincode: body.address.pincode || existingAgent.address?.pincode || ""
            };

            const fullAddress = `${addressData.street}, ${addressData.city}, ${addressData.state}, ${addressData.pincode}`;
            
            try {
                const geoResponse = await axios.get("https://geocode.maps.co/search", {
                    params: {
                        q: fullAddress,
                        api_key: process.env.API_KEY
                    }
                });

                if (geoResponse.data && geoResponse.data.length > 0) {
                    const { lat, lon } = geoResponse.data[0];
                    updateData.location = {
                        type: "Point",
                        coordinates: [parseFloat(lon), parseFloat(lat)]
                    };
                }
            } catch (geoErr) {
                console.error("Geocoding error:", geoErr);
                // Continue without location update if geocoding fails
            }
            
            updateData.address = addressData;
        }

        // If password is being updated, hash it
        if (body.password && body.password.trim() !== "") {
            const salt = await bcryptjs.genSalt();
            updateData.password = await bcryptjs.hash(body.password, salt);
        } else {
            // Remove password from updateData if not provided
            delete updateData.password;
        }

        // Don't allow role or agent field to be updated through this endpoint
        delete updateData.role;
        delete updateData.agent;

        const updatedAgent = await user.findByIdAndUpdate(id, updateData, { new: true });
        res.status(200).json({ message: "Agent updated successfully", agent: updatedAgent });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Something went wrong" });
    }
};

//! <--------------------UPDATE CUSTOMER--------------------> !\\

userCtrl.updateCustomer = async (req, res) => {
    const id = req.params.id;
    const body = req.body;
    
    try {
        const existingCustomer = await user.findById(id);
        if (!existingCustomer || existingCustomer.role !== "customer") {
            return res.status(404).json({ error: "Customer not found" });
        }

        // Check if email is being updated and if it's already taken
        if (body.email && body.email !== existingCustomer.email) {
            const emailExists = await user.findOne({ email: body.email });
            if (emailExists) {
                return res.status(400).json({ error: "Email already taken" });
            }
        }

        let updateData = { ...body };

        // If agent is being updated, validate it exists
        if (body.agent) {
            const assignedAgent = await user.findOne({ _id: body.agent, role: "agent" });
            if (!assignedAgent) {
                return res.status(400).json({ error: "Invalid or non-existent agent ID" });
            }
            updateData.agent = assignedAgent._id;
        }

        // If address is being updated, geocode it
        if (body.address && (body.address.street || body.address.city || body.address.state || body.address.pincode)) {
            const addressData = {
                street: body.address.street || existingCustomer.address?.street || "",
                city: body.address.city || existingCustomer.address?.city || "",
                state: body.address.state || existingCustomer.address?.state || "",
                pincode: body.address.pincode || existingCustomer.address?.pincode || ""
            };

            const fullAddress = `${addressData.street}, ${addressData.city}, ${addressData.state}, ${addressData.pincode}`;
            
            try {
                const geoResponse = await axios.get("https://geocode.maps.co/search", {
                    params: {
                        q: fullAddress,
                        api_key: process.env.API_KEY
                    }
                });

                if (geoResponse.data && geoResponse.data.length > 0) {
                    const { lat, lon } = geoResponse.data[0];
                    updateData.location = {
                        type: "Point",
                        coordinates: [parseFloat(lon), parseFloat(lat)]
                    };
                }
            } catch (geoErr) {
                console.error("Geocoding error:", geoErr);
                // Continue without location update if geocoding fails
            }
            
            updateData.address = addressData;
        }

        // If password is being updated, hash it
        if (body.password) {
            const salt = await bcryptjs.genSalt();
            updateData.password = await bcryptjs.hash(body.password, salt);
        }

        const updatedCustomer = await user.findByIdAndUpdate(id, updateData, { new: true });
        res.status(200).json({ message: "Customer updated successfully", customer: updatedCustomer });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Something went wrong" });
    }
};

//! <--------------------DELETE CUSTOMER--------------------> !\\

userCtrl.remove = async (req,res) => {
    const id = req.params.id;
    try{
        const deleteCustomer = await user.findByIdAndDelete(id)
        if(!deleteCustomer){
            return res.status(404).json({error:"user not found"})
        }
        res.status(200).json({message:"user deleted successfully"});
    }catch(err){
        console.log(err);
        res.status(500).json({error:"something went wrong"})
    }
};

//! <--------------------SINGLE AGENT-CUSTOMER-------------------> !\\

userCtrl.agentCustomers = async (req, res) => {
  try {
    const agentId = req.params.id;
    const customers = await user.find({ agent: agentId, role: "customer" }).select(
      "username email phoneNo address location"
    );

    res.status(200).json({ customers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
};

 module.exports = userCtrl;