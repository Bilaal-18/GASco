const cron = require('node-cron');
const mongoose = require('mongoose');
const Booking = require('../models/booking-model');
const AgentForecast = require('../models/AgentForecast');
const geminiForecastService = require('../services/geminiForecastService');

/**
 * Forecast Cron Job
 * Runs every 5 minutes to generate fresh forecasts for all agents
 * 
 * Schedule: every 5 minutes (to respect API rate limits)
 * Format: minute hour day month day-of-week
 * Pattern: every 5 minutes
 * 
 * Rate Limiting:
 * - Free tier: 10 requests/minute per model
 * - We limit to 8 requests/minute to stay safe
 * - Forecasts are cached for 1 hour to avoid unnecessary regeneration
 */

let cronJob = null;

// Rate limiting: track API calls per minute
const rateLimiter = {
  requests: [],
  maxRequestsPerMinute: 8, // Stay under free tier limit of 10
  
  /**
   * Check if we can make an API call
   * @returns {boolean} True if we can make a request
   */
  canMakeRequest() {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    
    // Remove requests older than 1 minute
    this.requests = this.requests.filter(time => time > oneMinuteAgo);
    
    // Check if we're under the limit
    return this.requests.length < this.maxRequestsPerMinute;
  },
  
  /**
   * Record an API call
   */
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
    
    // Find oldest request in the last minute
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
    // Check if we have forecasts for today and the next few days
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const forecast = await AgentForecast.findOne({
      agentId: agentId,
      date: { $gte: tomorrow }
    }).sort({ createdAt: -1 });
    
    if (!forecast) {
      return false; // No forecast found, need to generate
    }
    
    // Check if forecast was created within the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const isFresh = forecast.createdAt > oneHourAgo;
    
    if (isFresh) {
      console.log(`[Cron] Forecasts for agent ${agentId} are fresh (created ${Math.round((Date.now() - forecast.createdAt) / 1000 / 60)} minutes ago)`);
    }
    
    return isFresh;
  } catch (error) {
    console.error(`[Cron] Error checking forecast freshness for agent ${agentId}:`, error);
    return false; // On error, assume we need to regenerate
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
    // Check if forecasts are still fresh (skip if recent)
    const fresh = await areForecastsFresh(agentId);
    if (fresh) {
      console.log(`[Cron] Skipping agent ${agentId} - forecasts are still fresh`);
      return { success: true, agentId, skipped: true, reason: 'fresh' };
    }
    
    // Wait if we're at rate limit
    const waitTime = rateLimiter.getWaitTime();
    if (waitTime > 0) {
      console.log(`[Cron] Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)} seconds before generating forecast for agent ${agentId}...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Check rate limit again after waiting
    if (!rateLimiter.canMakeRequest()) {
      console.warn(`[Cron] Still at rate limit after waiting. Skipping agent ${agentId} for this cycle.`);
      return { success: false, agentId, skipped: true, reason: 'rate_limit' };
    }
    
    console.log(`[Cron] Generating forecast for agent ${agentId}...`);
    
    // Record API call
    rateLimiter.recordRequest();
    
    // Generate forecast using Gemini AI (7 days forecast, 60 days history)
    const forecasts = await geminiForecastService.generateForecast(agentId, horizon, 60);
    
    // Get upcoming scheduled bookings to merge with predictions
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
    
    // Create map of scheduled bookings by date
    const scheduledByDate = {};
    upcomingBookings.forEach(booking => {
      const dateKey = booking.deliveryDate.toISOString().split('T')[0];
      scheduledByDate[dateKey] = (scheduledByDate[dateKey] || 0) + booking.quantity;
    });
    
    // Prepare forecasts for database
    // suggestedStock = scheduled + p95 (total needed including safety buffer)
    const totalScheduled = Object.values(scheduledByDate).reduce((sum, qty) => sum + qty, 0);
    const isLowActivity = totalScheduled <= 3;
    
    const forecastsToSave = forecasts.map(forecast => {
      const scheduledQty = scheduledByDate[forecast.date] || 0;
      // Total needed = scheduled deliveries + predicted additional demand at 95th percentile
      const totalNeeded = scheduledQty + forecast.p95;
      
      // For low activity, use minimal buffer; for normal activity, add 5% buffer
      let suggestedStock;
      if (isLowActivity && totalNeeded <= 3) {
            // Very low activity: round to nearest integer (minimal buffer)
            suggestedStock = Math.round(totalNeeded * 1.02); // 2% buffer max
            // Ensure at least the scheduled amount
            suggestedStock = Math.max(suggestedStock, scheduledQty);
          } else {
            // Normal activity: add 5% buffer
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
    
    // Use bulkWrite with upsert to update existing or create new forecasts
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

/**
 * Main cron job function
 * Generates forecasts for all agents with delivery history
 */
async function runForecastCron() {
  const startTime = new Date();
  console.log(`[Cron] Starting forecast generation job at ${startTime.toISOString()}`);
  
  try {
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      console.error('[Cron] MongoDB is not connected. Skipping forecast generation.');
      return;
    }
    
    // Throttle: Only run if last run completed more than 4 minutes ago
    // This prevents overlapping executions and ensures we respect rate limits
    if (runForecastCron.lastRunTime) {
      const timeSinceLastRun = Date.now() - runForecastCron.lastRunTime;
      const minInterval = 4 * 60 * 1000; // 4 minutes minimum interval
      if (timeSinceLastRun < minInterval) {
        console.log(`[Cron] Skipping forecast generation - last run was ${Math.round(timeSinceLastRun / 1000 / 60)} minutes ago`);
        return;
      }
    }
    
    // Get all unique agent IDs from bookings (last 60 days)
    // Include all bookings (pending, confirmed, delivered) to get accurate demand patterns
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
      
      // Add delay between API requests to stay under rate limit
      // Only delay if we actually made an API call (not skipped)
      // Space requests to stay well under 10 requests/minute
      const delayBetweenRequests = 8000; // 8 seconds = ~7.5 requests/minute
      await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
    }
    
    // Calculate statistics
    const successful = results.filter(r => r.success && !r.skipped).length;
    const failed = results.filter(r => !r.success && !r.skipped).length;
    const skippedCount = results.filter(r => r.skipped).length;
    
    const endTime = new Date();
    const duration = (endTime - startTime) / 1000; // Duration in seconds
    runForecastCron.lastRunTime = Date.now(); // Update last run time after completion
    
    console.log(`[Cron] Forecast generation job completed in ${duration.toFixed(2)} seconds`);
    console.log(`[Cron] Results: ${successful} generated, ${skippedCount} skipped, ${failed} failed`);
    
    if (failed > 0) {
      console.warn(`[Cron] Failed agents:`, results.filter(r => !r.success && !r.skipped).map(r => r.agentId));
    }
  } catch (error) {
    console.error('[Cron] Error in forecast generation job:', error);
    runForecastCron.lastRunTime = Date.now(); // Update even on error
  }
}

/**
 * Start the forecast cron job
 * Schedule: Every 5 minutes
 */
function startForecastCron() {
  if (cronJob) {
    console.log('[Cron] Forecast cron job is already running.');
    return;
  }
  
  // Schedule: Every 5 minutes
  // Format: minute hour day month day-of-week
  // '*/5 * * * *' means: every 5 minutes
  cronJob = cron.schedule('*/5 * * * *', async () => {
    await runForecastCron();
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata' // Adjust timezone as needed
  });
  
  console.log('[Cron] Forecast cron job scheduled: Running every 5 minutes');
  console.log('[Cron] Rate limiting: Max 8 requests/minute (under free tier limit of 10)');
  console.log('[Cron] Forecast caching: Forecasts are cached for 1 hour to avoid unnecessary regeneration');
}

/**
 * Stop the forecast cron job
 */
function stopForecastCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[Cron] Forecast cron job stopped.');
  }
}

/**
 * Manually trigger forecast generation (for testing or manual runs)
 */
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

