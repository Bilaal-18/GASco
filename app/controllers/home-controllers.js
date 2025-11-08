const Cylinder = require('../models/cylinder-model');
const User = require('../models/user-model');

const homeCtrl = {};

//! <-------------------GET VIEW ALL STATS--------------------> !\\
homeCtrl.getPublicStats = async (req, res) => {
  try {
    const [agentsCount, customersCount] = await Promise.all([
      User.countDocuments({ role: 'agent' }),
      User.countDocuments({ role: 'customer' })
    ]);

    res.status(200).json({
      agents: agentsCount,
      customers: customersCount,
    });
  } catch (err) {
    console.error('Error fetching public stats:', err);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
};

//! <--------------------CYLINDERS AVAILABLE--------------------> !\\
homeCtrl.getPublicCylinders = async (req, res) => {
  try {
    const cylinders = await Cylinder.find({ available: true })
      .select('cylinderName cylinderType weight price')
      .sort({ cylinderName: 1, cylinderType: 1 });

    const groupedCylinders = {};
    cylinders.forEach(cylinder => {
      const key = `${cylinder.cylinderName}-${cylinder.cylinderType}`;
      if (!groupedCylinders[key]) {
        groupedCylinders[key] = {
          cylinderName: cylinder.cylinderName,
          cylinderType: cylinder.cylinderType,
          weight: cylinder.weight,
          price: cylinder.price,
        };
      }
    });

    const uniqueCylinders = Object.values(groupedCylinders);

    res.status(200).json({
      cylinders: uniqueCylinders,
      totalTypes: uniqueCylinders.length,
    });
  } catch (err) {
    console.error('Error fetching public cylinders:', err);
    res.status(500).json({ error: 'Failed to fetch cylinders' });
  }
};

module.exports = homeCtrl;








