const { GoogleGenerativeAI } = require('@google/generative-ai');
const { exportCustomerHistory } = require('../ml/exportCustomerHistory');

/**
 * Customer Forecast Service
 * Uses Google Gemini AI to generate demand forecasts for individual customers
 * Processes historical booking data and returns structured forecast predictions
 */

// Initialize Gemini AI client
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
 * Generate forecast for a customer using Gemini AI
 * 
 * @param {string} customerId - MongoDB ObjectId of the customer
 * @param {string} agentId - MongoDB ObjectId of the agent (for context)
 * @param {number} horizon - Number of days to forecast (default: 7)
 * @param {number} historyDays - Number of days of history to use (default: 60)
 * @returns {Promise<Array>} Forecast array: [{ date: "YYYY-MM-DD", p50, p80, p95 }, ...]
 */
async function generateCustomerForecast(customerId, agentId, horizon = 7, historyDays = 60) {
  let history = []; // Declare history outside try block for error handler access
  try {
    if (!genAI) {
      throw new Error('Gemini AI is not initialized. Check GEMINI_API_KEY environment variable.');
    }

    // Step 1: Export customer history
    console.log(`Generating forecast for customer ${customerId} with ${horizon} day horizon...`);
    history = await exportCustomerHistory(customerId, historyDays);
    
    if (!history || history.length === 0) {
      console.warn(`No history found for customer ${customerId}. Generating default forecast.`);
      // Generate a default forecast
      return generateDefaultForecast(horizon, []);
    }

    // Step 2: Build prompt
    const prompt = buildCustomerForecastPrompt(history, horizon);
    
    // Step 3: Call Gemini API
    // Use model from environment variable, with fallbacks
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
        console.log(`Trying Gemini model: ${modelName} for customer ${customerId}...`);
        const model = genAI.getGenerativeModel({ model: modelName });
        result = await model.generateContent(prompt);
        response = await result.response;
        responseText = response.text();
        console.log(`Successfully used model: ${modelName}`);
        break; // Success, exit loop
      } catch (error) {
        lastError = error;
        const errorMessage = error.message || '';
        
        // Handle rate limit errors (429) with exponential backoff
        if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests') || errorMessage.includes('quota')) {
          console.warn(`Model ${modelName} rate limited. Waiting before trying next model...`);
          
          // Extract retry delay from error if available, otherwise use 60 seconds
          let retryDelay = 60000; // Default: 60 seconds
          try {
            const retryMatch = errorMessage.match(/retry in (\d+\.?\d*)s/i);
            if (retryMatch) {
              retryDelay = Math.ceil(parseFloat(retryMatch[1]) * 1000);
            }
          } catch (e) {
            // Ignore parsing errors, use default
          }
          
          console.log(`Waiting ${Math.ceil(retryDelay / 1000)} seconds before trying next model...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          
          // Don't continue to next model immediately after rate limit - wait is already done
          // Continue to next model in the list
          continue;
        }
        
        console.warn(`Model ${modelName} failed:`, error.message);
        // Continue to next model
        continue;
      }
    }
    
    if (!responseText) {
      // All models failed, throw the last error
      throw new Error(`All Gemini models failed. Last error: ${lastError?.message || 'Unknown error'}`);
    }
    
    // Step 4: Parse response
    let forecast = parseGeminiResponse(responseText);
    
    // Step 5: Validate forecast dates and enhance with recent patterns
    const lastHistoryDate = new Date(history[history.length - 1].date);
    const recent7Days = history.slice(-7);
    const todayQty = recent7Days.length > 0 ? recent7Days[recent7Days.length - 1].qty : 0;
    const yesterdayQty = recent7Days.length > 1 ? recent7Days[recent7Days.length - 2].qty : 0;
    const last3DaysAvg = recent7Days.slice(-3).reduce((sum, h) => sum + h.qty, 0) / Math.max(recent7Days.slice(-3).length, 1);
    
    forecast = forecast.map((entry, index) => {
      const forecastDate = new Date(lastHistoryDate);
      forecastDate.setDate(forecastDate.getDate() + index + 1);
      
      // For tomorrow (first day), prioritize recent bookings
      let p50 = entry.p50;
      if (index === 0 && (todayQty > 0 || yesterdayQty > 0)) {
        // If customer booked today/yesterday, tomorrow should be similar
        const recentAvg = Math.round((todayQty + yesterdayQty) / 2);
        if (recentAvg > 0) {
          p50 = Math.max(recentAvg, Math.round(last3DaysAvg), entry.p50);
        }
      } else if (index < 3 && last3DaysAvg > 0) {
        // For first 3 days, use recent average if available
        p50 = Math.max(Math.round(last3DaysAvg), entry.p50);
      }
      
      return {
        date: forecastDate.toISOString().split('T')[0],
        p50: Math.max(0, Math.round(p50)),
        p80: Math.max(0, Math.round(p50 * 1.15)),
        p95: Math.max(0, Math.round(p50 * 1.25))
      };
    });
    
    // Ensure we have exactly the requested number of days
    if (forecast.length < horizon) {
      console.warn(`Forecast has ${forecast.length} days, expected ${horizon}. Padding with last value.`);
      const lastEntry = forecast[forecast.length - 1] || { p50: 0, p80: 0, p95: 0 };
      while (forecast.length < horizon) {
        const nextDate = new Date(forecast[forecast.length - 1].date);
        nextDate.setDate(nextDate.getDate() + 1);
        forecast.push({
          date: nextDate.toISOString().split('T')[0],
          p50: lastEntry.p50,
          p80: lastEntry.p80,
          p95: lastEntry.p95
        });
      }
    } else if (forecast.length > horizon) {
      forecast = forecast.slice(0, horizon);
    }
    
    console.log(`Successfully generated forecast for customer ${customerId}: ${forecast.length} days`);
    return forecast;
  } catch (error) {
    console.error(`Error generating forecast for customer ${customerId}:`, error);
    
    // Fallback to default forecast on error (use recent history if available)
    console.log('Falling back to default forecast...');
    return generateDefaultForecast(horizon, history);
  }
}

/**
 * Build a structured prompt for Gemini AI based on customer history
 */
function buildCustomerForecastPrompt(history, horizon = 7) {
  // Get recent booking patterns (last 7 days) - this is critical for tomorrow's prediction
  const recent7Days = history.slice(-7);
  const todayQty = recent7Days.length > 0 ? recent7Days[recent7Days.length - 1].qty : 0;
  const yesterdayQty = recent7Days.length > 1 ? recent7Days[recent7Days.length - 2].qty : 0;
  const last3DaysAvg = recent7Days.slice(-3).reduce((sum, h) => sum + h.qty, 0) / Math.max(recent7Days.slice(-3).length, 1);
  const last7DaysAvg = recent7Days.reduce((sum, h) => sum + h.qty, 0) / Math.max(recent7Days.length, 1);
  
  // Calculate basic statistics from history
  const quantities = history.map(h => h.qty).filter(q => q > 0);
  const avgDemand = quantities.length > 0 
    ? quantities.reduce((sum, q) => sum + q, 0) / quantities.length 
    : 0;
  const maxDemand = quantities.length > 0 ? Math.max(...quantities) : 0;
  const minDemand = quantities.length > 0 ? Math.min(...quantities) : 0;
  
  // Get the last date in history
  const lastDate = history.length > 0 ? history[history.length - 1].date : new Date().toISOString().split('T')[0];
  
  // Format recent history data for prompt (show last 14 days for context)
  const recentHistory = history.slice(-14);
  const historyText = recentHistory
    .map(h => `${h.date}: ${h.qty} cylinders`)
    .join('\n');

  const prompt = `You are an expert demand forecasting AI for a commercial LPG (Liquefied Petroleum Gas) cylinder distribution business.

**Context:**
- This is for a single customer (hotel/restaurant) ordering LPG cylinders
- Forecast the next ${horizon} days (1 week) of daily cylinder demand
- IMPORTANT: Recent booking patterns are the best predictor for immediate future demand

**Recent Booking Pattern (CRITICAL FOR PREDICTION):**
- Today's booking: ${todayQty} cylinders
- Yesterday's booking: ${yesterdayQty} cylinders
- Last 3 days average: ${last3DaysAvg.toFixed(1)} cylinders
- Last 7 days average: ${last7DaysAvg.toFixed(1)} cylinders

**Historical Demand Data (Last 14 days):**
${historyText}

**Overall Statistics:**
- Average daily demand (all time): ${avgDemand.toFixed(2)} cylinders
- Maximum daily demand: ${maxDemand} cylinders
- Minimum daily demand: ${minDemand} cylinders
- Total data points: ${history.length} days
- Last date in history: ${lastDate}

**Task:**
Generate a demand forecast for the next ${horizon} days (1 week) starting from tomorrow.
Provide predictions in JSON format as an array of objects, where each object has:
- date: "YYYY-MM-DD" format
- p50: median forecast (expected demand)
- p80: 80th percentile forecast (p50 * 1.15)
- p95: 95th percentile forecast (p50 * 1.25)

**CRITICAL REQUIREMENTS:**
1. **PRIORITIZE RECENT PATTERNS**: If customer booked ${todayQty} cylinders today and ${yesterdayQty} yesterday, they will likely need similar quantity tomorrow (${Math.max(todayQty, yesterdayQty, Math.round(last3DaysAvg))} cylinders)
2. Recent booking patterns (last 2-3 days) are more important than long-term averages
3. If today's booking is ${todayQty} and yesterday's is ${yesterdayQty}, tomorrow should be similar (around ${Math.max(todayQty, yesterdayQty)} cylinders)
4. Consider day-of-week patterns only if there's clear weekly pattern
5. For the first day (tomorrow), use the average of today and yesterday: ${Math.round((todayQty + yesterdayQty) / 2)} cylinders
6. p50 should reflect recent booking patterns, not just historical average
7. p80 = p50 * 1.15 (moderate safety buffer)
8. p95 = p50 * 1.25 (high safety buffer)
9. All values must be non-negative integers
10. Keep predictions realistic based on recent activity

**Output Format (JSON only, no additional text):**
[
  { "date": "YYYY-MM-DD", "p50": number, "p80": number, "p95": number },
  ...
]

Generate the forecast now:`;

  return prompt;
}

/**
 * Parse Gemini AI response and extract forecast JSON
 */
function parseGeminiResponse(responseText) {
  try {
    // Try to extract JSON from the response
    let jsonText = responseText.trim();
    
    // Remove markdown code blocks if present
    jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    // Try to find JSON array in the response
    const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }
    
    const forecast = JSON.parse(jsonText);
    
    // Validate forecast structure
    if (!Array.isArray(forecast)) {
      throw new Error('Forecast must be an array');
    }
    
    // Validate each forecast entry
    forecast.forEach((entry, index) => {
      // Check for missing or null/undefined values (but allow 0 as a valid value)
      if (!entry.date || entry.p50 === undefined || entry.p50 === null || 
          entry.p80 === undefined || entry.p80 === null || 
          entry.p95 === undefined || entry.p95 === null) {
        throw new Error(`Invalid forecast entry at index ${index}: missing required fields`);
      }
      
      // Ensure p80 and p95 match the formula (but only if p50 > 0, otherwise keep them at 0)
      let expectedP80, expectedP95;
      if (entry.p50 > 0) {
        expectedP80 = Math.round(entry.p50 * 1.15);
        expectedP95 = Math.round(entry.p50 * 1.25);
      } else {
        // If p50 is 0, p80 and p95 should also be 0
        expectedP80 = 0;
        expectedP95 = 0;
      }
      
      // Use calculated values to ensure consistency
      entry.p80 = expectedP80;
      entry.p95 = expectedP95;
      
      // Ensure all values are non-negative integers
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
 * Generate a default forecast when history is unavailable or AI fails
 * Uses recent booking patterns if available
 */
function generateDefaultForecast(horizon, recentHistory = []) {
  const forecast = [];
  const today = new Date();
  
  // Try to get recent booking pattern
  const recent7Days = recentHistory.slice(-7);
  const todayQty = recent7Days.length > 0 ? recent7Days[recent7Days.length - 1].qty : 0;
  const yesterdayQty = recent7Days.length > 1 ? recent7Days[recent7Days.length - 2].qty : 0;
  const last3DaysAvg = recent7Days.slice(-3).reduce((sum, h) => sum + h.qty, 0) / Math.max(recent7Days.slice(-3).length, 1);
  
  // Use recent average if available, otherwise default to 2
  const baseDemand = Math.max(Math.round(last3DaysAvg), Math.round((todayQty + yesterdayQty) / 2), 2);
  
  for (let i = 1; i <= horizon; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    
    // For tomorrow, use recent pattern; for later days, slightly reduce
    const p50 = i === 1 ? baseDemand : Math.max(1, Math.round(baseDemand * 0.9));
    const p80 = Math.ceil(p50 * 1.15);
    const p95 = Math.ceil(p50 * 1.25);
    
    forecast.push({
      date: date.toISOString().split('T')[0],
      p50,
      p80,
      p95
    });
  }
  
  return forecast;
}

module.exports = {
  generateCustomerForecast
};

