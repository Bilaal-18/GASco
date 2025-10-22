import Joi from "joi";

const agentStockValidation = Joi.object({
    agentId:Joi.string().hex().length(24).required(),
    cylinderId:Joi.string().hex().length(24).required(),
    quantity:Joi.number().integer().min(0).required()
})

module.exports = agentStockValidation;
