const mongoose = require('mongoose');

const dotRequestSchema = new mongoose.Schema({
  reqNumber: { type: String, required: true, unique: true },
  requesterUsername: { type: String, required: true },
  requesterName: { type: String, required: true },
  department: { type: String, required: true },
  date: { type: String, required: true }, // e.g., '2026-10-12'
  shift: { type: String, default: 'Shift A' },
  hours: { type: Number, default: 0 },
  reason: { type: String, default: '' },
  employees: [{
    epfNo: { type: String, required: true },
    fullName: { type: String, required: true }
  }],
  employeeCount: { type: Number, default: 0 },
  status: { 
    type: String, 
    required: true,
    enum: ['PENDING_L1', 'PENDING_FINAL', 'APPROVED', 'REJECTED'],
    default: 'PENDING_L1'
  },
  l1Approver: {
    username: { type: String, required: true },
    name: { type: String },
    status: { 
      type: String, 
      enum: ['PENDING', 'APPROVED', 'REJECTED'], 
      default: 'PENDING' 
    },
    actionAt: { type: Date },
    remarks: { type: String, default: '' }
  },
  finalApprover: {
    username: { type: String, default: 'Vinod / Niranjan' },
    name: { type: String, default: 'Mr. Vinod / Mr. Niranjan' },
    status: { 
      type: String, 
      enum: ['PENDING', 'APPROVED', 'REJECTED'], 
      default: 'PENDING' 
    },
    actionAt: { type: Date },
    remarks: { type: String, default: '' }
  },
  // True if globally deleted before any approval (requester cancelled)
  isDeleted: { type: Boolean, default: false },
  // Usernames who have deleted/hidden this request from their own personal list
  hiddenForUsers: [{ type: String }]
}, { timestamps: true });

module.exports = mongoose.model('DotRequest', dotRequestSchema);
