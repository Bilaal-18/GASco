const authorizeUser = (roles) => {
    return (req,res,next) => {
        
        //const rolesArray = Array.isArray(roles) ? roles : [roles];
        if(roles.includes(req.role)){
            next();
        }else{
            res.status(403).json({error:"Unauthorized Access"});
        }
    }
}

module.exports = authorizeUser;
