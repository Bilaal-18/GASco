const mongoose = require('mongoose');
const Booking = require('../models/booking-model');

/**
 * Export Agent History Script
 * Extracts historical booking data for demand forecasting
 * Groups bookings by agentId and delivery date, sums cylinder quantities
 * 
 * @param {string} agentId - MongoDB ObjectId of the agent
 * @param {number} daysBack - Number of days to look back (default: 90, range: 60-120)
 * @returns {Promise<Array>} Array of { date: "YYYY-MM-DD", qty: number }
 */
async function exportAgentHistory(agentId, daysBack = 90) {
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

    // Query bookings for this agent within the date range
    // Exclude cancelled bookings as they don't represent actual demand
    // Prioritize deliveryDate field when available (scheduled deliveries)
    // For past bookings, use actual delivery/creation date
    const bookings = await Booking.find({
      agent: new mongoose.Types.ObjectId(agentId),
      status: { $ne: 'cancelled' }, // Exclude cancelled bookings
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

    // Group bookings by date and sum quantities
    // Priority: deliveryDate > updatedAt (for delivered) > createdAt
    const dailyDemand = {};
    
    bookings.forEach(booking => {
      // Skip cancelled bookings (shouldn't happen due to query filter, but double-check)
      if (booking.status === 'cancelled') {
        return;
      }
      
      // Determine which date to use for this booking
      // Priority: deliveryDate (scheduled delivery) > updatedAt (actual delivery) > createdAt (booking made)
      let bookingDate;
      if (booking.deliveryDate) {
        // Use scheduled delivery date if available (most accurate for future planning)
        bookingDate = booking.deliveryDate;
      } else if (booking.status === 'delivered' && booking.updatedAt) {
        // For delivered bookings without deliveryDate, use updatedAt (actual delivery date)
        bookingDate = booking.updatedAt;
      } else {
        // For pending/confirmed bookings without deliveryDate, use createdAt (booking date)
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

    console.log(`Exported ${completeHistory.length} days of history for agent ${agentId}`);
    console.log(`Total bookings: ${bookings.length}, Days with demand: ${historyArray.length}`);

    return completeHistory;
  } catch (error) {
    console.error(`Error exporting agent history for agent ${agentId}:`, error);
    throw error;
  }
}

/**
 * Export history for all agents
 * Useful for batch processing in cron jobs
 * 
 * @param {number} daysBack - Number of days to look back
 * @returns {Promise<Object>} Object mapping agentId to history array
 */
async function exportAllAgentsHistory(daysBack = 90) {
  try {
    // Get all unique agent IDs from bookings
    const uniqueAgents = await Booking.distinct('agent', {
      status: 'delivered'
    });

    const allHistory = {};
    
    // Export history for each agent in parallel
    await Promise.all(
      uniqueAgents.map(async (agentId) => {
        try {
          const history = await exportAgentHistory(agentId.toString(), daysBack);
          allHistory[agentId.toString()] = history;
        } catch (error) {
          console.error(`Error exporting history for agent ${agentId}:`, error);
          // Continue with other agents even if one fails
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

