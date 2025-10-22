const Joi = require("joi");

const cylinderSchema = Joi.object({
    cylinderType:Joi.string().valid("commercial","private Commercial"),
    weight:Joi.number().min(5).max(50).required(),
    price:Joi.number().positive().required(),
    available:Joi.number().integer().min(0).default(true),
})

module.exports = cylinderSchema;