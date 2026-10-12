const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const User = require('./models/User');
const Employee = require('./models/Employee');
const DotRequest = require('./models/DotRequest');
const { seedDatabase } = require('./seedData');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://savindudilanka9793_db_user:pV0NZVy7kPmsCDIb@cluster0.n6doxsm.mongodb.net/dot_approval_system?retryWrites=true&w=majority&appName=Cluster0';

// Enable CORS for all origins (allowing frontend hosted on Vercel, Netlify, or localhost)
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());

// Connect to MongoDB Atlas & Seed Users/Employees
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB Atlas Connected Successfully');
    await seedDatabase();
  })
  .catch(err => {
    console.error('MongoDB Connection Error:', err);
  });

// Health check endpoint for hosting providers (Render, Railway, Fly.io, etc.)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// --- Auth Routes ---
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Supports user's customized password OR default master password
    const isMatch = (user.password === password) || (user.defaultPassword && user.defaultPassword === password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    res.json({
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        role: user.role,
        department: user.department,
        assignedL1Approver: user.assignedL1Approver,
        approvedDepartments: user.approvedDepartments || [],
        canViewAllPending: user.canViewAllPending,
        canViewCharts: user.canViewCharts,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { username, newPassword } = req.body;
    if (!username || !newPassword) {
      return res.status(400).json({ error: 'Username and new password are required' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User account not found' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password updated successfully. You can log in with your new password or your default password.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/users', async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort({ role: 1, department: 1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Employee Master Routes ---
app.get('/api/employees', async (req, res) => {
  try {
    const search = req.query.search ? req.query.search.trim() : '';
    let query = {};
    if (search) {
      query = {
        $or: [
          { epfNo: { $regex: search, $options: 'i' } },
          { fullName: { $regex: search, $options: 'i' } }
        ]
      };
    }
    const employees = await Employee.find(query).sort({ epfNo: 1 }).limit(100);
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- DOT Requests Routes ---

// Create new DOT request
app.post('/api/requests', async (req, res) => {
  try {
    const { requesterUsername, date, shift, hours, reason, employees } = req.body;

    if (!requesterUsername || !employees || !employees.length) {
      return res.status(400).json({ error: 'Requester and at least one employee are required' });
    }

    const user = await User.findOne({ username: requesterUsername });
    if (!user) {
      return res.status(404).json({ error: 'Requester user not found' });
    }

    // Generate Request Number (DOT-YYYY-XXXX)
    const count = await DotRequest.countDocuments();
    const reqNumber = `DOT-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

    const newRequest = new DotRequest({
      reqNumber,
      requesterUsername: user.username,
      requesterName: user.name,
      department: user.department,
      date: date || new Date().toISOString().split('T')[0],
      shift: shift || 'Day',
      hours: hours || 4,
      reason: reason || 'Production Double OT',
      employees: employees.map(e => ({ epfNo: e.epfNo, fullName: e.fullName })),
      employeeCount: employees.length,
      status: 'PENDING_L1',
      l1Approver: {
        username: user.assignedL1Approver?.replace('Mr. ', '') || 'Dhammika',
        name: user.assignedL1Approver || 'Mr. Dhammika',
        status: 'PENDING',
        remarks: ''
      },
      finalApprover: {
        username: 'Vinod',
        name: 'Mr. Vinod',
        status: 'PENDING',
        remarks: ''
      },
      isDeleted: false,
      hiddenForUsers: []
    });

    await newRequest.save();
    res.status(201).json(newRequest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit request (only allowed if still PENDING_L1)
app.put('/api/requests/:id', async (req, res) => {
  try {
    const { date, shift, hours, reason, employees, requesterUsername } = req.body;
    const request = await DotRequest.findById(req.params.id);

    if (!request || request.isDeleted) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (request.status !== 'PENDING_L1') {
      return res.status(400).json({ error: 'Cannot edit request. It has already been reviewed or approved by HOD.' });
    }

    if (requesterUsername && request.requesterUsername !== requesterUsername) {
      return res.status(403).json({ error: 'Only the original requester can edit this request.' });
    }

    if (date) request.date = date;
    if (shift) request.shift = shift;
    if (hours) request.hours = Number(hours);
    if (reason !== undefined) request.reason = reason;
    if (employees && employees.length > 0) {
      request.employees = employees.map(e => ({ epfNo: e.epfNo, fullName: e.fullName }));
      request.employeeCount = employees.length;
    }

    await request.save();
    res.json(request);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete request
// Rule:
// 1. If requester deletes while still in PENDING_L1 -> globally deleted (HOD and Vinod won't see it).
// 2. If approved or completed data, or deleted by a specific user from their list ->
//    hides ONLY for that user (hiddenForUsers). Other users continue seeing it!
app.delete('/api/requests/:id', async (req, res) => {
  try {
    const username = req.body?.username || req.query?.username;
    const request = await DotRequest.findById(req.params.id);

    if (!request || request.isDeleted) {
      return res.status(404).json({ error: 'Request not found or already deleted' });
    }

    // If requester deletes before any approval -> cancel globally
    if (request.status === 'PENDING_L1' && username && request.requesterUsername === username) {
      request.isDeleted = true;
      await request.save();
      return res.json({ message: 'Request cancelled and deleted globally', id: req.params.id });
    }

    // If approved or deleted by HOD/Mr. Vinod/Requester from their own list ->
    // Hide ONLY for this user so other users' data is untouched!
    if (username) {
      if (!request.hiddenForUsers.includes(username)) {
        request.hiddenForUsers.push(username);
        await request.save();
      }
      return res.json({ message: 'Request removed from your personal list', id: req.params.id });
    }

    // Default fallback: if no username provided, hide for requester
    request.isDeleted = true;
    await request.save();
    res.json({ message: 'Request removed', id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get requests based on user role, personal filter (hiddenForUsers), and date filters
app.get('/api/requests', async (req, res) => {
  try {
    const { username, date, startDate, endDate, month } = req.query;
    if (!username) {
      return res.status(400).json({ error: 'Username query parameter is required' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Base query: not globally deleted, and NOT hidden for this specific user
    let baseQuery = {
      isDeleted: false,
      hiddenForUsers: { $ne: user.username }
    };

    // Date filtering helper
    const buildDateQuery = (customFilter = {}) => {
      let q = { ...baseQuery, ...customFilter };
      if (date) {
        q.date = date;
      } else if (startDate && endDate) {
        q.date = { $gte: startDate, $lte: endDate };
      } else if (month) {
        q.date = { $regex: `^${month}` };
      }
      return q;
    };

    if (user.role === 'requester') {
      const myRequestsQuery = buildDateQuery({ requesterUsername: user.username });
      const requests = await DotRequest.find(myRequestsQuery).sort({ date: -1, createdAt: -1 });

      // Always include pending requests for this user (unless hidden by user)
      const pendingRequests = await DotRequest.find({
        requesterUsername: user.username,
        isDeleted: false,
        hiddenForUsers: { $ne: user.username },
        status: { $in: ['PENDING_L1', 'PENDING_FINAL'] }
      }).sort({ createdAt: -1 });

      return res.json({
        requests,
        pendingRequests,
        type: 'requester'
      });
    }

    if (user.role === 'approver_l1') {
      if (user.username === 'Rohitha') {
        const actionable = await DotRequest.find({
          department: 'HR',
          status: 'PENDING_L1',
          isDeleted: false,
          hiddenForUsers: { $ne: user.username }
        }).sort({ createdAt: -1 });

        const allPending = await DotRequest.find({
          status: { $in: ['PENDING_L1', 'PENDING_FINAL'] },
          isDeleted: false,
          hiddenForUsers: { $ne: user.username }
        }).sort({ createdAt: -1 });

        const historyQuery = buildDateQuery();
        const allRequests = await DotRequest.find(historyQuery).sort({ date: -1, createdAt: -1 });

        return res.json({
          requests: allRequests,
          actionable,
          allPending,
          type: 'rohitha_l1'
        });
      }

      // Other L1 Approvers (Mr. Dhammika, Mr. Karthika, etc.)
      const depts = user.approvedDepartments || [];
      const actionable = await DotRequest.find({
        department: { $in: depts },
        status: 'PENDING_L1',
        isDeleted: false,
        hiddenForUsers: { $ne: user.username }
      }).sort({ createdAt: -1 });

      const deptQuery = buildDateQuery({ department: { $in: depts } });
      const requests = await DotRequest.find(deptQuery).sort({ date: -1, createdAt: -1 });

      return res.json({
        requests,
        actionable,
        type: 'standard_l1'
      });
    }

    if (user.role === 'approver_final') {
      // Mr. Vinod: Final Authority
      const actionable = await DotRequest.find({
        status: 'PENDING_FINAL',
        isDeleted: false,
        hiddenForUsers: { $ne: user.username }
      }).sort({ createdAt: -1 });

      const allPending = await DotRequest.find({
        status: { $in: ['PENDING_L1', 'PENDING_FINAL'] },
        isDeleted: false,
        hiddenForUsers: { $ne: user.username }
      }).sort({ createdAt: -1 });

      const historyQuery = buildDateQuery();
      const allRequests = await DotRequest.find(historyQuery).sort({ date: -1, createdAt: -1 });

      return res.json({
        requests: allRequests,
        actionable,
        allPending,
        type: 'final_approver'
      });
    }

    res.json({ requests: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// L1 Approval Action
app.post('/api/requests/:id/l1-action', async (req, res) => {
  try {
    const { action, username, remarks } = req.body;
    const request = await DotRequest.findById(req.params.id);
    if (!request || request.isDeleted) return res.status(404).json({ error: 'Request not found' });

    if (request.status !== 'PENDING_L1') {
      return res.status(400).json({ error: 'Request is not in PENDING_L1 status' });
    }

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'Approver user not found' });

    if (user.username === 'Rohitha' && request.department !== 'HR') {
      return res.status(403).json({ error: 'Mr. Rohitha can only approve HR department requests' });
    }

    if (action === 'APPROVE') {
      request.status = 'PENDING_FINAL';
      request.l1Approver.status = 'APPROVED';
      request.l1Approver.name = user.name;
      request.l1Approver.actionAt = new Date();
      request.l1Approver.remarks = remarks || `Approved by ${user.name}`;
    } else if (action === 'REJECT') {
      request.status = 'REJECTED';
      request.l1Approver.status = 'REJECTED';
      request.l1Approver.name = user.name;
      request.l1Approver.actionAt = new Date();
      request.l1Approver.remarks = remarks || `Rejected by ${user.name}`;
    } else {
      return res.status(400).json({ error: 'Invalid action. Must be APPROVE or REJECT' });
    }

    await request.save();
    res.json(request);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Final Approval Action (Mr. Vinod)
app.post('/api/requests/:id/final-action', async (req, res) => {
  try {
    const { action, username, remarks } = req.body;
    const request = await DotRequest.findById(req.params.id);
    if (!request || request.isDeleted) return res.status(404).json({ error: 'Request not found' });

    if (request.status !== 'PENDING_FINAL') {
      return res.status(400).json({ error: 'Request is not in PENDING_FINAL status' });
    }

    const user = await User.findOne({ username });
    if (!user || user.role !== 'approver_final') {
      return res.status(403).json({ error: 'Only Final Approver (Mr. Vinod) can perform this action' });
    }

    if (action === 'APPROVE') {
      request.status = 'APPROVED';
      request.finalApprover.status = 'APPROVED';
      request.finalApprover.name = 'Mr. Vinod';
      request.finalApprover.actionAt = new Date();
      request.finalApprover.remarks = remarks || 'Final Approval Authorized by Mr. Vinod';
    } else if (action === 'REJECT') {
      request.status = 'REJECTED';
      request.finalApprover.status = 'REJECTED';
      request.finalApprover.name = 'Mr. Vinod';
      request.finalApprover.actionAt = new Date();
      request.finalApprover.remarks = remarks || 'Rejected by Mr. Vinod';
    } else {
      return res.status(400).json({ error: 'Invalid action. Must be APPROVE or REJECT' });
    }

    await request.save();
    res.json(request);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Batch approval endpoint
app.post('/api/requests/batch-action', async (req, res) => {
  try {
    const { ids, action, username, stage } = req.body;
    if (!ids || !ids.length || !action || !username) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updated = [];
    for (const id of ids) {
      const request = await DotRequest.findById(id);
      if (!request || request.isDeleted) continue;

      if (stage === 'l1' && request.status === 'PENDING_L1') {
        if (user.username === 'Rohitha' && request.department !== 'HR') continue;
        if (action === 'APPROVE') {
          request.status = 'PENDING_FINAL';
          request.l1Approver.status = 'APPROVED';
          request.l1Approver.name = user.name;
          request.l1Approver.actionAt = new Date();
          request.l1Approver.remarks = `Batch Approved by ${user.name}`;
        } else {
          request.status = 'REJECTED';
          request.l1Approver.status = 'REJECTED';
          request.l1Approver.name = user.name;
          request.l1Approver.actionAt = new Date();
          request.l1Approver.remarks = `Batch Rejected by ${user.name}`;
        }
        await request.save();
        updated.push(request);
      } else if (stage === 'final' && request.status === 'PENDING_FINAL' && user.role === 'approver_final') {
        if (action === 'APPROVE') {
          request.status = 'APPROVED';
          request.finalApprover.status = 'APPROVED';
          request.finalApprover.name = 'Mr. Vinod';
          request.finalApprover.actionAt = new Date();
          request.finalApprover.remarks = 'Batch Final Approved by Mr. Vinod';
        } else {
          request.status = 'REJECTED';
          request.finalApprover.status = 'REJECTED';
          request.finalApprover.name = 'Mr. Vinod';
          request.finalApprover.actionAt = new Date();
          request.finalApprover.remarks = 'Batch Final Rejected by Mr. Vinod';
        }
        await request.save();
        updated.push(request);
      }
    }

    res.json({ updatedCount: updated.length, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Analytics & Bar Chart Data (With date range, month & department filtering)
app.get('/api/analytics', async (req, res) => {
  try {
    const { startDate, endDate, month, department, departments } = req.query;

    let query = { isDeleted: false };
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate };
    } else if (month) {
      query.date = { $regex: `^${month}` };
    }

    if (department && department !== 'ALL') {
      query.department = department;
    } else if (departments) {
      const deptList = departments.split(',').map(d => d.trim());
      query.department = { $in: deptList };
    }

    const requests = await DotRequest.find(query);

    const defaultDepartments = [
      'Production',
      'WIP',
      'RIM',
      'RMS',
      'FGS',
      'LAB',
      'Quality',
      'HR',
      'Finance',
      'ENGINEERING',
      'Mixing/Bandroom'
    ];

    const targetDepts = (department && department !== 'ALL')
      ? [department]
      : (departments ? departments.split(',').map(d => d.trim()) : defaultDepartments);

    const departmentStats = {};
    targetDepts.forEach(dept => {
      departmentStats[dept] = {
        department: dept,
        requestsCount: 0,
        totalHeadcount: 0,
        approvedHeadcount: 0,
        pendingHeadcount: 0,
        rejectedHeadcount: 0,
      };
    });

    let totalHeadcountRequested = 0;
    let totalHeadcountApproved = 0;
    let totalHeadcountPending = 0;
    let totalRequests = requests.length;

    requests.forEach(req => {
      const dept = req.department;
      if (!departmentStats[dept]) {
        departmentStats[dept] = {
          department: dept,
          requestsCount: 0,
          totalHeadcount: 0,
          approvedHeadcount: 0,
          pendingHeadcount: 0,
          rejectedHeadcount: 0,
        };
      }

      const count = req.employeeCount || (req.employees ? req.employees.length : 0);
      departmentStats[dept].requestsCount += 1;
      departmentStats[dept].totalHeadcount += count;
      totalHeadcountRequested += count;

      if (req.status === 'APPROVED') {
        departmentStats[dept].approvedHeadcount += count;
        totalHeadcountApproved += count;
      } else if (req.status === 'REJECTED') {
        departmentStats[dept].rejectedHeadcount += count;
      } else {
        departmentStats[dept].pendingHeadcount += count;
        totalHeadcountPending += count;
      }
    });

    const chartData = Object.values(departmentStats);

    // EPF Number-Wise Stats aggregation
    const epfMap = {};
    requests.forEach(req => {
      if (req.employees && Array.isArray(req.employees)) {
        req.employees.forEach(emp => {
          const epfNo = String(emp.epfNo || '').trim();
          const fullName = String(emp.fullName || '').trim();
          const dept = req.department;
          const key = `${epfNo}_${dept}`;

          if (!epfMap[key]) {
            epfMap[key] = {
              epfNo,
              fullName,
              department: dept,
              totalCount: 0,
              approvedCount: 0,
              pendingCount: 0,
              rejectedCount: 0,
              totalHours: 0,
              dates: []
            };
          }

          epfMap[key].totalCount += 1;
          epfMap[key].totalHours += Number(req.hours || 4);
          if (req.date && !epfMap[key].dates.includes(req.date)) {
            epfMap[key].dates.push(req.date);
          }

          if (req.status === 'APPROVED') {
            epfMap[key].approvedCount += 1;
          } else if (req.status === 'REJECTED') {
            epfMap[key].rejectedCount += 1;
          } else {
            epfMap[key].pendingCount += 1;
          }
        });
      }
    });

    const epfStats = Object.values(epfMap).sort((a, b) => {
      if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
      const numA = parseInt(a.epfNo, 10);
      const numB = parseInt(b.epfNo, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.epfNo.localeCompare(b.epfNo);
    });

    res.json({
      chartData,
      epfStats,
      summary: {
        totalRequests,
        totalHeadcountRequested,
        totalHeadcountApproved,
        totalHeadcountPending,
        uniqueEmployeesCount: epfStats.length,
        pendingL1Count: requests.filter(r => r.status === 'PENDING_L1').length,
        pendingFinalCount: requests.filter(r => r.status === 'PENDING_FINAL').length,
        approvedCount: requests.filter(r => r.status === 'APPROVED').length,
        rejectedCount: requests.filter(r => r.status === 'REJECTED').length,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Optional fallback to serve static frontend if deployed together
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(frontendDist, 'index.html'));
  }
  next();
});

app.listen(PORT, () => {
  console.log(`DOT Approval Backend Server running on http://localhost:${PORT}`);
});
