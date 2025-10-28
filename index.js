const express = require('express') ;
const configureDB = require('./config/db');

const  userCtrl  = require('./app/controllers/user-controllers');
const cylinderCtrl = require('./app/controllers/cylinder-controllers');
const inventaryCtrl = require("./app/controllers/inventary-controllers");
const agentStockCtrl = require('./app/controllers/agent-stock-controllers');
const bookingCtrl = require("./app/controllers/booking-controllers");


const authenticateUser = require('./app/middleware/authenticateUsers');
const authorizeUser = require('./app/middleware/authorizeUsers');

require('dotenv').config();

const app = express();
const port = process.env.PORT;

app.use(express.json())
configureDB();

 //! <-------------------- USERSCONTROLLER --------------------> !\\

app.post("/api/register",userCtrl.register);
app.post("/api/login",userCtrl.login);
app.get("/api/customers",authenticateUser,authorizeUser("admin"),userCtrl.customers);
app.get("/api/distributors",authenticateUser,authorizeUser("admin"),userCtrl.agent);
app.get("/api/account/:id",authenticateUser,authorizeUser(["admin","agent"]),userCtrl.account);
app.put("/api/updatePassword/:id",authenticateUser,userCtrl.UpdatePassword);
app.delete("/api/removeAgent/:id",authenticateUser,userCtrl.removeAgent);
app.delete("/api/remove/:id",authenticateUser,userCtrl.remove)

//! <-------------------- CYLINDER CONTROLLERS--------------------> !\\

app.post("/api/create",authenticateUser,authorizeUser("admin"),cylinderCtrl.createCylinder);
app.get("/api/list",authenticateUser,authorizeUser(["admin","agent"]),cylinderCtrl.listcylinder);
app.get("/api/listOf/type",authenticateUser,cylinderCtrl.typecylinder);
app.put("/api/update/type",authenticateUser,authorizeUser("admin"),cylinderCtrl.update);
app.delete("/api/delete/:id",authenticateUser,authorizeUser("admin"),cylinderCtrl.delete);

//! <--------------------ADMIN INVENTARY CONTROLLERS--------------------> !\\

app.post("/api/stock",authenticateUser,authorizeUser("admin"),inventaryCtrl.addStock);
app.get("/api/all",authenticateUser,authorizeUser("admin"),inventaryCtrl.all);
app.put("/api/update/:id",authenticateUser,authorizeUser("admin"),inventaryCtrl.update);
app.delete("/api/deleteInventary/:id",authenticateUser,authorizeUser("admin"),inventaryCtrl.delete);

//! <--------------------AGENT INVENTARY CONTROLLERS--------------------> !\\

app.post("/api/addStock",authenticateUser,authorizeUser("admin"),agentStockCtrl.addStock);
app.get("/api/ownStock/:id",authenticateUser,authorizeUser("agent"),agentStockCtrl.OwnStock);
app.get("/api/ListAll",authenticateUser,authorizeUser("admin"),agentStockCtrl.ListAll);
app.put("/api/updateStock/:agentId",authenticateUser,authorizeUser(["admin","agent"]),agentStockCtrl.updateStock);
app.delete("/api/DeleteStock/:agentId/:cylinderId",authenticateUser,authorizeUser("admin"),agentStockCtrl.deleteStock);

//! <--------------------BOOKING CONTROLLERS--------------------> !\\

app.post("/api/newBooking",authenticateUser,authorizeUser(["customer","agent"]),bookingCtrl.NewBooking);

app.listen(port,() => {
    console.log("sever running in port",port)
});

