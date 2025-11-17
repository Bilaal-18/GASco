const cron = require('node-cron');
const mongoose = require('mongoose');
const Booking = require('../models/booking-model');
const AgentForecast = require('../models/AgentForecast');
const geminiForecastService = require('../services/geminiForecastService');


let cronJob = null;
const rateLimiter = {
  requests: [],
  maxRequestsPerMinute: 8, 
  
  canMakeRequest() {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    
    this.requests = this.requests.filter(time => time > oneMinuteAgo);
    return this.requests.length < this.maxRequestsPerMinute;
  },
  
 
  recordRequest() {
    this.requests.push(Date.now());
  },
  
  getWaitTime() {
    if (this.canMakeRequest()) {
      return 0;
    }
    
  
    const oldestRequest = Math.min(...this.requests);
    const waitTime = (oldestRequest + 60 * 1000) - Date.now();
    return Math.max(0, waitTime);
  }
};

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

async function generateForecastForAgent(agentId, horizon = 7) {
  try {
    const fresh = await areForecastsFresh(agentId);
    if (fresh) {
      return { success: true, agentId, skipped: true, reason: 'fresh' };
    }
    
    const waitTime = rateLimiter.getWaitTime();
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    if (!rateLimiter.canMakeRequest()) {
      return { success: false, agentId, skipped: true, reason: 'rate_limit' };
    }
    
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
    
    return { success: true, agentId, count: forecastsToSave.length };
  } catch (error) {
    return { success: false, agentId, error: error.message };
  }
}

async function runForecastCron() {
  const startTime = new Date();
  
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
      console.log(' No agents with delivery history found.');
      return;
    }
    
    console.log(`Found ${uniqueAgents.length} agents with delivery history. Generating forecasts...`);
    
    const results = [];
    let processed = 0;
    let skipped = 0;
    
    for (const agentId of uniqueAgents) {
      const result = await generateForecastForAgent(agentId.toString(), 7);
      results.push(result);
      
      if (result.skipped) {
        skipped++;
        if (result.reason === 'fresh') {
          continue;
        } else if (result.reason === 'rate_limit') {
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
    
    if (failed > 0) {
    }
  } catch (error) {
    runForecastCron.lastRunTime = Date.now(); 
  }
}

function startForecastCron() {
  if (cronJob) {
    console.log('Forecast cron job is already running.');
    return;
  }
  
  cronJob = cron.schedule('*/5 * * * *', async () => {
    await runForecastCron();
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata' 
  });
  
}

function stopForecastCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[Cron] Forecast cron job stopped.');
  }
}

async function triggerForecastGeneration() {
  await runForecastCron();
}

module.exports = {
  startForecastCron,
  stopForecastCron,
  triggerForecastGeneration,
  runForecastCron
};

