const User = require('../models/user-model');
const Cylinder = require('../models/cylinder-model');

const homeCtrl = {};

//! <--------------------PUBLIC STATS--------------------> !\\

homeCtrl.getPublicStats = async (req, res) => {
  try {
    const agentsCount = await User.countDocuments({ role: 'agent' });
    const customersCount = await User.countDocuments({ role: 'customer' });

    res.status(200).json({
      agents: agentsCount,
      customers: customersCount
    });
  } catch (error) {
    console.error('Error fetching public stats:', error);
    res.status(500).json({ 
      error: 'Failed to fetch stats',
      agents: 0,
      customers: 0
    });
  }
};

//! <--------------------PUBLIC CYLINDERS--------------------> !\\

homeCtrl.getPublicCylinders = async (req, res) => {
  try {
    const cylinders = await Cylinder.find({ available: true })
      .select('cylinderName cylinderType weight price')
      .sort({ createdAt: -1 });

    res.status(200).json({
      cylinders: cylinders
    });
  } catch (error) {
    console.error('Error fetching public cylinders:', error);
    res.status(500).json({ 
      error: 'Failed to fetch cylinders',
      cylinders: []
    });
  }
};

module.exports = homeCtrl;
