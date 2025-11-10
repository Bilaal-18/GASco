const CustomerForecast = require('../models/CustomerForecast');
const customerForecastService = require('../services/customerForecastService');
const User = require('../models/user-model');

const customerForecastCtrl = {};


customerForecastCtrl.getAgentCustomersForecasts = async (req, res) => {
  try {
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
        error: 'Unauthorized: You can only view forecasts for your own customers' 
      });
    }
    
    const customers = await User.find({ 
      agent: agentId, 
      role: 'customer' 
    }).select('_id username email phoneNo businessname');
    
    if (customers.length === 0) {
      return res.status(200).json({
        message: 'No customers found for this agent',
        customers: [],
        forecasts: []
      });
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + horizon);
    endDate.setHours(23, 59, 59, 999);
    
    const customerForecasts = [];
    
    for (const customer of customers) {
      try {
        const existingForecasts = await CustomerForecast.find({
          customerId: customer._id,
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
        
        let forecasts = [];
        let generated = false;
        
        const shouldGenerate = refresh === true;
        
        if (shouldGenerate) {
          console.log(`Generating/updating forecast for customer ${customer._id} (refresh: ${refresh}, missing: ${missingDates.length})...`);
          
          try {
            const newForecasts = await customerForecastService.generateCustomerForecast(
              customer._id.toString(), 
              agentId.toString(), 
              horizon
            );
              
              const now = new Date();
              const forecastsToSave = newForecasts.map(forecast => ({
                customerId: customer._id,
                agentId: agentId,
                date: new Date(forecast.date),
                p50: forecast.p50,
                p80: forecast.p80,
                p95: forecast.p95,
                suggestedStock: Math.ceil(forecast.p80 * 1.1), 
                lastUpdatedAt: now
              }));
              
              const bulkOps = forecastsToSave.map(forecast => ({
                updateOne: {
                  filter: {
                    customerId: forecast.customerId,
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
              
              await CustomerForecast.bulkWrite(bulkOps);
              
              console.log(`Saved ${forecastsToSave.length} forecasts for customer ${customer._id}`);
              
              forecasts = newForecasts.map(forecast => ({
                date: forecast.date,
                p50: forecast.p50,
                p80: forecast.p80,
                p95: forecast.p95,
                suggestedStock: Math.ceil(forecast.p80 * 1.1)
              }));
              
              generated = true;
            } catch (error) {
              console.error(`Error generating forecast for customer ${customer._id}:`, error);
              
              if (existingForecasts.length > 0) {
                console.log(`Using cached forecasts for customer ${customer._id} due to generation error`);
                forecasts = existingForecasts.map(f => ({
                  date: f.date.toISOString().split('T')[0],
                  p50: f.p50,
                  p80: f.p80,
                  p95: f.p95,
                  suggestedStock: f.suggestedStock
                }));
                generated = false;
              } else {
                console.warn(`No forecasts available for customer ${customer._id} and generation failed, skipping`);
                continue;
              }
            }
        } else {
          if (existingForecasts.length > 0) {
            console.log(`Using cached forecasts for customer ${customer._id} (no refresh requested)`);
            forecasts = existingForecasts.map(f => ({
              date: f.date.toISOString().split('T')[0],
              p50: f.p50,
              p80: f.p80,
              p95: f.p95,
              suggestedStock: f.suggestedStock
            }));
          } else {
            console.log(`No cached forecasts for customer ${customer._id} - user must click refresh to generate`);
            forecasts = []; 
          }
          generated = false;
        }
      
        const totalP50 = forecasts.length > 0 ? forecasts.reduce((sum, f) => sum + f.p50, 0) : 0;
        const totalP80 = forecasts.length > 0 ? forecasts.reduce((sum, f) => sum + f.p80, 0) : 0;
        const totalP95 = forecasts.length > 0 ? forecasts.reduce((sum, f) => sum + f.p95, 0) : 0;
        const totalSuggestedStock = forecasts.length > 0 ? forecasts.reduce((sum, f) => sum + f.suggestedStock, 0) : 0;
        const avgDailyDemand = forecasts.length > 0 ? totalP50 / forecasts.length : 0;
        const maxDailyDemand = forecasts.length > 0 ? Math.max(...forecasts.map(f => f.p50)) : 0;
        
        customerForecasts.push({
          customer: {
            _id: customer._id,
            username: customer.username,
            email: customer.email,
            phoneNo: customer.phoneNo,
            businessname: customer.businessname
          },
          forecasts: forecasts,
          summary: {
            totalDays: forecasts.length,
            averageDailyDemand: Math.round(avgDailyDemand * 100) / 100,
            maxDailyDemand: maxDailyDemand,
            totalForecastedDemand: {
              p50: totalP50,
              p80: totalP80,
              p95: totalP95
            },
            totalSuggestedStock: totalSuggestedStock
          },
          generated: generated
        });
      } catch (error) {
        console.error(`Error processing forecast for customer ${customer._id}:`, error);
      }
    }
  
    const allForecasts = await CustomerForecast.find({
      agentId: agentId,
      date: {
        $gte: today,
        $lte: endDate
      }
    }).sort({ lastUpdatedAt: -1 }).limit(1);
    
    const lastUpdatedAt = allForecasts.length > 0 && allForecasts[0].lastUpdatedAt 
      ? allForecasts[0].lastUpdatedAt 
      : null;
    
    return res.status(200).json({
      message: 'Customer forecasts retrieved successfully',
      agentId: agentId,
      horizon: horizon,
      totalCustomers: customers.length,
      customerForecasts: customerForecasts,
      lastUpdatedAt: lastUpdatedAt,
      refreshed: refresh
    });
  } catch (error) {
    console.error('Error in getAgentCustomersForecasts:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
};

module.exports = customerForecastCtrl;

