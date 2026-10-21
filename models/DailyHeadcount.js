const mongoose = require('mongoose');

const headcountEmployeeSchema = new mongoose.Schema({
  epfNo: { type: String, required: true, index: true },
  fullName: { type: String, required: true },
  department: { type: String, default: 'General' },
  unit: { type: String, default: 'General' },
  gender: { type: String, default: 'MALE' }, // 'MALE' | 'FEMALE'
  shiftName: { type: String, default: '' },
  present: { type: String, default: 'Yes' }, // 'Yes' | 'No'
  leave: { type: String, default: 'No' }, // 'Yes' | 'No'
  firstDate: { type: String, default: '' },
  inTime: { type: String, default: '' },
  outTime: { type: String, default: '' },
  secondDate: { type: String, default: '' },
  secondInTime: { type: String, default: '' },
  secondOutTime: { type: String, default: '' },
  late: { type: String, default: '' }, // e.g. '00:35'
  lateMinutes: { type: Number, default: 0 },
  isLateOver15: { type: Boolean, default: false }, // Late > 00:15
  earlyDeparture: { type: String, default: '' },
  workHrs: { type: Number, default: 0 },
  rostered: { type: String, default: 'No' }
}, { _id: true });

const dailyHeadcountSchema = new mongoose.Schema({
  reportDate: { type: String, required: true, unique: true, index: true }, // e.g., '2026-10-16'
  rawDateStr: { type: String, default: '' }, // e.g., '10/16/2026'
  uploadedBy: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },

  // Summary Metrics (strictly excluding Number = 00001)
  headcount: { type: Number, default: 0 }, // Total employees excluding 00001
  maleCount: { type: Number, default: 0 },
  femaleCount: { type: Number, default: 0 },
  presentCount: { type: Number, default: 0 },
  absentCount: { type: Number, default: 0 },
  leaveCount: { type: Number, default: 0 },
  lateOver15Count: { type: Number, default: 0 },

  records: [headcountEmployeeSchema]
}, { timestamps: true });

module.exports = mongoose.model('DailyHeadcount', dailyHeadcountSchema);
