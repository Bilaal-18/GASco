const authorizeUser = (roles) => {
    return (req,res,next) => {
        console
        if(roles.includes(req.role)){
            next();
        }else{
            res.status(403).json({error:"Unauthorized Access"});
        }
    }
}

module.exports = authorizeUser;
