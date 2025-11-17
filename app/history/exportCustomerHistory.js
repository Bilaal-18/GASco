const mongoose = require('mongoose');
const Booking = require('../models/booking-model');


async function exportCustomerHistory(customerId, daysBack = 90) {
  try {
    if (daysBack < 60 || daysBack > 120) {
    }
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999); 
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    startDate.setHours(0, 0, 0, 0);

    const bookings = await Booking.find({
      customer: new mongoose.Types.ObjectId(customerId),
      $or: [
        { createdAt: { $gte: startDate, $lte: endDate } },
        { 
          status: 'delivered',
          updatedAt: { $gte: startDate, $lte: endDate }
        }
      ]
    }).select('quantity status updatedAt createdAt');
    
    const dailyDemand = {};
    
    bookings.forEach(booking => {
      let bookingDate;
      if (booking.status === 'delivered' && booking.updatedAt) {
        bookingDate = booking.updatedAt;
      } else {
        bookingDate = booking.createdAt;
      }
      
      if (!bookingDate) {
        console.warn(`Booking ${booking._id} has no date, skipping`);
        return;
      }
      const dateKey = bookingDate.toISOString().split('T')[0];
      
      const bookingDateObj = new Date(bookingDate);
      if (bookingDateObj < startDate || bookingDateObj > endDate) {
        return; 
      }
      
      if (!dailyDemand[dateKey]) {
        dailyDemand[dateKey] = {
          date: dateKey,
          qty: 0
        };
      }
    
      dailyDemand[dateKey].qty += booking.quantity || 0;
    });

    const historyArray = Object.values(dailyDemand).sort((a, b) => {
      return new Date(a.date) - new Date(b.date);
    });

    const completeHistory = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      const dateKey = currentDate.toISOString().split('T')[0];
      const existingEntry = dailyDemand[dateKey];
      
      if (existingEntry) {
        completeHistory.push(existingEntry);
      } else {
        completeHistory.push({
          date: dateKey,
          qty: 0
        });
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    return completeHistory;
  } catch (error) {
    console.error(`Error exporting customer history for customer ${customerId}:`, error);
    throw error;
  }
}

module.exports = {
  exportCustomerHistory
};

