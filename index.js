const express = require('express') ;
const configureDB = require('./config/db');
const cors = require('cors')

const  userCtrl  = require('./app/controllers/user-controllers');
const cylinderCtrl = require('./app/controllers/cylinder-controllers');
const inventaryCtrl = require("./app/controllers/inventary-controllers");
const agentStockCtrl = require('./app/controllers/agent-stock-controllers');
const bookingCtrl = require("./app/controllers/booking-controllers");
const gasRequestCtrl = require("./app/controllers/gas-request-controllers");


const authenticateUser = require('./app/middleware/authenticateUsers');
const authorizeUser = require('./app/middleware/authorizeUsers');

require('dotenv').config();

const app = express();
const port = process.env.PORT;

app.use(cors());
app.use(express.json())
configureDB();

 //! <-------------------- USERSCONTROLLER --------------------> !\\

app.post("/api/register",userCtrl.register);
app.post("/api/login",userCtrl.login);
app.get("/api/agentCustomers/:id",authenticateUser,authorizeUser(["admin","agent"]),userCtrl.agentCustomers);
app.get("/api/customers",authenticateUser,authorizeUser("admin"),userCtrl.customers);
app.get("/api/distributors",authenticateUser,authorizeUser("admin"),userCtrl.agent);
app.get("/api/account",authenticateUser,userCtrl.account);
app.put("/api/updatePassword/:id",authenticateUser,userCtrl.UpdatePassword);
app.put("/api/updateAgent/:id",authenticateUser,userCtrl.updateAgent);
app.put("/api/updateCustomer/:id",authenticateUser,authorizeUser("admin"),userCtrl.updateCustomer);
app.delete("/api/removeAgent/:id",authenticateUser,userCtrl.removeAgent);
app.delete("/api/remove/:id",authenticateUser,authorizeUser("admin"),userCtrl.remove)

//! <-------------------- CYLINDER CONTROLLERS--------------------> !\\

app.post("/api/create",authenticateUser,authorizeUser("admin"),cylinderCtrl.createCylinder);
app.get("/api/list",authenticateUser,authorizeUser(["admin","agent"]),cylinderCtrl.listcylinder);
app.get("/api/listOf/type",authenticateUser,cylinderCtrl.typecylinder);
app.put("/api/updateCylinder/:id",authenticateUser,authorizeUser("admin"),cylinderCtrl.update);
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
app.get("/api/getSummary/:id",authenticateUser,authorizeUser("agent"),agentStockCtrl.getAgentSummary);
app.get("/api/report/:id",authenticateUser,authorizeUser("agent"),agentStockCtrl.generateReport);
app.get("/api/getStats",authenticateUser,authorizeUser("agent"),agentStockCtrl.getStats);

//! <--------------------GAS REQUEST CONTROLLERS--------------------> !\\

app.post("/api/gasRequest",authenticateUser,authorizeUser("agent"),gasRequestCtrl.createRequest);
app.get("/api/gasRequests",authenticateUser,authorizeUser("admin"),gasRequestCtrl.getAllRequests);
app.get("/api/gasRequests/my",authenticateUser,authorizeUser("agent"),gasRequestCtrl.getAgentRequests);
app.put("/api/gasRequest/approve/:requestId",authenticateUser,authorizeUser("admin"),gasRequestCtrl.approveRequest);
app.put("/api/gasRequest/reject/:requestId",authenticateUser,authorizeUser("admin"),gasRequestCtrl.rejectRequest);

//! <--------------------BOOKING CONTROLLERS--------------------> !\\

app.post("/api/newBooking",authenticateUser,authorizeUser(["customer","agent"]),bookingCtrl.NewBooking);
app.get("/api/allBookings",authenticateUser,authorizeUser(["admin","agent"]),bookingCtrl.allBookings);
app.get("/api/agentBookings",authenticateUser,authorizeUser(["agent"]),bookingCtrl.getAgentBookings);
app.get("/api/SingleBooking/:id",authenticateUser,authorizeUser(["admin","agent"]),bookingCtrl.singleBooking);
app.put("/api/updateBooking/:id",authenticateUser,authorizeUser(["agent","customer"]),bookingCtrl.updateBooking);
app.delete("/api/deleteBooking/:id",authenticateUser,authorizeUser(["agent","customer"]),bookingCtrl.deleteBooking);
app.get("/api/todayBookings",authenticateUser,authorizeUser("agent"),bookingCtrl.getToday);

app.listen(port,() => {
    console.log("sever running in port",port)
});

