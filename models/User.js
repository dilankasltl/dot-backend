const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  defaultPassword: { type: String, default: '' },
  name: { type: String, required: true },
  role: { 
    type: String, 
    required: true, 
    enum: ['requester', 'approver_l1', 'approver_final', 'admin'] 
  },
  department: { type: String, default: '' },
  // For requesters: which L1 approver receives their requests
  assignedL1Approver: { type: String, default: '' },
  // For L1 approvers: which departments they can approve
  approvedDepartments: [{ type: String }],
  // Permissions
  canViewAllPending: { type: Boolean, default: false },
  canViewCharts: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
