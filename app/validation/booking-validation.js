import Joi from "joi";

const bookingValidation = Joi.object({
    type:{
        customer:Joi.string().hex().length(24).required(),
        cylinder:Joi.string().hex().length(24).required(),
        quantity:Joi.number().integer().min(1).required(),
        status:Joi.string().valid("pending","consfirmed","delivered","cancelled").default("pending"),
        deliveryDate:Joi.date().optional()
    }
})

module.exports = bookingValidation;
 