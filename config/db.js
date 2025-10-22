const mongoose = require('mongoose');

async function configureDB(){
    try{
        await mongoose.connect(process.env.DB_URL);
        console.log('connected to DB')
    }catch(err){
        console.log('error connceting to DB',err.message)
    }
}

module.exports =configureDB;