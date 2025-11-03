const Joi=require("joi");

const agentStockValidation = Joi.object({
    agentId:Joi.string().hex().length(24).required(),
    cylinderId:Joi.string().hex().length(24).required(),
    quantity:Joi.number().integer().min(0).required(),
    totalAmount:Joi.number().integer().optional(),
    paymentStatus:Joi.string().valid("pending","paid","partial").default("pending"),
    period:Joi.string().valid("daily","monthly")
})

module.exports = agentStockValidation;
