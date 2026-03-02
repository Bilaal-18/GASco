const mongoose = require('mongoose');

const agentForecastSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true,
    index: true 
  },
  date: {
    type: Date,
    required: true,
    index: true 
  },
  p50: {
    type: Number,
    required: true,
    min: 0,
    // comment: 'Median forecast (50th percentile) - expected demand'
  },
  p80: {
    type: Number,
    required: true,
    min: 0,
    // comment: '80th percentile forecast - p50 * 1.15'
  },
  p95: {
    type: Number,
    required: true,
    min: 0,
    // comment: '95th percentile forecast - p50 * 1.25'
  },
  suggestedStock: {
    type: Number,
    required: true,
    min: 0,
    // comment: 'Recommended stock level with safety buffer - Math.ceil(p80 * 1.1)'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true 
  },
  lastUpdatedAt: {
    type: Date,
    default: Date.now,
    index: true 
  }
}, {
  timestamps: true 
});

agentForecastSchema.index({ agentId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('AgentForecast', agentForecastSchema, 'agent_forecasts');


