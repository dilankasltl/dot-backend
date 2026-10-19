const mongoose = require('mongoose');

const dotRecordSchema = new mongoose.Schema({
  epfNo: { type: String, required: true, index: true },
  fullName: { type: String, required: true },
  department: { type: String, default: '' },
  unit: { type: String, default: '' },
  shiftName: { type: String, default: '' },
  present: { type: String, default: 'Yes' },
  firstDate: { type: String, default: '' },
  workHrs: { type: Number, default: 0 },
  inTime: { type: String, default: '' },
  outTime: { type: String, default: '' },
  dotReason: { type: String, default: '' }, // 'Shift Off' | 'Work Hrs >= 19' | 'Both'
  vinodStatus: { 
    type: String, 
    enum: ['APPROVED', 'PENDING', 'NOT_APPROVED', 'REJECTED'],
    default: 'NOT_APPROVED' 
  },
  vinodReqNumber: { type: String, default: '' },
  vinodReqId: { type: String, default: '' }
}, { _id: true });

const attendanceAuditSchema = new mongoose.Schema({
  reportDate: { type: String, required: true, unique: true, index: true }, // e.g., '2026-10-16'
  rawDateStr: { type: String, default: '' }, // e.g., '10/16/2026'
  uploadedBy: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },
  totalReportRows: { type: Number, default: 0 },
  dotCount: { type: Number, default: 0 },
  dotRecords: [dotRecordSchema]
}, { timestamps: true });

module.exports = mongoose.model('AttendanceAudit', attendanceAuditSchema);
