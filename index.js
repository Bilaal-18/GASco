const express = require('express') ;
const configureDB = require('./config/db');
const cors = require('cors')

const  userCtrl  = require('./app/controllers/user-controllers');
const cylinderCtrl = require('./app/controllers/cylinder-controllers');
const inventaryCtrl = require("./app/controllers/inventary-controllers");
const agentStockCtrl = require('./app/controllers/agent-stock-controllers');
const bookingCtrl = require("./app/controllers/booking-controllers");
const gasRequestCtrl = require("./app/controllers/gas-request-controllers");
const paymentCtrl = require("./app/controllers/payment-controllers");
const agentPaymentCtrl = require("./app/controllers/agent-payment-controllers");
const uploadCtrl = require("./app/controllers/upload-controllers");
const homeCtrl = require("./app/controllers/home-controllers");
const translationCtrl = require("./app/controllers/translation-controllers");
const forecastCtrl = require("./app/controllers/forecast-controllers");
const customerForecastCtrl = require("./app/controllers/customer-forecast-controllers");
const { startForecastCron } = require("./app/cron/forecastCron");
const fileUpload = require('express-fileupload');


const authenticateUser = require('./app/middleware/authenticateUsers');
const authorizeUser = require('./app/middleware/authorizeUsers');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3090; // Default to 3090 for local development

app.use(cors());
app.use(express.json());
app.use(fileUpload({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max file size
  abortOnLimit: true,
  createParentPath: true
}));
configureDB();

 //! <-------------------- USERSCONTROLLER --------------------> !\\

app.post("/api/register",userCtrl.register);
app.post("/api/login",userCtrl.login);
app.get("/api/agentCustomers/:id",authenticateUser,authorizeUser(["admin","agent"]),userCtrl.agentCustomers);
app.get("/api/customers",authenticateUser,authorizeUser("admin"),userCtrl.customers);
app.get("/api/distributors",authenticateUser,authorizeUser("admin"),userCtrl.agent);
app.get("/api/account",authenticateUser,userCtrl.account);
app.put("/api/account",authenticateUser,userCtrl.updateAccount);
app.get("/api/customer/assigned-agent",authenticateUser,authorizeUser("customer"),userCtrl.getAssignedAgent);
app.put("/api/updatePassword/:id",authenticateUser,userCtrl.UpdatePassword);
app.put("/api/updateAgent/:id",authenticateUser,authorizeUser(["admin","agent"]),userCtrl.updateAgent);
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
app.get("/api/customerBookings",authenticateUser,authorizeUser(["customer"]),bookingCtrl.getCustomerBookings);
app.get("/api/SingleBooking/:id",authenticateUser,authorizeUser(["admin","agent"]),bookingCtrl.singleBooking);
app.put("/api/updateBooking/:id",authenticateUser,authorizeUser(["agent","customer"]),bookingCtrl.updateBooking);
app.patch("/api/cancelBooking/:id",authenticateUser,authorizeUser(["agent","customer"]),bookingCtrl.cancelBooking);
app.delete("/api/deleteBooking/:id",authenticateUser,authorizeUser(["agent","customer"]),bookingCtrl.deleteBooking);
app.get("/api/todayBookings",authenticateUser,authorizeUser("agent"),bookingCtrl.getToday);

//! <--------------------PAYMENT CONTROLLERS--------------------> !\\

app.post("/api/payment/create-order",authenticateUser,authorizeUser(["customer","agent"]),paymentCtrl.createRazorpayOrder);
app.post("/api/payment/verify",authenticateUser,authorizeUser(["customer","agent"]),paymentCtrl.verifyPayment);
app.get("/api/payment/history",authenticateUser,authorizeUser(["customer","agent","admin"]),paymentCtrl.getPaymentHistory);
app.get("/api/payment/:id",authenticateUser,authorizeUser(["customer","agent","admin"]),paymentCtrl.getPaymentById);

//! <--------------------AGENT PAYMENT CONTROLLERS--------------------> !\\

app.post("/api/agent/payment/create-order",authenticateUser,authorizeUser("agent"),agentPaymentCtrl.createRazorpayOrder);
app.post("/api/agent/payment/verify",authenticateUser,authorizeUser("agent"),agentPaymentCtrl.verifyPayment);
app.post("/api/agent/payment/cash",authenticateUser,authorizeUser("agent"),agentPaymentCtrl.createCashPayment);
app.get("/api/agent/payment/history",authenticateUser,authorizeUser("agent"),agentPaymentCtrl.getAgentPaymentHistory);
app.get("/api/admin/agent-payments",authenticateUser,authorizeUser("admin"),agentPaymentCtrl.getAllAgentPayments);

//! <--------------------UPLOAD CONTROLLERS--------------------> !\\

app.post("/api/upload/profile-image",authenticateUser,authorizeUser(["customer","agent","admin"]),uploadCtrl.uploadProfileImage);
app.delete("/api/upload/delete-image",authenticateUser,authorizeUser(["customer","agent","admin"]),uploadCtrl.deleteImage);

//! <--------------------PUBLIC HOME CONTROLLERS--------------------> !\\

app.get("/api/public/stats",homeCtrl.getPublicStats);
app.get("/api/public/cylinders",homeCtrl.getPublicCylinders);

//! <--------------------TRANSLATION CONTROLLERS--------------------> !\\

app.post("/api/translate/manglish-to-english",authenticateUser,translationCtrl.translateManglishToEnglish);
app.post("/api/translate/english-to-manglish",authenticateUser,translationCtrl.translateEnglishToManglish);
app.post("/api/translate/detect",authenticateUser,translationCtrl.detectManglish);

//! <--------------------FORECAST ROUTES--------------------> !\\
// IMPORTANT: More specific routes must come FIRST to avoid route matching conflicts

app.get("/api/agents/:agentId/forecast/stats",authenticateUser,authorizeUser(["admin","agent"]),forecastCtrl.getAgentForecastStats);
app.get("/api/agents/:agentId/customers/forecasts",authenticateUser,authorizeUser(["admin","agent"]),customerForecastCtrl.getAgentCustomersForecasts);
app.get("/api/agents/:agentId/forecast",authenticateUser,authorizeUser(["admin","agent"]),forecastCtrl.getAgentForecast);


app.listen(port,() => {
    console.log("sever running in port",port);
    
    // Forecast cron job is disabled - forecasts are now generated on-demand via refresh button
    // Uncomment the lines below if you want to re-enable automatic forecast generation
    // setTimeout(() => {
    //     startForecastCron();
    // }, 3000); // Wait 3 seconds for DB connection
    console.log("Forecast cron job is disabled. Use refresh button to generate forecasts on-demand.");
});

