const mongoose = require('mongoose');
const Booking = require('../models/booking-model');


async function exportAgentHistory(agentId, daysBack = 90) {
  try {
    if (daysBack < 60 || daysBack > 120) {
    }
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999); 
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    startDate.setHours(0, 0, 0, 0); 


    const bookings = await Booking.find({
      agent: new mongoose.Types.ObjectId(agentId),
      status: { $ne: 'cancelled' }, 
      $or: [
        { createdAt: { $gte: startDate, $lte: endDate } },
        { 
          status: 'delivered',
          updatedAt: { $gte: startDate, $lte: endDate }
        },
        {
          deliveryDate: { $gte: startDate, $lte: endDate }
        }
      ]
    }).select('quantity status updatedAt createdAt deliveryDate');
    
    console.log(`Found ${bookings.length} active bookings for agent ${agentId} in date range`);

    const dailyDemand = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    bookings.forEach(booking => {
      if (booking.status === 'cancelled') {
        return;
      }
      
      let bookingDate;
      const createdAtDate = booking.createdAt ? new Date(booking.createdAt) : null;
      const isCreatedToday = createdAtDate && createdAtDate.toDateString() === today.toDateString();
      
      if (isCreatedToday) {
        bookingDate = booking.createdAt;
      } else if (booking.deliveryDate) {
        bookingDate = booking.deliveryDate;
      } else if (booking.status === 'delivered' && booking.updatedAt) {
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
    console.error(`Error exporting agent history for agent ${agentId}:`, error);
    throw error;
  }
}

async function exportAllAgentsHistory(daysBack = 90) {
  try {
    const uniqueAgents = await Booking.distinct('agent', {
      status: 'delivered'
    });

    const allHistory = {};
    
    await Promise.all(
      uniqueAgents.map(async (agentId) => {
        try {
          const history = await exportAgentHistory(agentId.toString(), daysBack);
          allHistory[agentId.toString()] = history;
        } catch (error) {
          console.error(`Error exporting history for agent ${agentId}:`, error);
        }
      })
    );

    return allHistory;
  } catch (error) {
    console.error('Error exporting all agents history:', error);
    throw error;
  }
}

module.exports = {
  exportAgentHistory,
  exportAllAgentsHistory
};

