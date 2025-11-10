const AgentForecast = require('../models/AgentForecast');
const geminiForecastService = require('../services/geminiForecastService');
const User = require('../models/user-model');
const AgentStock = require('../models/agent-stock-model');
const Booking = require('../models/booking-model');


const forecastCtrl = {};


forecastCtrl.getAgentForecast = async (req, res) => {
  try {
    console.log(`[Forecast] Request received for agentId: ${req.params.agentId}`);
    const { agentId } = req.params;
    const horizon = parseInt(req.query.horizon) || 7;
    const refresh = req.query.refresh === 'true' || req.query.refresh === true;
    const userId = req.UserId; 
    const userRole = req.role; 
    
    if (horizon < 1 || horizon > 14) {
      return res.status(400).json({ 
        error: 'Horizon must be between 1 and 14 days' 
      });
    }
    
    if (!agentId || !require('mongoose').Types.ObjectId.isValid(agentId)) {
      return res.status(400).json({ 
        error: 'Invalid agentId' 
      });
    }
    
    if (userRole === 'agent' && agentId.toString() !== userId.toString()) {
      return res.status(403).json({ 
        error: 'Unauthorized: You can only view your own forecasts' 
      });
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + horizon);
    endDate.setHours(23, 59, 59, 999);
    
    const existingForecasts = await AgentForecast.find({
      agentId: agentId,
      date: {
        $gte: today,
        $lte: endDate
      }
    }).sort({ date: 1 });
    
    const requiredDates = [];
    for (let i = 0; i < horizon; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      requiredDates.push(date.toISOString().split('T')[0]);
    }
    
    const existingDates = existingForecasts.map(f => f.date.toISOString().split('T')[0]);
    const missingDates = requiredDates.filter(d => !existingDates.includes(d));
    
    const shouldGenerate = refresh === true;
    
    if (shouldGenerate) {
      console.log(`Generating/updating forecast for agent ${agentId} (refresh: ${refresh}, missing: ${missingDates.length})...`);
      
      try {
        const newForecasts = await geminiForecastService.generateForecast(agentId, horizon);
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
      
        const now = new Date();
        
        const totalScheduled = Object.values(scheduledByDate).reduce((sum, qty) => sum + qty, 0);
        const isLowActivity = totalScheduled <= 3;
        
        const forecastsToSave = newForecasts.map(forecast => {
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
            suggestedStock: suggestedStock,
            lastUpdatedAt: now
          };
        });
        
        const bulkOps = forecastsToSave.map(forecast => ({
          updateOne: {
            filter: {
              agentId: forecast.agentId,
              date: forecast.date
            },
            update: {
              $set: {
                ...forecast,
                lastUpdatedAt: now
              }
            },
            upsert: true
          }
        }));
        
        await AgentForecast.bulkWrite(bulkOps);
        
        console.log(`Saved ${forecastsToSave.length} forecasts for agent ${agentId}`);
        
        const updatedForecasts = await AgentForecast.find({
          agentId: agentId,
          date: {
            $gte: today,
            $lte: endDate
          }
        }).sort({ date: 1 });
        
        const lastUpdatedForecast = updatedForecasts.sort((a, b) => 
          (b.lastUpdatedAt || b.createdAt || 0) - (a.lastUpdatedAt || a.createdAt || 0)
        )[0];
        const lastUpdatedAt = lastUpdatedForecast?.lastUpdatedAt || lastUpdatedForecast?.createdAt || now;
        
        const formattedForecasts = updatedForecasts.map(f => ({
          date: f.date.toISOString().split('T')[0],
          p50: f.p50,
          p80: f.p80,
          p95: f.p95,
          suggestedStock: f.suggestedStock
        }));
        
        return res.status(200).json({
          message: 'Forecast generated successfully',
          agentId: agentId,
          horizon: horizon,
          forecasts: formattedForecasts,
          generated: true,
          lastUpdatedAt: lastUpdatedAt,
          refreshed: refresh
        });
      } catch (error) {
        console.error(`Error generating forecast for agent ${agentId}:`, error);
        
        if (existingForecasts.length > 0) {
          console.log('Returning existing forecasts due to generation error');
          const lastUpdatedForecast = existingForecasts.sort((a, b) => 
            (b.lastUpdatedAt || b.createdAt || 0) - (a.lastUpdatedAt || a.createdAt || 0)
          )[0];
          const lastUpdatedAt = lastUpdatedForecast?.lastUpdatedAt || lastUpdatedForecast?.createdAt || null;
          
          const formattedForecasts = existingForecasts.map(f => ({
            date: f.date.toISOString().split('T')[0],
            p50: f.p50,
            p80: f.p80,
            p95: f.p95,
            suggestedStock: f.suggestedStock
          }));
          
          return res.status(200).json({
            message: 'Forecast retrieved from cache (generation failed)',
            agentId: agentId,
            horizon: horizon,
            forecasts: formattedForecasts,
            generated: false,
            lastUpdatedAt: lastUpdatedAt,
            warning: 'New forecast generation failed, returned cached data'
          });
        }
        
        return res.status(500).json({
          error: 'Failed to generate forecast',
          details: error.message
        });
      }
    }
    
    if (existingForecasts.length > 0) {
      const lastUpdatedForecast = existingForecasts.sort((a, b) => 
        (b.lastUpdatedAt || b.createdAt || 0) - (a.lastUpdatedAt || a.createdAt || 0)
      )[0];
      const lastUpdatedAt = lastUpdatedForecast?.lastUpdatedAt || lastUpdatedForecast?.createdAt || null;
      
      const formattedForecasts = existingForecasts.map(f => ({
        date: f.date.toISOString().split('T')[0],
        p50: f.p50,
        p80: f.p80,
        p95: f.p95,
        suggestedStock: f.suggestedStock
      }));
      
      return res.status(200).json({
        message: 'Forecast retrieved successfully',
        agentId: agentId,
        horizon: horizon,
        forecasts: formattedForecasts,
        generated: false,
        lastUpdatedAt: lastUpdatedAt,
        refreshed: false
      });
    } else {
      
      console.log(`No cached forecasts for agent ${agentId} - user must click refresh to generate`);
      return res.status(200).json({
        message: 'No forecasts found. Click refresh to generate forecasts.'
      });
    }
  } catch (error) {
    console.error('Error in getAgentForecast:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
};


forecastCtrl.getAgentForecastStats = async (req, res) => {
  try {
    console.log(`[Forecast Stats] Request received for agentId: ${req.params.agentId}`);
    const { agentId } = req.params;
    const horizon = parseInt(req.query.horizon) || 7;
    const userId = req.UserId; 
    const userRole = req.role; 
    
    
    if (!agentId || !require('mongoose').Types.ObjectId.isValid(agentId)) {
      return res.status(400).json({ 
        error: 'Invalid agentId' 
      });
    }
    
    if (userRole === 'agent' && agentId.toString() !== userId.toString()) {
      return res.status(403).json({ 
        error: 'Unauthorized: You can only view your own forecast stats' 
      });
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + horizon);
    
    const forecasts = await AgentForecast.find({
      agentId: agentId,
      date: {
        $gte: today,
        $lte: endDate
      }
    }).sort({ date: 1 });
    
    if (forecasts.length === 0) {
      return res.status(200).json({
        agentId: agentId,
        horizon: horizon,
        stats: {
          totalDays: 0,
          averageDailyDemand: 0,
          maxDailyDemand: 0,
          minDailyDemand: 0,
          totalForecastedDemand: {
            p50: 0,
            p80: 0,
            p95: 0
          },
          totalSuggestedStock: 0
        },
        forecasts: [],
        message: 'No forecasts found. Click refresh to generate forecasts.'
      });
    }
  
    const totalP50 = forecasts.reduce((sum, f) => sum + f.p50, 0);
    const totalP80 = forecasts.reduce((sum, f) => sum + f.p80, 0);
    const totalP95 = forecasts.reduce((sum, f) => sum + f.p95, 0);
    const totalSuggestedStock = forecasts.reduce((sum, f) => sum + f.suggestedStock, 0);
    
    const avgP50 = totalP50 / forecasts.length;
    const maxP50 = Math.max(...forecasts.map(f => f.p50));
    const minP50 = Math.min(...forecasts.map(f => f.p50));
    
    return res.status(200).json({
      agentId: agentId,
      horizon: horizon,
      stats: {
        totalDays: forecasts.length,
        averageDailyDemand: Math.round(avgP50 * 100) / 100,
        maxDailyDemand: maxP50,
        minDailyDemand: minP50,
        totalForecastedDemand: {
          p50: totalP50,
          p80: totalP80,
          p95: totalP95
        },
        totalSuggestedStock: totalSuggestedStock
      },
      forecasts: forecasts.map(f => ({
        date: f.date.toISOString().split('T')[0],
        p50: f.p50,
        p80: f.p80,
        p95: f.p95,
        suggestedStock: f.suggestedStock
      }))
    });
  } catch (error) {
    console.error('Error in getAgentForecastStats:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
};

module.exports = forecastCtrl;

