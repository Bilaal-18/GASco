const AgentForecast = require('../models/AgentForecast');
const geminiForecastService = require('../services/geminiForecastService');
const User = require('../models/user-model');
const AgentStock = require('../models/agent-stock-model');

/**
 * Forecast Controllers
 * Handles API requests for agent demand forecasts
 */

const forecastCtrl = {};

/**
 * GET /api/agents/:agentId/forecast
 * Get forecast for a specific agent
 * Fetches from MongoDB if available, otherwise generates new forecast using Gemini AI
 * 
 * Query params:
 * - horizon: Number of days to forecast (default: 14, range: 7-14)
 * - refresh: If true, force regenerate forecasts (default: false)
 */
forecastCtrl.getAgentForecast = async (req, res) => {
  try {
    const { agentId } = req.params;
    const horizon = parseInt(req.query.horizon) || 7;
    const refresh = req.query.refresh === 'true' || req.query.refresh === true;
    const userId = req.UserId; // From authentication middleware
    const userRole = req.role; // From authentication middleware
    
    // Validate horizon (should be between 7-14 days, default 7 for next week)
    if (horizon < 1 || horizon > 14) {
      return res.status(400).json({ 
        error: 'Horizon must be between 1 and 14 days' 
      });
    }
    
    // Validate agentId
    if (!agentId || !require('mongoose').Types.ObjectId.isValid(agentId)) {
      return res.status(400).json({ 
        error: 'Invalid agentId' 
      });
    }
    
    // Authorization check: Agents can only view their own forecasts
    if (userRole === 'agent' && agentId.toString() !== userId.toString()) {
      return res.status(403).json({ 
        error: 'Unauthorized: You can only view your own forecasts' 
      });
    }
    
    // Calculate date range: today to (today + horizon days)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + horizon);
    endDate.setHours(23, 59, 59, 999);
    
    // Check if forecasts already exist in MongoDB
    const existingForecasts = await AgentForecast.find({
      agentId: agentId,
      date: {
        $gte: today,
        $lte: endDate
      }
    }).sort({ date: 1 });
    
    // Check if we have forecasts for all requested days
    const requiredDates = [];
    for (let i = 0; i < horizon; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      requiredDates.push(date.toISOString().split('T')[0]);
    }
    
    const existingDates = existingForecasts.map(f => f.date.toISOString().split('T')[0]);
    const missingDates = requiredDates.filter(d => !existingDates.includes(d));
    
    // Only generate new forecasts if refresh=true is explicitly requested
    // On initial load (refresh=false), only return cached data, even if missing
    const shouldGenerate = refresh === true;
    
    if (shouldGenerate) {
      console.log(`Generating/updating forecast for agent ${agentId} (refresh: ${refresh}, missing: ${missingDates.length})...`);
      
      try {
        // Generate forecast using Gemini AI
        const newForecasts = await geminiForecastService.generateForecast(agentId, horizon);
        
        // Save forecasts to MongoDB with lastUpdatedAt
        const now = new Date();
        const forecastsToSave = newForecasts.map(forecast => ({
          agentId: agentId,
          date: new Date(forecast.date),
          p50: forecast.p50,
          p80: forecast.p80,
          p95: forecast.p95,
          suggestedStock: Math.ceil(forecast.p80 * 1.1), // Safety buffer: 10% above p80
          lastUpdatedAt: now
        }));
        
        // Use bulkWrite with upsert to update existing or create new forecasts
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
        
        // Fetch updated forecasts from database
        const updatedForecasts = await AgentForecast.find({
          agentId: agentId,
          date: {
            $gte: today,
            $lte: endDate
          }
        }).sort({ date: 1 });
        
        // Get the most recent lastUpdatedAt
        const lastUpdatedForecast = updatedForecasts.sort((a, b) => 
          (b.lastUpdatedAt || b.createdAt || 0) - (a.lastUpdatedAt || a.createdAt || 0)
        )[0];
        const lastUpdatedAt = lastUpdatedForecast?.lastUpdatedAt || lastUpdatedForecast?.createdAt || now;
        
        // Format response
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
        
        // If generation fails but we have some existing forecasts, return those
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
        
        // If no existing forecasts and generation failed, return error
        return res.status(500).json({
          error: 'Failed to generate forecast',
          details: error.message
        });
      }
    }
    
    // Return cached forecasts (no API call needed)
    // If no forecasts exist, return empty array (user must click refresh to generate)
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
      // No forecasts exist - return empty array
      console.log(`No cached forecasts for agent ${agentId} - user must click refresh to generate`);
      return res.status(200).json({
        message: 'No forecasts found. Click refresh to generate forecasts.',
        agentId: agentId,
        horizon: horizon,
        forecasts: [],
        generated: false,
        lastUpdatedAt: null,
        refreshed: false
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

/**
 * GET /api/agents/:agentId/forecast/stats
 * Get forecast statistics for an agent
 */
forecastCtrl.getAgentForecastStats = async (req, res) => {
  try {
    const { agentId } = req.params;
    const horizon = parseInt(req.query.horizon) || 7;
    const userId = req.UserId; // From authentication middleware
    const userRole = req.role; // From authentication middleware
    
    // Validate agentId
    if (!agentId || !require('mongoose').Types.ObjectId.isValid(agentId)) {
      return res.status(400).json({ 
        error: 'Invalid agentId' 
      });
    }
    
    // Authorization check: Agents can only view their own forecast stats
    if (userRole === 'agent' && agentId.toString() !== userId.toString()) {
      return res.status(403).json({ 
        error: 'Unauthorized: You can only view your own forecast stats' 
      });
    }
    
    // Calculate date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + horizon);
    
    // Get forecasts
    const forecasts = await AgentForecast.find({
      agentId: agentId,
      date: {
        $gte: today,
        $lte: endDate
      }
    }).sort({ date: 1 });
    
    if (forecasts.length === 0) {
      return res.status(404).json({
        error: 'No forecasts found for this agent'
      });
    }
    
    // Calculate statistics
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

