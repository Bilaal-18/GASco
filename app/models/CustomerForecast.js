const mongoose = require('mongoose');

/**
 * CustomerForecast Model
 * Stores AI-generated demand forecasts for each customer
 * Forecasts include percentile predictions (p50, p80, p95) and suggested stock levels
 */
const customerForecastSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true,
    index: true // Index for faster queries by customerId
  },
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true,
    index: true // Index for faster queries by agentId
  },
  date: {
    type: Date,
    required: true,
    index: true // Index for faster date queries
  },
  p50: {
    type: Number,
    required: true,
    min: 0,
    comment: 'Median forecast (50th percentile) - expected demand'
  },
  p80: {
    type: Number,
    required: true,
    min: 0,
    comment: '80th percentile forecast - p50 * 1.15'
  },
  p95: {
    type: Number,
    required: true,
    min: 0,
    comment: '95th percentile forecast - p50 * 1.25'
  },
  suggestedStock: {
    type: Number,
    required: true,
    min: 0,
    comment: 'Recommended stock level with safety buffer - Math.ceil(p80 * 1.1)'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true // Index for tracking when forecast was generated
  },
  lastUpdatedAt: {
    type: Date,
    default: Date.now,
    index: true // Index for tracking when forecast was last updated
  }
}, {
  timestamps: true // Adds createdAt and updatedAt automatically
});

// Compound index for efficient queries: customerId + date
customerForecastSchema.index({ customerId: 1, date: 1 }, { unique: true });

// Compound index for agent queries: agentId + date
customerForecastSchema.index({ agentId: 1, date: 1 });

// Index for querying forecasts by date range
customerForecastSchema.index({ date: 1, customerId: 1 });

module.exports = mongoose.model('CustomerForecast', customerForecastSchema, 'customer_forecasts');


