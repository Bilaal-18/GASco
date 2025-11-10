const cron = require('node-cron');
const mongoose = require('mongoose');
const Booking = require('../models/booking-model');
const AgentForecast = require('../models/AgentForecast');
const geminiForecastService = require('../services/geminiForecastService');


let cronJob = null;
const rateLimiter = {
  requests: [],
  maxRequestsPerMinute: 8, 
  
  /**
   * Check if we can make an API call
   * @returns {boolean} True if we can make a request
   */
  canMakeRequest() {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    
    this.requests = this.requests.filter(time => time > oneMinuteAgo);
    return this.requests.length < this.maxRequestsPerMinute;
  },
  
 
  recordRequest() {
    this.requests.push(Date.now());
  },
  
  /**
   * Get time until next request can be made (in milliseconds)
   * @returns {number} Milliseconds until next request
   */
  getWaitTime() {
    if (this.canMakeRequest()) {
      return 0;
    }
    
  
    const oldestRequest = Math.min(...this.requests);
    const waitTime = (oldestRequest + 60 * 1000) - Date.now();
    return Math.max(0, waitTime);
  }
};

/**
 * Check if forecasts are still fresh (generated within the last hour)
 * @param {string} agentId - MongoDB ObjectId of the agent
 * @returns {Promise<boolean>} True if forecasts are fresh
 */
async function areForecastsFresh(agentId) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const forecast = await AgentForecast.findOne({
      agentId: agentId,
      date: { $gte: tomorrow }
    }).sort({ createdAt: -1 });
    
    if (!forecast) {
      return false; 
    }
    
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const isFresh = forecast.createdAt > oneHourAgo;
    
    if (isFresh) {
      console.log(`[Cron] Forecasts for agent ${agentId} are fresh (created ${Math.round((Date.now() - forecast.createdAt) / 1000 / 60)} minutes ago)`);
    }
    
    return isFresh;
  } catch (error) {
    console.error(`[Cron] Error checking forecast freshness for agent ${agentId}:`, error);
    return false;
  }
}

/**
 * Generate forecasts for a single agent with rate limiting
 * 
 * @param {string} agentId - MongoDB ObjectId of the agent
 * @param {number} horizon - Number of days to forecast (default: 7)
 */
async function generateForecastForAgent(agentId, horizon = 7) {
  try {
    const fresh = await areForecastsFresh(agentId);
    if (fresh) {
      console.log(`[Cron] Skipping agent ${agentId} - forecasts are still fresh`);
      return { success: true, agentId, skipped: true, reason: 'fresh' };
    }
    
    const waitTime = rateLimiter.getWaitTime();
    if (waitTime > 0) {
      console.log(`[Cron] Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)} seconds before generating forecast for agent ${agentId}...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    if (!rateLimiter.canMakeRequest()) {
      console.warn(`[Cron] Still at rate limit after waiting. Skipping agent ${agentId} for this cycle.`);
      return { success: false, agentId, skipped: true, reason: 'rate_limit' };
    }
    
    console.log(`[Cron] Generating forecast for agent ${agentId}...`);
    
  
    rateLimiter.recordRequest();
    
    const forecasts = await geminiForecastService.generateForecast(agentId, horizon, 60);
    
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + horizon);
    endDate.setHours(23, 59, 59, 999);
    
    const upcomingBookings = await Booking.find({
      agent: agentId,
      status: { $ne: 'cancelled' },
      deliveryDate: {
        $gte: today,
        $lte: endDate
      }
    }).select('quantity deliveryDate');
    
    const scheduledByDate = {};
    upcomingBookings.forEach(booking => {
      const dateKey = booking.deliveryDate.toISOString().split('T')[0];
      scheduledByDate[dateKey] = (scheduledByDate[dateKey] || 0) + booking.quantity;
    });
  
    const totalScheduled = Object.values(scheduledByDate).reduce((sum, qty) => sum + qty, 0);
    const isLowActivity = totalScheduled <= 3;
    
    const forecastsToSave = forecasts.map(forecast => {
      const scheduledQty = scheduledByDate[forecast.date] || 0;
      const totalNeeded = scheduledQty + forecast.p95;
      let suggestedStock;
      if (isLowActivity && totalNeeded <= 3) {
            suggestedStock = Math.round(totalNeeded * 1.02); 
            suggestedStock = Math.max(suggestedStock, scheduledQty);
          } else {
            suggestedStock = Math.ceil(totalNeeded * 1.05);
          }
      
      return {
        agentId: agentId,
        date: new Date(forecast.date),
        p50: forecast.p50,
        p80: forecast.p80,
        p95: forecast.p95,
        suggestedStock: suggestedStock
      };
    });
    
  
    const bulkOps = forecastsToSave.map(forecast => ({
      updateOne: {
        filter: {
          agentId: forecast.agentId,
          date: forecast.date
        },
        update: {
          $set: forecast
        },
        upsert: true
      }
    }));
    
    await AgentForecast.bulkWrite(bulkOps);
    
    console.log(`[Cron] Successfully saved ${forecastsToSave.length} forecasts for agent ${agentId}`);
    return { success: true, agentId, count: forecastsToSave.length };
  } catch (error) {
    console.error(`[Cron] Error generating forecast for agent ${agentId}:`, error);
    return { success: false, agentId, error: error.message };
  }
}


async function runForecastCron() {
  const startTime = new Date();
  console.log(`[Cron] Starting forecast generation job at ${startTime.toISOString()}`);
  
  try {
    if (mongoose.connection.readyState !== 1) {
      console.error('[Cron] MongoDB is not connected. Skipping forecast generation.');
      return;
    }

    if (runForecastCron.lastRunTime) {
      const timeSinceLastRun = Date.now() - runForecastCron.lastRunTime;
      const minInterval = 4 * 60 * 1000; 
      if (timeSinceLastRun < minInterval) {
        console.log(`[Cron] Skipping forecast generation - last run was ${Math.round(timeSinceLastRun / 1000 / 60)} minutes ago`);
        return;
      }
    }
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 60);
    cutoffDate.setHours(0, 0, 0, 0);
    
    const uniqueAgents = await Booking.distinct('agent', {
      $or: [
        { createdAt: { $gte: cutoffDate } },
        { 
          status: 'delivered',
          updatedAt: { $gte: cutoffDate }
        }
      ]
    });
    
    if (uniqueAgents.length === 0) {
      console.log('[Cron] No agents with delivery history found. Skipping forecast generation.');
      return;
    }
    
    console.log(`[Cron] Found ${uniqueAgents.length} agents with delivery history. Generating forecasts...`);
    
    // Process agents sequentially with rate limiting
    // This ensures we stay under the API rate limit (10 requests/minute)
    const results = [];
    let processed = 0;
    let skipped = 0;
    
    for (const agentId of uniqueAgents) {
      const result = await generateForecastForAgent(agentId.toString(), 7);
      results.push(result);
      
      if (result.skipped) {
        skipped++;
        if (result.reason === 'fresh') {
          console.log(`[Cron] Agent ${agentId} skipped (forecasts are fresh)`);
          // No delay needed for skipped agents (no API call made)
          continue;
        } else if (result.reason === 'rate_limit') {
          console.log(`[Cron] Agent ${agentId} skipped (rate limit)`);
        }
      } else {
        processed++;
      }
      
      const delayBetweenRequests = 8000; 
      await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
    }
    
    const successful = results.filter(r => r.success && !r.skipped).length;
    const failed = results.filter(r => !r.success && !r.skipped).length;
    const skippedCount = results.filter(r => r.skipped).length;
    
    const endTime = new Date();
    const duration = (endTime - startTime) / 1000; 
    runForecastCron.lastRunTime = Date.now(); 
    
    console.log(`[Cron] Forecast generation job completed in ${duration.toFixed(2)} seconds`);
    console.log(`[Cron] Results: ${successful} generated, ${skippedCount} skipped, ${failed} failed`);
    
    if (failed > 0) {
      console.warn(`[Cron] Failed agents:`, results.filter(r => !r.success && !r.skipped).map(r => r.agentId));
    }
  } catch (error) {
    console.error('[Cron] Error in forecast generation job:', error);
    runForecastCron.lastRunTime = Date.now(); 
  }
}

function startForecastCron() {
  if (cronJob) {
    console.log('[Cron] Forecast cron job is already running.');
    return;
  }
  
  cronJob = cron.schedule('*/5 * * * *', async () => {
    await runForecastCron();
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata' 
  });
  
  console.log('[Cron] Forecast cron job scheduled: Running every 5 minutes');
  console.log('[Cron] Rate limiting: Max 8 requests/minute (under free tier limit of 10)');
  console.log('[Cron] Forecast caching: Forecasts are cached for 1 hour to avoid unnecessary regeneration');
}


function stopForecastCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[Cron] Forecast cron job stopped.');
  }
}

async function triggerForecastGeneration() {
  console.log('[Cron] Manual forecast generation triggered');
  await runForecastCron();
}

module.exports = {
  startForecastCron,
  stopForecastCron,
  triggerForecastGeneration,
  runForecastCron
};

