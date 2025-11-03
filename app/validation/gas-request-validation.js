const Joi = require("joi");

const gasRequestValidation = Joi.object({
  cylinderId: Joi.string().hex().length(24).required(),
  quantity: Joi.number().integer().min(1).required(),
  remarks: Joi.string().optional().allow("")
});

module.exports = gasRequestValidation;

