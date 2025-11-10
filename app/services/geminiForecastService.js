const { GoogleGenerativeAI } = require('@google/generative-ai');
const { exportAgentHistory } = require('../ml/exportAgentHistory');
const Booking = require('../models/booking-model');
const mongoose = require('mongoose');


let genAI;
try {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }
  genAI = new GoogleGenerativeAI(apiKey);
} catch (error) {
  console.error('Error initializing Gemini AI:', error.message);
}

/**
 * Get upcoming scheduled bookings for an agent
 * 
 * @param {string} agentId - MongoDB ObjectId of the agent
 * @param {number} horizon - Number of days to look ahead
 * @returns {Promise<Array>} Array of { date: "YYYY-MM-DD", qty: number } for upcoming bookings
 */
async function getUpcomingBookings(agentId, horizon = 7) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + horizon);
    endDate.setHours(23, 59, 59, 999);
    
    const upcomingBookings = await Booking.find({
      agent: new mongoose.Types.ObjectId(agentId),
      status: { $ne: 'cancelled' },
      deliveryDate: {
        $gte: today,
        $lte: endDate
      }
    }).select('quantity deliveryDate status');
    
    const pendingBookings = await Booking.find({
      agent: new mongoose.Types.ObjectId(agentId),
      status: { $in: ['pending', 'confirmed'] },
      $or: [
        { deliveryDate: null },
        { deliveryDate: { $exists: false } }
      ],
      createdAt: {
        $gte: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000) 
      }
    }).select('quantity createdAt status');
    
    const upcomingByDate = {};
    upcomingBookings.forEach(booking => {
      const dateKey = booking.deliveryDate.toISOString().split('T')[0];
      if (!upcomingByDate[dateKey]) {
        upcomingByDate[dateKey] = 0;
      }
      upcomingByDate[dateKey] += booking.quantity || 0;
    });
    
    pendingBookings.forEach(booking => {
      const bookingDate = new Date(booking.createdAt);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const assumedDeliveryDate = bookingDate.toDateString() === today.toDateString() 
        ? tomorrow 
        : new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);
      
      if (assumedDeliveryDate <= endDate) {
        const dateKey = assumedDeliveryDate.toISOString().split('T')[0];
        if (!upcomingByDate[dateKey]) {
          upcomingByDate[dateKey] = 0;
        }
        upcomingByDate[dateKey] += booking.quantity || 0;
      }
    });
  
    return Object.entries(upcomingByDate).map(([date, qty]) => ({ date, qty }));
  } catch (error) {
    console.error(`Error getting upcoming bookings for agent ${agentId}:`, error);
    return [];
  }
}

/**
 * Build a structured prompt for Gemini AI based on agent history
 * 
 * @param {Array} history - Array of { date: "YYYY-MM-DD", qty: number }
 * @param {Array} upcomingBookings - Array of { date: "YYYY-MM-DD", qty: number } for scheduled deliveries
 * @param {number} horizon - Number of days to forecast (default: 7)
 * @returns {string} Formatted prompt for Gemini
 */
function buildForecastPrompt(history, upcomingBookings = [], horizon = 7) {
  const recent7Days = history.slice(-7);
  const todayQty = recent7Days.length > 0 ? recent7Days[recent7Days.length - 1].qty : 0;
  const yesterdayQty = recent7Days.length > 1 ? recent7Days[recent7Days.length - 2].qty : 0;
  const last3DaysAvg = recent7Days.slice(-3).reduce((sum, h) => sum + h.qty, 0) / Math.max(recent7Days.slice(-3).length, 1);
  const last7DaysAvg = recent7Days.reduce((sum, h) => sum + h.qty, 0) / Math.max(recent7Days.length, 1);
  
  const quantities = history.map(h => h.qty).filter(q => q > 0);
  const daysWithDemand = quantities.length;
  const avgDemand = quantities.length > 0 
    ? quantities.reduce((sum, q) => sum + q, 0) / quantities.length 
    : 0;
  const maxDemand = quantities.length > 0 ? Math.max(...quantities) : 0;
  const minDemand = quantities.length > 0 ? Math.min(...quantities) : 0;
  
  const lastDate = history.length > 0 ? history[history.length - 1].date : new Date().toISOString().split('T')[0];
  
  const recentHistory = history.slice(-14);
  const historyText = recentHistory
    .map(h => `${h.date}: ${h.qty} cylinders`)
    .join('\n');
  
  const upcomingText = upcomingBookings.length > 0
    ? upcomingBookings.map(b => `${b.date}: ${b.qty} cylinders (already scheduled)`).join('\n')
    : 'No scheduled deliveries found';

  const totalScheduled = upcomingBookings.reduce((sum, b) => sum + b.qty, 0);
  

  const hasRecentActivity = todayQty > 0 || yesterdayQty > 0 || last3DaysAvg > 0;
  const hasScheduledBookings = upcomingBookings.length > 0;
  const hasSufficientHistory = daysWithDemand >= 5; 
  
  const prompt = `You are an expert demand forecasting AI for a commercial LPG (Liquefied Petroleum Gas) cylinder distribution business.

**Context:**
- Agents supply LPG cylinders to hotels/restaurants (commercial customers)
- Customers are pre-assigned to specific agents
- Forecast the next ${horizon} days of daily cylinder demand
- IMPORTANT: Account for ALREADY SCHEDULED deliveries when predicting additional demand

**ALREADY SCHEDULED DELIVERIES (CRITICAL - DO NOT DOUBLE COUNT):**
${upcomingText}
- Total already scheduled: ${totalScheduled} cylinders

**Recent Booking Pattern:**
- Today's bookings: ${todayQty} cylinders
- Yesterday's bookings: ${yesterdayQty} cylinders
- Last 3 days average: ${last3DaysAvg.toFixed(1)} cylinders
- Last 7 days average: ${last7DaysAvg.toFixed(1)} cylinders

**Historical Demand Data (Last 14 days):**
${historyText}

**Overall Statistics:**
- Days with actual demand: ${daysWithDemand} out of ${history.length} total days
- Average daily demand (non-zero days only): ${avgDemand.toFixed(2)} cylinders
- Maximum daily demand: ${maxDemand} cylinders
- Minimum daily demand: ${minDemand} cylinders
- Last date in history: ${lastDate}

**Data Quality:**
- Has recent activity: ${hasRecentActivity ? 'Yes' : 'No'}
- Has scheduled bookings: ${hasScheduledBookings ? 'Yes' : 'No'}
- Has sufficient history: ${hasSufficientHistory ? 'Yes' : 'No'}

**Task:**
Generate a demand forecast for the next ${horizon} days starting from tomorrow.
Provide predictions in JSON format as an array of objects, where each object has:
- date: "YYYY-MM-DD" format
- p50: median forecast (expected ADDITIONAL demand, NOT including already scheduled)
- p80: 80th percentile forecast (p50 * 1.1, conservative buffer)
- p95: 95th percentile forecast (p50 * 1.2, moderate buffer)

**CRITICAL REQUIREMENTS:**
1. **ACCOUNT FOR SCHEDULED DELIVERIES**: If ${totalScheduled} cylinders are already scheduled, predict ONLY ADDITIONAL demand beyond what's scheduled. DO NOT include scheduled deliveries in p50/p80/p95.

2. **USE RECENT PATTERNS**: ${hasRecentActivity ? `Agent had ${todayQty} today and ${yesterdayQty} yesterday. Use these as baseline for ADDITIONAL demand prediction.` : 'No recent activity. Be conservative.'}

3. **BE REALISTIC**: ${!hasSufficientHistory ? 'Limited history available. Predict conservatively (0-2 cylinders per day unless recent activity suggests otherwise).' : 'Use historical patterns but prioritize recent activity.'}

4. **PREDICTION STRATEGY**:
   ${hasScheduledBookings ? `- Days with scheduled deliveries: Predict minimal additional demand (0-1 cylinders) unless recent patterns suggest otherwise` : '- No scheduled deliveries found. Predict based on recent booking patterns.'}
   ${hasRecentActivity ? `- Recent activity suggests: ${Math.round(last3DaysAvg)} cylinders/day average. Predict similar ADDITIONAL demand.` : '- No recent activity: Predict 0-1 cylinders per day.'}
   ${!hasRecentActivity && !hasScheduledBookings ? '- Very limited data: Default to 0-1 cylinders per day (conservative estimate)' : ''}

5. **FORMULA**:
   - p50 = Expected additional demand (NOT including scheduled)
   - p80 = p50 * 1.1 (small safety buffer)
   - p95 = p50 * 1.2 (moderate safety buffer)
   - All values must be non-negative integers
   - If p50 = 0, then p80 = 0 and p95 = 0

6. **ACCURACY**: ${totalScheduled > 0 ? `Since ${totalScheduled} cylinders are already scheduled, predict only NEW/ADDITIONAL bookings that might come in.` : 'Predict total expected demand for each day.'}

**Output Format (JSON only, no additional text):**
[
  { "date": "YYYY-MM-DD", "p50": number, "p80": number, "p95": number },
  ...
]

Generate the forecast now (remember: p50/p80/p95 should NOT include already scheduled deliveries):`;

  return prompt;
}

/**
 * Parse Gemini AI response and extract forecast JSON
 * 
 * @param {string} responseText - Raw response from Gemini
 * @returns {Array} Parsed forecast array
 */
function parseGeminiResponse(responseText) {
  try {

    let jsonText = responseText.trim();
  
    jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }
    
    const forecast = JSON.parse(jsonText);
    
    if (!Array.isArray(forecast)) {
      throw new Error('Forecast must be an array');
    }
    
    forecast.forEach((entry, index) => {
      if (!entry.date || entry.p50 === undefined || entry.p50 === null || 
          entry.p80 === undefined || entry.p80 === null || 
          entry.p95 === undefined || entry.p95 === null) {
        throw new Error(`Invalid forecast entry at index ${index}: missing required fields`);
      }
      
      let expectedP80, expectedP95;
      if (entry.p50 > 0) {
        expectedP80 = Math.round(entry.p50 * 1.1);
        expectedP95 = Math.round(entry.p50 * 1.2);
      } else {
        expectedP80 = 0;
        expectedP95 = 0;
      }
      entry.p80 = expectedP80;
      entry.p95 = expectedP95;
      
      entry.p50 = Math.max(0, Math.round(entry.p50));
      entry.p80 = Math.max(0, Math.round(entry.p80));
      entry.p95 = Math.max(0, Math.round(entry.p95));
    });
    
    return forecast;
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    console.error('Response text:', responseText);
    throw new Error(`Failed to parse Gemini response: ${error.message}`);
  }
}

/**
 * Generate forecast using Gemini AI
 * 
 * @param {string} agentId - MongoDB ObjectId of the agent
 * @param {number} horizon - Number of days to forecast (default: 7)
 * @param {number} historyDays - Number of days of history to use (default: 60)
 * @returns {Promise<Array>} Forecast array: [{ date: "YYYY-MM-DD", p50, p80, p95 }, ...]
 */
async function generateForecast(agentId, horizon = 7, historyDays = 60) {
  let history = []; 
  try {
    if (!genAI) {
      throw new Error('Gemini AI is not initialized. Check GEMINI_API_KEY environment variable.');
    }

    console.log(`Generating forecast for agent ${agentId} with ${horizon} day horizon...`);
    history = await exportAgentHistory(agentId, historyDays);
    const upcomingBookings = await getUpcomingBookings(agentId, horizon);
    
    console.log(`Found ${upcomingBookings.length} upcoming scheduled bookings for agent ${agentId}`);
    if (upcomingBookings.length > 0) {
      const totalScheduled = upcomingBookings.reduce((sum, b) => sum + b.qty, 0);
      console.log(`Total scheduled: ${totalScheduled} cylinders in next ${horizon} days`);
    }
    
    if (!history || history.length === 0) {
      console.warn(`No history found for agent ${agentId}. Generating default forecast.`);
      return generateDefaultForecast(horizon, [], upcomingBookings);
    }


    const prompt = buildForecastPrompt(history, upcomingBookings, horizon);
    
    const preferredModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const fallbackModels = ['gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    const modelNames = [preferredModel, ...fallbackModels.filter(m => m !== preferredModel)];
    
    console.log(`[Gemini] Using preferred model: ${preferredModel} (from ${process.env.GEMINI_MODEL ? 'GEMINI_MODEL env' : 'default'})`);
    console.log(`[Gemini] Fallback models: ${fallbackModels.filter(m => m !== preferredModel).join(', ')}`);
    
    let result;
    let response;
    let responseText;
    let lastError;
    
    for (const modelName of modelNames) {
      try {
        console.log(`Trying Gemini model: ${modelName} for agent ${agentId}...`);
        const model = genAI.getGenerativeModel({ model: modelName });
        result = await model.generateContent(prompt);
        response = await result.response;
        responseText = response.text();
        console.log(`Successfully used model: ${modelName}`);
        break; 
      } catch (error) {
        lastError = error;
        const errorMessage = error.message || '';
        
        if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests') || errorMessage.includes('quota')) {
          console.warn(`Model ${modelName} rate limited. Waiting before trying next model...`);
        
          let retryDelay = 60000;
          try {
            const retryMatch = errorMessage.match(/retry in (\d+\.?\d*)s/i);
            if (retryMatch) {
              retryDelay = Math.ceil(parseFloat(retryMatch[1]) * 1000);
            }
          } catch (e) {
          }
          
          console.log(`Waiting ${Math.ceil(retryDelay / 1000)} seconds before trying next model...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          
          continue;
        }
        
        console.warn(`Model ${modelName} failed:`, error.message);
        continue;
      }
    }
    
    if (!responseText) {
      throw new Error(`All Gemini models failed. Last error: ${lastError?.message || 'Unknown error'}`);
    }
    
    let forecast = parseGeminiResponse(responseText);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const scheduledByDate = {};
    const totalScheduled = upcomingBookings.reduce((sum, b) => sum + b.qty, 0);
    upcomingBookings.forEach(b => {
      scheduledByDate[b.date] = (scheduledByDate[b.date] || 0) + b.qty;
    });
    
    const recent7Days = history.slice(-7);
    const todayQty = recent7Days.length > 0 ? recent7Days[recent7Days.length - 1].qty : 0;
    const yesterdayQty = recent7Days.length > 1 ? recent7Days[recent7Days.length - 2].qty : 0;
    const last3DaysAvg = recent7Days.slice(-3).reduce((sum, h) => sum + h.qty, 0) / Math.max(recent7Days.slice(-3).length, 1);
    const last7DaysTotal = recent7Days.reduce((sum, h) => sum + h.qty, 0);
    
    const quantities = history.map(h => h.qty).filter(q => q > 0);
    const totalHistoricalDemand = quantities.reduce((sum, q) => sum + q, 0);
    const daysWithDemand = quantities.length;
    const avgDemandPerActiveDay = daysWithDemand > 0 ? totalHistoricalDemand / daysWithDemand : 0;
    
    const isLowActivity = totalScheduled <= 3 && last7DaysTotal <= 3 && daysWithDemand <= 5;
    const isVeryLowActivity = totalScheduled <= 2 && last7DaysTotal <= 2;
    
    console.log(`Activity level: ${isVeryLowActivity ? 'VERY LOW' : isLowActivity ? 'LOW' : 'NORMAL'}`);
    console.log(`Total scheduled: ${totalScheduled}, Last 7 days total: ${last7DaysTotal}, Days with demand: ${daysWithDemand}`);
    
    forecast = forecast.map((entry, index) => {
      const forecastDate = new Date(today);
      forecastDate.setDate(forecastDate.getDate() + index + 1);
      const dateKey = forecastDate.toISOString().split('T')[0];
      
      const scheduledQty = scheduledByDate[dateKey] || 0;
      let p50 = entry.p50;
      
      if (isVeryLowActivity) {
        if (scheduledQty > 0) {
          p50 = 0;
        } else {
          p50 = Math.min(p50, 1); 
        }
      } else if (isLowActivity) {
        if (scheduledQty > 0) {
          p50 = Math.min(p50, 1); 
        } else {
          p50 = Math.min(p50, 2); 
        }
      } else {
        if (scheduledQty > 0) {
          p50 = Math.min(p50, Math.max(1, Math.round(avgDemandPerActiveDay * 0.5)));
        } else {
          if (todayQty > 0 || yesterdayQty > 0) {
            const recentAvg = Math.round((todayQty + yesterdayQty) / 2);
            p50 = Math.min(p50, Math.max(recentAvg, Math.round(last3DaysAvg)));
          }
          p50 = Math.min(p50, Math.max(1, Math.round(avgDemandPerActiveDay * 2)));
        }
      }
      
      p50 = Math.max(0, Math.round(p50));
      
      const bufferMultiplier = isVeryLowActivity ? 1.0 : (isLowActivity ? 1.05 : 1.1);
      const p80 = Math.max(0, Math.round(p50 * bufferMultiplier));
      const p95 = Math.max(0, Math.round(p50 * (bufferMultiplier + 0.1)));
      
      
      return {
        date: dateKey,
        p50: p50, 
        p80: p80,
        p95: p95, 
        scheduledQty: scheduledQty 
      };
    });
    
    if (forecast.length < horizon) {
      console.warn(`Forecast has ${forecast.length} days, expected ${horizon}. Padding with conservative values.`);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      while (forecast.length < horizon) {
        const nextDate = new Date(today);
        nextDate.setDate(nextDate.getDate() + forecast.length + 1);
        const dateKey = nextDate.toISOString().split('T')[0];
        const scheduledQty = scheduledByDate[dateKey] || 0;
        
    
        forecast.push({
          date: dateKey,
          p50: scheduledQty > 0 ? 0 : 1,
          p80: scheduledQty > 0 ? 0 : 1,
          p95: scheduledQty > 0 ? 1 : 2,
          scheduledQty: scheduledQty
        });
      }
    } else if (forecast.length > horizon) {
      forecast = forecast.slice(0, horizon);
    }
    
    const finalForecast = forecast.map(({ scheduledQty, ...rest }) => rest);
    
    console.log(`Successfully generated forecast for agent ${agentId}: ${finalForecast.length} days`);
    console.log(`Forecast summary: Avg p50 = ${(finalForecast.reduce((sum, f) => sum + f.p50, 0) / finalForecast.length).toFixed(1)} cylinders/day`);
    return finalForecast;
  } catch (error) {
    console.error(`Error generating forecast for agent ${agentId}:`, error);
    
    console.log('Falling back to default forecast...');
    const upcomingBookingsFallback = await getUpcomingBookings(agentId, horizon).catch(() => []);
    return generateDefaultForecast(horizon, history, upcomingBookingsFallback);
  }
}

/**
 * Generate a default forecast when history is unavailable or AI fails
 * Uses recent booking patterns if available, accounts for scheduled bookings
 * 
 * @param {number} horizon - Number of days to forecast
 * @param {Array} recentHistory - Recent booking history to use for pattern matching
 * @param {Array} upcomingBookings - Upcoming scheduled bookings
 * @returns {Array} Default forecast array
 */
function generateDefaultForecast(horizon, recentHistory = [], upcomingBookings = []) {
  const forecast = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const scheduledByDate = {};
  upcomingBookings.forEach(b => {
    scheduledByDate[b.date] = (scheduledByDate[b.date] || 0) + b.qty;
  });
  
  const recent7Days = recentHistory.slice(-7);
  const todayQty = recent7Days.length > 0 ? recent7Days[recent7Days.length - 1].qty : 0;
  const yesterdayQty = recent7Days.length > 1 ? recent7Days[recent7Days.length - 2].qty : 0;
  const last3DaysAvg = recent7Days.slice(-3).reduce((sum, h) => sum + h.qty, 0) / Math.max(recent7Days.slice(-3).length, 1);
  
 
  let baseAdditionalDemand;
  if (todayQty > 0 || yesterdayQty > 0) {
    baseAdditionalDemand = Math.max(1, Math.round((todayQty + yesterdayQty) / 2));
  } else if (last3DaysAvg > 0) {
    baseAdditionalDemand = Math.max(1, Math.round(last3DaysAvg));
  } else {
    baseAdditionalDemand = 1;
  }
  
  for (let i = 1; i <= horizon; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dateKey = date.toISOString().split('T')[0];
    
    const scheduledQty = scheduledByDate[dateKey] || 0;

    let p50;
    if (scheduledQty > 0) {
      p50 = i === 1 ? Math.min(baseAdditionalDemand, 1) : 0;
    } else {
      p50 = i === 1 ? baseAdditionalDemand : Math.max(0, Math.round(baseAdditionalDemand * 0.8));
    }
    
    const p80 = Math.max(0, Math.round(p50 * 1.1));
    const p95 = Math.max(0, Math.round(p50 * 1.2));
    
    forecast.push({
      date: dateKey,
      p50: Math.max(0, p50),
      p80: p80,
      p95: p95
    });
  }
  
  return forecast;
}

module.exports = {
  generateForecast,
  buildForecastPrompt,
  parseGeminiResponse
};

