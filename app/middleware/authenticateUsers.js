const jwt = require("jsonwebtoken");

const authenticateUser = (req,res,next) => {
    if (req.method === 'OPTIONS') {
        return next();
    }
    
    const token = req.headers["authorization"];
    if(!token){
       return res.status(401).json({error:"token not provided" });
    }
    try{
        let tokenData = jwt.verify(token,process.env.JWT_SECRET) ;
        console.log("tokenData",tokenData);
        req.UserId = tokenData.UserId;
        req.role = tokenData.role;
        next();
    }catch(err){
        console.error("JWT verification error:", err);
        return res.status(401).json({ error:"Invalid or expired token" })
    }
};

module.exports = authenticateUser;
