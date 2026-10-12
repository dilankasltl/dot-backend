const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  epfNo: { type: String, required: true, unique: true, index: true },
  fullName: { type: String, required: true, index: true },
  department: { type: String, default: 'General' },
}, { timestamps: true });

// Text index for fast search by EPF or Name
employeeSchema.index({ epfNo: 'text', fullName: 'text' });

module.exports = mongoose.model('Employee', employeeSchema);
