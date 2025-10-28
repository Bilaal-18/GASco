const jwt = require("jsonwebtoken");

const authenticateUser = (req,res,next) => {
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
        console.log(err);
        return res.status(500).json({ error:"something went wrong" })
    }
};

module.exports = authenticateUser;
