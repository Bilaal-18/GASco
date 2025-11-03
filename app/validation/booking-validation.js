import Joi from "joi";

const bookingValidation = Joi.object({
    type:{
        customer:Joi.string().hex().length(24).required(),
        cylinder:Joi.string().hex().length(24).required(),
        quantity:Joi.number().integer().min(1),
        totalPrice:Joi.number().integer(),
        status:Joi.string().valid("pending","confirmed","delivered","cancelled").default("pending"),
        paymentStatus:Joi.string().valid("pending","paid").default("pending")
        
    }
})

module.exports = bookingValidation;
 