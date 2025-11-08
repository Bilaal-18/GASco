const mongoose = require('mongoose');
const Booking = require('../models/booking-model');

/**
 * Export Customer History Script
 * Extracts historical booking data for customer demand forecasting
 * Groups bookings by customerId and delivery date, sums cylinder quantities
 * 
 * @param {string} customerId - MongoDB ObjectId of the customer
 * @param {number} daysBack - Number of days to look back (default: 90, range: 60-120)
 * @returns {Promise<Array>} Array of { date: "YYYY-MM-DD", qty: number }
 */
async function exportCustomerHistory(customerId, daysBack = 90) {
  try {
    // Validate daysBack parameter (should be between 60-120 days)
    if (daysBack < 60 || daysBack > 120) {
      console.warn(`daysBack (${daysBack}) is outside recommended range (60-120). Using ${daysBack} anyway.`);
    }

    // Calculate date range: from (daysBack days ago) to today
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999); // End of today
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    startDate.setHours(0, 0, 0, 0); // Start of day

    // Query bookings for this customer within the date range
    // Include all bookings (pending, confirmed, delivered) as they represent demand
    // Use createdAt as the primary date (when booking was made)
    // Also check updatedAt for delivered bookings
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
    
    console.log(`Found ${bookings.length} bookings for customer ${customerId} in date range`);

    // Group bookings by date and sum quantities
    const dailyDemand = {};
    
    bookings.forEach(booking => {
      // For delivered bookings, prefer updatedAt (delivery date)
      // For other bookings, use createdAt (booking date)
      // This gives us a better picture of actual demand pattern
      let bookingDate;
      if (booking.status === 'delivered' && booking.updatedAt) {
        // Use delivery date for delivered bookings
        bookingDate = booking.updatedAt;
      } else {
        // Use booking creation date for pending/confirmed bookings
        bookingDate = booking.createdAt;
      }
      
      if (!bookingDate) {
        console.warn(`Booking ${booking._id} has no date, skipping`);
        return;
      }

      // Format date as YYYY-MM-DD (ignore time, only date matters)
      const dateKey = bookingDate.toISOString().split('T')[0];
      
      // Only count bookings within our date range
      const bookingDateObj = new Date(bookingDate);
      if (bookingDateObj < startDate || bookingDateObj > endDate) {
        return; // Skip if outside date range
      }
      
      // Initialize date entry if it doesn't exist
      if (!dailyDemand[dateKey]) {
        dailyDemand[dateKey] = {
          date: dateKey,
          qty: 0
        };
      }
      
      // Sum up quantities for this date
      dailyDemand[dateKey].qty += booking.quantity || 0;
    });

    // Convert object to array and sort by date (ascending)
    const historyArray = Object.values(dailyDemand).sort((a, b) => {
      return new Date(a.date) - new Date(b.date);
    });

    // Fill in missing dates with 0 demand (optional: helps with time series continuity)
    // This creates a complete date series for better forecasting
    const completeHistory = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      const dateKey = currentDate.toISOString().split('T')[0];
      const existingEntry = dailyDemand[dateKey];
      
      if (existingEntry) {
        completeHistory.push(existingEntry);
      } else {
        // Add entry with 0 demand for missing dates
        completeHistory.push({
          date: dateKey,
          qty: 0
        });
      }
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log(`Exported ${completeHistory.length} days of history for customer ${customerId}`);
    console.log(`Total bookings: ${bookings.length}, Days with demand: ${historyArray.length}`);

    return completeHistory;
  } catch (error) {
    console.error(`Error exporting customer history for customer ${customerId}:`, error);
    throw error;
  }
}

module.exports = {
  exportCustomerHistory
};

