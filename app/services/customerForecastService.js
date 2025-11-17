const { GoogleGenerativeAI } = require('@google/generative-ai');
const { exportCustomerHistory } = require('../history/exportCustomerHistory');

let genAI;
try {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('key is not correct');
  }
  genAI = new GoogleGenerativeAI(apiKey);
} catch (error) {
  console.error('Error initializing Gemini AI:', error.message);
}

async function generateCustomerForecast(customerId, agentId, horizon = 7, historyDays = 60) {
  let history = []; 
  try {
    if (!genAI) {
      throw new Error('Gemini AI is not initialized. Check GEMINI_API_KEY environment variable.');
    }
    history = await exportCustomerHistory(customerId, historyDays);
    
    if (!history || history.length === 0) {
      return generateDefaultForecast(horizon, []);
    }
    const prompt = buildCustomerForecastPrompt(history, horizon);
    
    const preferredModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const fallbackModels = ['gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    const modelNames = [preferredModel, ...fallbackModels.filter(m => m !== preferredModel)];
    
    let result;
    let response;
    let responseText;
    let lastError;
    
    for (const modelName of modelNames) {
      try {
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
 
          let retryDelay = 60000; 
          try {
            const retryMatch = errorMessage.match(/retry in (\d+\.?\d*)s/i);
            if (retryMatch) {
              retryDelay = Math.ceil(parseFloat(retryMatch[1]) * 1000);
            }
          } catch (e) {
          
          }
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
        continue;
      }
    }
    
    if (!responseText) {
      throw new Error(`All Gemini models failed. Last error: ${lastError?.message || 'Unknown error'}`);
    }
    
    let forecast = parseGeminiResponse(responseText);
    
    const lastHistoryDate = new Date(history[history.length - 1].date);
    const recent7Days = history.slice(-7);
    const todayQty = recent7Days.length > 0 ? recent7Days[recent7Days.length - 1].qty : 0;
    const yesterdayQty = recent7Days.length > 1 ? recent7Days[recent7Days.length - 2].qty : 0;
    const last3DaysAvg = recent7Days.slice(-3).reduce((sum, h) => sum + h.qty, 0) / Math.max(recent7Days.slice(-3).length, 1);
    
    forecast = forecast.map((entry, index) => {
      const forecastDate = new Date(lastHistoryDate);
      forecastDate.setDate(forecastDate.getDate() + index + 1);
      
      let p50 = entry.p50;
      if (index === 0 && (todayQty > 0 || yesterdayQty > 0)) {
        const recentAvg = Math.round((todayQty + yesterdayQty) / 2);
        if (recentAvg > 0) {
          p50 = Math.max(recentAvg, Math.round(last3DaysAvg), entry.p50);
        }
      } else if (index < 3 && last3DaysAvg > 0) {
        p50 = Math.max(Math.round(last3DaysAvg), entry.p50);
      }
      
      return {
        date: forecastDate.toISOString().split('T')[0],
        p50: Math.max(0, Math.round(p50)),
        p80: Math.max(0, Math.round(p50 * 1.15)),
        p95: Math.max(0, Math.round(p50 * 1.25))
      };
    });
    
    if (forecast.length < horizon) {
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
    return forecast;
  } catch (error) {
    console.error('Error generating forecast for customer ', error);
    return generateDefaultForecast(horizon, history);
  }
}


function buildCustomerForecastPrompt(history, horizon = 7) {
  const recent7Days = history.slice(-7);
  const todayQty = recent7Days.length > 0 ? recent7Days[recent7Days.length - 1].qty : 0;
  const yesterdayQty = recent7Days.length > 1 ? recent7Days[recent7Days.length - 2].qty : 0;
  const last3DaysAvg = recent7Days.slice(-3).reduce((sum, h) => sum + h.qty, 0) / Math.max(recent7Days.slice(-3).length, 1);
  const last7DaysAvg = recent7Days.reduce((sum, h) => sum + h.qty, 0) / Math.max(recent7Days.length, 1);

  const quantities = history.map(h => h.qty).filter(q => q > 0);
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
        expectedP80 = Math.round(entry.p50 * 1.15);
        expectedP95 = Math.round(entry.p50 * 1.25);
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


function generateDefaultForecast(horizon, recentHistory = []) {
  const forecast = [];
  const today = new Date();
  
  const recent7Days = recentHistory.slice(-7);
  const todayQty = recent7Days.length > 0 ? recent7Days[recent7Days.length - 1].qty : 0;
  const yesterdayQty = recent7Days.length > 1 ? recent7Days[recent7Days.length - 2].qty : 0;
  const last3DaysAvg = recent7Days.slice(-3).reduce((sum, h) => sum + h.qty, 0) / Math.max(recent7Days.slice(-3).length, 1);
  
  const baseDemand = Math.max(Math.round(last3DaysAvg), Math.round((todayQty + yesterdayQty) / 2), 2);
  
  for (let i = 1; i <= horizon; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    
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

