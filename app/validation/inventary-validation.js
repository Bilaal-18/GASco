const Joi = require("joi");

const validateInventary = Joi.object({
    cylinderId :Joi.string().hex().length(24).required(),
    totalQuantity:Joi.number().integer().min(0).default(0)
})

module.exports = validateInventary;
