const Joi = require("joi")


const userSchema = Joi.object({
    username:Joi.string().trim().required().min(4).max(64),
    businessname:Joi.string().trim().min(4).max(64).optional(),
    email:Joi.string().trim().required().email().lowercase(),
    phoneNo:Joi.string().pattern(/^[0-9]{10}$/).required(),
    address:Joi.object({
        street:Joi.string().optional(),
        city:Joi.string().optional(),
        state:Joi.string().optional(),
        pincode:Joi.string().pattern(/^[0-9]{6}$/).optional()
        }).required(),location:Joi.object({
            type:Joi.string().valid("Point").default("Point"),
            coordinates:Joi.array().items(Joi.number()).length(2)
        }),
        password:Joi.string().min(8).max(128).required(),

        role:Joi.string().trim().required().valid("customer"),
        agent:Joi.string().hex().length(24).required()
});

const agentSchema = Joi.object({
    agentname:Joi.string().trim().required().min(4).max(64),
    email:Joi.string().email().trim().required().lowercase(),
    password:Joi.string().min(8).max(128).required(),
    vehicleNo:Joi.string().required(),
      address:Joi.object({
        street:Joi.string().optional(),
        city:Joi.string().optional(),
        state:Joi.string().optional(),
        pincode:Joi.string().pattern(/^[0-9]{6}$/).optional()
        }),
    phoneNo:Joi.string().pattern(/^[0-9]{10}$/).required(),
    role:Joi.string().trim().required().valid("agent")
    
});

const adminSchema = Joi.object({
    adminName:Joi.string().trim().required().min(4).max(64),
    phoneNo:Joi.string().pattern(/^[0-9]{10}$/).required(),
    email:Joi.string().email().required().trim().lowercase(),
    password:Joi.string().min(8).max(128).required(),
    role:Joi.string().trim().required().valid("admin")
}) 

const userLoginSchema = Joi.object({
    email:Joi.string().email().trim().required().lowercase(),
    password:Joi.string().trim().required().min(8).max(128)
});
module.exports={
    userLoginSchema,
    adminSchema,
    agentSchema,
    userSchema
};
