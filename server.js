const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const User = require('./models/User');
const Employee = require('./models/Employee');
const DotRequest = require('./models/DotRequest');
const AttendanceAudit = require('./models/AttendanceAudit');
const DailyHeadcount = require('./models/DailyHeadcount');
const { seedDatabase } = require('./seedData');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://savindudilanka9793_db_user:pV0NZVy7kPmsCDIb@cluster0.n6doxsm.mongodb.net/dot_approval_system?retryWrites=true&w=majority&appName=Cluster0';

// Enable CORS for all origins (allowing frontend hosted on Vercel, Netlify, or localhost)
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

    // Check if account access has been revoked/deactivated by Admin
    if (user.isActive === false) {
      return res.status(403).json({ error: 'Access Revoked: Your account access has been revoked or deactivated by the Administrator. Please contact System Admin.' });
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
        canViewAllPending: !!user.canViewAllPending,
        canViewCharts: !!user.canViewCharts,
        canManageAttendance: !!user.canManageAttendance,
        canViewAttendance: !!user.canViewAttendance,
        isActive: user.isActive !== false
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Live session verification & permissions sync
app.get('/api/auth/me', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) {
      return res.status(400).json({ error: 'Username query parameter is required' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User account not found' });
    }

    if (user.isActive === false && user.username !== 'Admin') {
      return res.status(403).json({
        error: 'Access Revoked: Your account access has been revoked or deactivated by the Administrator.',
        isActive: false
      });
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
        canViewAllPending: !!user.canViewAllPending,
        canViewCharts: !!user.canViewCharts,
        canManageAttendance: !!user.canManageAttendance,
        canViewAttendance: !!user.canViewAttendance,
        isActive: user.isActive !== false
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
    const users = await User.find(
      { username: { $ne: 'Admin' }, role: { $ne: 'admin' }, isActive: { $ne: false } },
      '-password'
    ).sort({ role: 1, department: 1, name: 1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Admin Management Routes ---
// 1. Get all users with full configuration
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await User.find({}).sort({ role: 1, department: 1, username: 1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get all HODs (Level 1 Approvers)
app.get('/api/admin/hods', async (req, res) => {
  try {
    const hods = await User.find({ role: 'approver_l1' }).sort({ name: 1 });
    res.json(hods);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Create a new User with full access permissions
app.post('/api/admin/users', async (req, res) => {
  try {
    const {
      username,
      password,
      name,
      role,
      department,
      assignedL1Approver,
      approvedDepartments,
      isActive,
      canViewAllPending,
      canViewCharts,
      canManageAttendance,
      canViewAttendance,
      createHODInline,
      hodUsername,
      hodPassword,
      hodName
    } = req.body;

    if (!username || !password || !name || !role) {
      return res.status(400).json({ error: 'Username, password, name, and role are required' });
    }

    const existing = await User.findOne({ username: username.trim() });
    if (existing) {
      return res.status(400).json({ error: `Username '${username}' already exists.` });
    }

    let finalAssignedL1 = assignedL1Approver ? assignedL1Approver.trim() : '';

    // Handle creating HOD inline when creating a requester
    if (role === 'requester' && createHODInline) {
      if (!hodUsername || !hodPassword || !hodName) {
        return res.status(400).json({ error: 'HOD Username, Password, and Full Name are required for inline HOD creation.' });
      }

      const existingHod = await User.findOne({ username: hodUsername.trim() });
      if (existingHod) {
        return res.status(400).json({ error: `HOD Username '${hodUsername}' already exists.` });
      }

      const formattedHodName = hodName.trim().startsWith('Mr.') ? hodName.trim() : `Mr. ${hodName.trim()}`;
      const newHod = await User.create({
        username: hodUsername.trim(),
        password: hodPassword.trim(),
        defaultPassword: hodPassword.trim(),
        name: formattedHodName,
        role: 'approver_l1',
        approvedDepartments: department ? [department.trim()] : [],
        isActive: true,
        canViewAllPending: false,
        canViewCharts: true,
        canManageAttendance: false,
        canViewAttendance: false
      });

      finalAssignedL1 = newHod.name;
    }

    const formattedName = (name.trim().startsWith('Mr.') || role === 'admin')
      ? name.trim()
      : `Mr. ${name.trim()}`;

    const userActive = typeof isActive === 'boolean' ? isActive : true;
    const viewAll = typeof canViewAllPending === 'boolean' ? canViewAllPending : (role === 'viewer' || role === 'admin' || role === 'approver_final');
    const viewCharts = typeof canViewCharts === 'boolean' ? canViewCharts : (role !== 'requester');
    const manageAtt = typeof canManageAttendance === 'boolean' ? canManageAttendance : (role === 'admin' || username.toLowerCase().includes('nimesh'));
    const viewAtt = typeof canViewAttendance === 'boolean' ? canViewAttendance : (role === 'admin' || role === 'viewer' || role === 'approver_final' || viewAll);

    let newUser;
    if (role === 'requester') {
      if (!department) {
        return res.status(400).json({ error: 'Department is required for Requesters' });
      }

      newUser = await User.create({
        username: username.trim(),
        password: password.trim(),
        defaultPassword: password.trim(),
        name: formattedName,
        role: 'requester',
        department: department.trim(),
        assignedL1Approver: finalAssignedL1,
        isActive: userActive,
        canViewAllPending: viewAll,
        canViewCharts: viewCharts,
        canManageAttendance: manageAtt,
        canViewAttendance: viewAtt
      });

      // Ensure the department is registered in the assigned HOD's approvedDepartments
      if (finalAssignedL1) {
        await User.updateOne(
          { $or: [{ name: finalAssignedL1 }, { username: finalAssignedL1 }] },
          { $addToSet: { approvedDepartments: department.trim() } }
        );
      }
    } else if (role === 'approver_l1') {
      const depts = Array.isArray(approvedDepartments)
        ? approvedDepartments
        : (approvedDepartments ? approvedDepartments.split(',').map(d => d.trim()).filter(Boolean) : []);

      newUser = await User.create({
        username: username.trim(),
        password: password.trim(),
        defaultPassword: password.trim(),
        name: formattedName,
        role: 'approver_l1',
        approvedDepartments: depts,
        isActive: userActive,
        canViewAllPending: viewAll,
        canViewCharts: viewCharts,
        canManageAttendance: manageAtt,
        canViewAttendance: viewAtt
      });
    } else {
      newUser = await User.create({
        username: username.trim(),
        password: password.trim(),
        defaultPassword: password.trim(),
        name: formattedName,
        role: role,
        department: department ? department.trim() : '',
        isActive: userActive,
        canViewAllPending: viewAll,
        canViewCharts: viewCharts,
        canManageAttendance: manageAtt,
        canViewAttendance: viewAtt
      });
    }

    res.status(201).json({ message: 'User created successfully', user: newUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Update user (Role, Access, Permissions, Department, Password)
app.put('/api/admin/users/:id', async (req, res) => {
  try {
    const {
      name,
      password,
      role,
      department,
      assignedL1Approver,
      approvedDepartments,
      isActive,
      canViewAllPending,
      canViewCharts,
      canManageAttendance,
      canViewAttendance
    } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (name) {
      user.name = (name.trim().startsWith('Mr.') || user.role === 'admin')
        ? name.trim()
        : `Mr. ${name.trim()}`;
    }

    if (password) {
      user.password = password.trim();
      user.defaultPassword = password.trim();
    }

    // Role modification (prohibit changing master Admin account role)
    if (role && user.username !== 'Admin') {
      user.role = role;
    }

    // Access Grant/Revoke (prohibit revoking Admin)
    if (typeof isActive === 'boolean' && user.username !== 'Admin') {
      user.isActive = isActive;
    }

    // Feature permissions
    if (typeof canViewAllPending === 'boolean') user.canViewAllPending = canViewAllPending;
    if (typeof canViewCharts === 'boolean') user.canViewCharts = canViewCharts;
    if (typeof canManageAttendance === 'boolean') user.canManageAttendance = canManageAttendance;
    if (typeof canViewAttendance === 'boolean') user.canViewAttendance = canViewAttendance;

    if (user.role === 'requester') {
      if (department !== undefined) user.department = department ? department.trim() : '';
      if (assignedL1Approver) {
        user.assignedL1Approver = assignedL1Approver.trim();
        await User.updateOne(
          { $or: [{ name: user.assignedL1Approver }, { username: user.assignedL1Approver }] },
          { $addToSet: { approvedDepartments: user.department } }
        );
      }
    } else if (user.role === 'approver_l1') {
      if (approvedDepartments !== undefined) {
        user.approvedDepartments = Array.isArray(approvedDepartments)
          ? approvedDepartments
          : approvedDepartments.split(',').map(d => d.trim()).filter(Boolean);
      }
    } else {
      if (department !== undefined) user.department = department ? department.trim() : '';
    }

    await user.save();
    res.json({ message: 'User updated successfully', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4.1 Quick Toggle Access (Grant or Revoke with one click)
app.patch('/api/admin/users/:id/toggle-access', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.username === 'Admin') {
      return res.status(400).json({ error: 'Administrator access cannot be revoked.' });
    }

    user.isActive = user.isActive === false ? true : false;
    await user.save();

    res.json({
      message: user.isActive ? `Access successfully granted to ${user.name}` : `Access successfully revoked from ${user.name}`,
      user
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Delete user
app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.username === 'Admin') {
      return res.status(400).json({ error: 'The Administrator account cannot be deleted.' });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: `User '${user.name}' deleted successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Admin Request Data Management: List all requests
app.get('/api/admin/requests', async (req, res) => {
  try {
    const { department, username, status, date } = req.query;
    let query = {};
    if (department && department !== 'ALL') query.department = department;
    if (username && username !== 'ALL') query.requesterUsername = username;
    if (status && status !== 'ALL') query.status = status;
    if (date) query.date = date;

    const requests = await DotRequest.find(query).sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Admin Delete Requests: Delete single request permanently
app.delete('/api/admin/requests/:id', async (req, res) => {
  try {
    const deleted = await DotRequest.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Request not found' });
    }
    res.json({ message: `Request ${deleted.reqNumber} permanently deleted.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Admin Bulk Delete Requests: Clear ALL requests or filter by department/user
app.delete('/api/admin/requests', async (req, res) => {
  try {
    const { department, username, all } = req.query;
    let filter = {};

    if (all === 'true' || (!department && !username)) {
      const result = await DotRequest.deleteMany({});
      return res.json({
        message: `All Double OT data deleted successfully (${result.deletedCount} requests removed). Tables and charts are reset.`
      });
    }

    if (department) filter.department = department;
    if (username) filter.requesterUsername = username;

    const result = await DotRequest.deleteMany(filter);
    res.json({
      message: `Deleted ${result.deletedCount} requests matching criteria.`
    });
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

// Admin Employee Management: Get all employees
app.get('/api/admin/employees', async (req, res) => {
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
    const employees = await Employee.find(query).sort({ epfNo: 1 }).limit(500);
    const totalCount = await Employee.countDocuments();
    res.json({ employees, totalCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Employee Management: Add new employee (EPF No + Full Name)
app.post('/api/admin/employees', async (req, res) => {
  try {
    const { epfNo, fullName, department } = req.body;
    if (!epfNo || !fullName) {
      return res.status(400).json({ error: 'Both EPF Number and Full Name are required' });
    }

    const cleanEpf = String(epfNo).trim();
    const cleanName = fullName.trim();

    const existing = await Employee.findOne({ epfNo: cleanEpf });
    if (existing) {
      return res.status(400).json({
        error: `Employee with EPF #${cleanEpf} already exists (${existing.fullName}).`
      });
    }

    const newEmp = await Employee.create({
      epfNo: cleanEpf,
      fullName: cleanName,
      department: department ? department.trim() : 'General'
    });

    res.status(201).json({
      message: `Employee #${cleanEpf} (${cleanName}) added successfully! Ready for Double OT search.`,
      employee: newEmp
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Employee Management: Update employee
app.put('/api/admin/employees/:id', async (req, res) => {
  try {
    const { epfNo, fullName, department } = req.body;
    const emp = await Employee.findById(req.params.id);
    if (!emp) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (epfNo) {
      const cleanEpf = String(epfNo).trim();
      const existing = await Employee.findOne({ epfNo: cleanEpf, _id: { $ne: req.params.id } });
      if (existing) {
        return res.status(400).json({ error: `EPF #${cleanEpf} already belongs to another employee (${existing.fullName})` });
      }
      emp.epfNo = cleanEpf;
    }

    if (fullName) emp.fullName = fullName.trim();
    if (department) emp.department = department.trim();

    await emp.save();
    res.json({ message: 'Employee updated successfully', employee: emp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Employee Management: Delete employee
app.delete('/api/admin/employees/:id', async (req, res) => {
  try {
    const emp = await Employee.findByIdAndDelete(req.params.id);
    if (!emp) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json({ message: `Employee #${emp.epfNo} (${emp.fullName}) deleted successfully` });
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
      shift: shift || 'SHIFT A',
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

      let allPending = [];
      if (user.canViewAllPending) {
        allPending = await DotRequest.find({
          status: { $in: ['PENDING_L1', 'PENDING_FINAL'] },
          isDeleted: false,
          hiddenForUsers: { $ne: user.username }
        }).sort({ createdAt: -1 });
      }

      return res.json({
        requests,
        pendingRequests,
        allPending,
        type: 'requester'
      });
    }

    if (user.role === 'approver_l1') {
      const isRohitha = user.username === 'Rohitha';
      const isDhammika = user.username === 'Dhammika';
      const canViewAll = user.canViewAllPending || isDhammika || isRohitha;

      const actionableQuery = {
        status: 'PENDING_L1',
        isDeleted: false,
        hiddenForUsers: { $ne: user.username }
      };

      if (isRohitha) {
        actionableQuery.department = 'HR';
      } else {
        actionableQuery.department = { $in: user.approvedDepartments || [] };
      }

      const actionable = await DotRequest.find(actionableQuery).sort({ createdAt: -1 });

      let allPending = [];
      if (canViewAll) {
        allPending = await DotRequest.find({
          status: { $in: ['PENDING_L1', 'PENDING_FINAL'] },
          isDeleted: false,
          hiddenForUsers: { $ne: user.username }
        }).sort({ createdAt: -1 });
      }

      const historyQuery = canViewAll
        ? buildDateQuery()
        : buildDateQuery({ department: { $in: user.approvedDepartments || [] } });

      const requests = await DotRequest.find(historyQuery).sort({ date: -1, createdAt: -1 });

      return res.json({
        requests,
        actionable,
        allPending,
        type: isRohitha ? 'rohitha_l1' : (canViewAll ? 'dhammika_l1' : 'standard_l1')
      });
    }

    if (user.role === 'viewer') {
      // Plant-wide Live Monitoring & Read-Only Audit (Mr. Nimesh, Mr. Niranjan)
      const allPending = await DotRequest.find({
        status: { $in: ['PENDING_L1', 'PENDING_FINAL'] },
        isDeleted: false,
        hiddenForUsers: { $ne: user.username }
      }).sort({ createdAt: -1 });

      const historyQuery = buildDateQuery();
      const allRequests = await DotRequest.find(historyQuery).sort({ date: -1, createdAt: -1 });

      return res.json({
        requests: allRequests,
        actionable: [],
        allPending,
        type: 'viewer'
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
    if (!user || user.role !== 'approver_l1') {
      return res.status(403).json({ error: 'Only Level 1 Approvers can perform this action' });
    }

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
    if (user.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot perform approval actions' });

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

// --- Attendance Audit & Double OT Reconciliation Routes ---

// Helper: normalize date string to YYYY-MM-DD
function normalizeDateStr(dStr) {
  if (!dStr) return '';
  dStr = String(dStr).trim();
  if (dStr.includes('/')) {
    const parts = dStr.split('/');
    if (parts.length === 3) {
      const month = parts[0].padStart(2, '0');
      const day = parts[1].padStart(2, '0');
      const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      return `${year}-${month}-${day}`;
    }
  }
  return dStr;
}

// 1. Save parsed attendance records and cross-check against Mr. Vinod approvals
app.post('/api/attendance-audit/save', async (req, res) => {
  try {
    const { reportDate, rawDateStr, uploadedBy, records, totalReportRows } = req.body;
    if (!reportDate || !Array.isArray(records)) {
      return res.status(400).json({ error: 'reportDate and records array are required' });
    }

    const normDate = normalizeDateStr(reportDate);
    const dateVariants = [reportDate, normDate, rawDateStr].filter(Boolean);

    // Fetch all requests for these date variants to reconcile
    const matchingRequests = await DotRequest.find({
      isDeleted: false,
      date: { $in: dateVariants }
    });

    // Fetch employees to auto-match official full names
    const allEmployees = await Employee.find({});
    const empMap = new Map();
    allEmployees.forEach(emp => {
      const epf = String(emp.epfNo).trim();
      const clean = String(parseInt(epf, 10) || epf);
      empMap.set(epf, emp.fullName);
      empMap.set(clean, emp.fullName);
    });

    // Filter records according to Double OT conditions:
    // 1. Shift Name = 'off' AND Present = 'Yes' (Off day worked)
    // 2. Work Hrs >= 19
    const validRecords = records.filter(r => {
      const shift = String(r.shiftName || '').toLowerCase().trim();
      const present = String(r.present || '').toLowerCase().trim();
      const workHrs = Number(r.workHrs || 0);

      const isOffDayWorked = (shift === 'off' || shift.includes('off')) && (present === 'yes');
      const isHighHours = workHrs >= 19;
      return isOffDayWorked || isHighHours;
    });

    const enrichedRecords = validRecords.map(r => {
      const epfRaw = String(r.epfNo || '').trim();
      const epfClean = String(parseInt(epfRaw, 10) || epfRaw);
      
      // Auto-match Full Name from official Employee directory
      const matchedName = empMap.get(epfRaw) || empMap.get(epfClean) || r.fullName || 'Unknown';

      const shift = String(r.shiftName || '').toLowerCase().trim();
      const present = String(r.present || '').toLowerCase().trim();
      const workHrs = Number(r.workHrs || 0);

      const isDot = (shift === 'off' || shift.includes('off')) && (present === 'yes');
      const is24Hours = workHrs >= 19;
      let category = 'DOT';
      let dotReason = r.dotReason;
      if (isDot && is24Hours) {
        category = 'BOTH';
        dotReason = dotReason || 'Off Day & 24 Hours Duty';
      } else if (isDot) {
        category = 'DOT';
        dotReason = dotReason || 'Double OT (Off Day)';
      } else {
        category = '24_HRS';
        dotReason = dotReason || `24 Hours Duty (${workHrs}h)`;
      }

      // Check Mr. Vinod's approval in DotRequest
      let vinodStatus = 'NOT_APPROVED';
      let vinodReqNumber = '';
      let vinodReqId = '';

      const epfReqs = matchingRequests.filter(q => 
        q.employees && q.employees.some(e => {
          const eNum = String(e.epfNo || '').trim();
          const eClean = String(parseInt(eNum, 10) || eNum);
          return eNum === epfRaw || eClean === epfClean || eClean === epfRaw || eNum === epfClean;
        })
      );

      const approvedReq = epfReqs.find(q => q.status === 'APPROVED');
      if (approvedReq) {
        vinodStatus = 'APPROVED';
        vinodReqNumber = approvedReq.reqNumber;
        vinodReqId = String(approvedReq._id);
      } else {
        const pendingReq = epfReqs.find(q => q.status === 'PENDING_FINAL' || q.status === 'PENDING_L1');
        if (pendingReq) {
          vinodStatus = 'PENDING';
          vinodReqNumber = pendingReq.reqNumber;
          vinodReqId = String(pendingReq._id);
        } else {
          const rejectedReq = epfReqs.find(q => q.status === 'REJECTED');
          if (rejectedReq) {
            vinodStatus = 'REJECTED';
            vinodReqNumber = rejectedReq.reqNumber;
            vinodReqId = String(rejectedReq._id);
          }
        }
      }

      return {
        epfNo: epfRaw,
        fullName: matchedName,
        department: r.department || 'General',
        unit: r.unit || 'General',
        shiftName: r.shiftName || '',
        present: r.present || 'Yes',
        firstDate: r.firstDate || rawDateStr || normDate,
        workHrs: workHrs,
        inTime: r.inTime || '',
        outTime: r.outTime || '',
        dotReason: dotReason,
        category: category,
        isDot: isDot,
        is24Hours: is24Hours,
        vinodStatus,
        vinodReqNumber,
        vinodReqId
      };
    });

    const dotCount = enrichedRecords.filter(r => r.isDot).length;
    const twentyFourHrsCount = enrichedRecords.filter(r => r.is24Hours).length;

    const saved = await AttendanceAudit.findOneAndUpdate(
      { reportDate: normDate },
      {
        $set: {
          reportDate: normDate,
          rawDateStr: rawDateStr || reportDate,
          uploadedBy: uploadedBy || 'Mr. Nimesh',
          uploadedAt: new Date(),
          totalReportRows: Number(totalReportRows || records.length),
          dotCount: dotCount,
          twentyFourHrsCount: twentyFourHrsCount,
          totalIncidentsCount: enrichedRecords.length,
          dotRecords: enrichedRecords
        }
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: `Daily Attendance for ${normDate} processed successfully: ${dotCount} Double OT (Off Day) and ${twentyFourHrsCount} 24 Hours Duty incidents detected.`,
      audit: saved
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get attendance audit report by single date, month, or date range with dynamic Vinod approval check
app.get('/api/attendance-audit', async (req, res) => {
  try {
    const { date, month, startDate, endDate, mode } = req.query;
    const availableAudits = await AttendanceAudit.find({}, 'reportDate rawDateStr uploadedBy uploadedAt totalReportRows dotCount twentyFourHrsCount totalIncidentsCount').sort({ reportDate: -1 });
    const availableDates = availableAudits.map(a => a.reportDate);
    const availableMonths = Array.from(new Set(availableDates.map(d => String(d).slice(0, 7)).filter(Boolean))).sort().reverse();

    // Determine query mode
    let filterMode = mode;
    if (!filterMode) {
      if (month && !date) filterMode = 'month';
      else if (startDate && endDate && !date) filterMode = 'range';
      else filterMode = 'single';
    }

    let matchedAudits = [];
    let targetMonth = month || availableMonths[0] || '';
    let startNorm = startDate ? normalizeDateStr(startDate) : '';
    let endNorm = endDate ? normalizeDateStr(endDate) : '';
    let targetDate = '';

    if (filterMode === 'month') {
      if (targetMonth) {
        matchedAudits = await AttendanceAudit.find({
          reportDate: { $regex: `^${targetMonth}` }
        }).sort({ reportDate: 1 });
      }
    } else if (filterMode === 'range') {
      if (startNorm && endNorm) {
        matchedAudits = await AttendanceAudit.find({
          reportDate: { $gte: startNorm, $lte: endNorm }
        }).sort({ reportDate: 1 });
      }
    } else {
      // Default: single day
      filterMode = 'single';
      targetDate = date ? normalizeDateStr(date) : (availableDates[0] || '');
      if (targetDate) {
        const singleAudit = await AttendanceAudit.findOne({
          $or: [{ reportDate: targetDate }, { rawDateStr: targetDate }]
        });
        if (singleAudit) matchedAudits = [singleAudit];
      }
    }

    if (matchedAudits.length === 0) {
      return res.json({
        audit: null,
        filterMode,
        targetMonth,
        startDate: startNorm,
        endDate: endNorm,
        targetDate,
        availableDates,
        availableMonths,
        availableAudits,
        summary: { totalIncidents: 0, totalDot: 0, twentyFourHrsCount: 0, approvedCount: 0, notApprovedCount: 0, pendingCount: 0, totalReportRows: 0, daysCount: 0 }
      });
    }

    // Collect all audit dates across matched audits
    const allAuditDates = [];
    matchedAudits.forEach(a => {
      if (a.reportDate) allAuditDates.push(a.reportDate);
      if (a.rawDateStr) allAuditDates.push(a.rawDateStr);
    });

    // Dynamic live check against current DotRequest state in database
    const matchingRequests = await DotRequest.find({
      isDeleted: false,
      date: { $in: Array.from(new Set(allAuditDates)) }
    });

    let totalReportRowsSum = 0;
    const refreshedRecords = [];

    matchedAudits.forEach(audit => {
      totalReportRowsSum += Number(audit.totalReportRows || 0);

      audit.dotRecords.forEach(r => {
        const epfRaw = String(r.epfNo || '').trim();
        const epfClean = String(parseInt(epfRaw, 10) || epfRaw);
        const recDate = r.firstDate || audit.reportDate || audit.rawDateStr || '';
        const recDateNorm = normalizeDateStr(recDate);
        const auditDateNorm = normalizeDateStr(audit.reportDate);

        // Match DotRequests for this EPF and date
        const epfReqs = matchingRequests.filter(q => {
          const qDateNorm = normalizeDateStr(q.date);
          const isDateMatch = qDateNorm === recDateNorm || qDateNorm === auditDateNorm || q.date === recDate || q.date === audit.reportDate;
          if (!isDateMatch) return false;
          return q.employees && q.employees.some(e => {
            const eNum = String(e.epfNo || '').trim();
            const eClean = String(parseInt(eNum, 10) || eNum);
            return eNum === epfRaw || eClean === epfClean || eClean === epfRaw || eNum === epfClean;
          });
        });

        let vinodStatus = 'NOT_APPROVED';
        let vinodReqNumber = '';
        let vinodReqId = '';

        const approvedReq = epfReqs.find(q => q.status === 'APPROVED');
        if (approvedReq) {
          vinodStatus = 'APPROVED';
          vinodReqNumber = approvedReq.reqNumber;
          vinodReqId = String(approvedReq._id);
        } else {
          const pendingReq = epfReqs.find(q => q.status === 'PENDING_FINAL' || q.status === 'PENDING_L1');
          if (pendingReq) {
            vinodStatus = 'PENDING';
            vinodReqNumber = pendingReq.reqNumber;
            vinodReqId = String(pendingReq._id);
          } else {
            const rejectedReq = epfReqs.find(q => q.status === 'REJECTED');
            if (rejectedReq) {
              vinodStatus = 'REJECTED';
              vinodReqNumber = rejectedReq.reqNumber;
              vinodReqId = String(rejectedReq._id);
            }
          }
        }

        const shift = String(r.shiftName || '').toLowerCase().trim();
        const present = String(r.present || '').toLowerCase().trim();
        const workHrs = Number(r.workHrs || 0);
        const isDot = (shift === 'off' || shift.includes('off')) && (present === 'yes');
        const is24Hours = workHrs >= 19;
        let category = r.category;
        if (!category) {
          if (isDot && is24Hours) category = 'BOTH';
          else if (isDot) category = 'DOT';
          else category = '24_HRS';
        }

        refreshedRecords.push({
          ...r.toObject(),
          reportDate: audit.reportDate,
          rawDateStr: audit.rawDateStr,
          auditId: String(audit._id),
          firstDate: r.firstDate || audit.reportDate,
          category,
          isDot,
          is24Hours,
          vinodStatus,
          vinodReqNumber,
          vinodReqId
        });
      });
    });

    const approvedCount = refreshedRecords.filter(r => r.vinodStatus === 'APPROVED').length;
    const pendingCount = refreshedRecords.filter(r => r.vinodStatus === 'PENDING').length;
    const notApprovedCount = refreshedRecords.filter(r => r.vinodStatus === 'NOT_APPROVED').length;
    const dotCount = refreshedRecords.filter(r => r.isDot || (String(r.shiftName).toLowerCase().includes('off') && String(r.present || '').toLowerCase() === 'yes')).length;
    const twentyFourHrsCount = refreshedRecords.filter(r => r.is24Hours || Number(r.workHrs || 0) >= 19).length;

    let effectiveReportDate = '';
    if (filterMode === 'month') {
      effectiveReportDate = targetMonth;
    } else if (filterMode === 'range') {
      effectiveReportDate = `${startNorm} to ${endNorm}`;
    } else {
      effectiveReportDate = matchedAudits[0]?.reportDate || targetDate;
    }

    const auditPayload = filterMode === 'single'
      ? {
          ...matchedAudits[0].toObject(),
          dotRecords: refreshedRecords
        }
      : {
          reportDate: effectiveReportDate,
          filterMode,
          isMultiDate: true,
          daysCount: matchedAudits.length,
          auditedDates: matchedAudits.map(a => a.reportDate),
          uploadedBy: matchedAudits.length === 1 ? matchedAudits[0].uploadedBy : `${matchedAudits.length} Daily Audits`,
          uploadedAt: matchedAudits[matchedAudits.length - 1]?.uploadedAt,
          totalReportRows: totalReportRowsSum,
          dotCount,
          twentyFourHrsCount,
          totalIncidentsCount: refreshedRecords.length,
          dotRecords: refreshedRecords
        };

    res.json({
      audit: auditPayload,
      filterMode,
      targetMonth,
      startDate: startNorm,
      endDate: endNorm,
      targetDate: effectiveReportDate,
      availableDates,
      availableMonths,
      availableAudits,
      summary: {
        totalIncidents: refreshedRecords.length,
        totalDot: dotCount,
        twentyFourHrsCount: twentyFourHrsCount,
        approvedCount,
        notApprovedCount,
        pendingCount,
        offShiftCount: dotCount,
        extendedHoursCount: twentyFourHrsCount,
        totalReportRows: totalReportRowsSum,
        daysCount: matchedAudits.length
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Delete an entire attendance audit report for a date (removes from all users)
app.delete('/api/attendance-audit/:reportDate', async (req, res) => {
  try {
    const { reportDate } = req.params;
    const norm = normalizeDateStr(reportDate);
    const result = await AttendanceAudit.deleteMany({
      $or: [
        { reportDate },
        { reportDate: norm },
        { rawDateStr: reportDate },
        { rawDateStr: norm }
      ]
    });
    // Also delete corresponding DailyHeadcount report for this date
    await DailyHeadcount.deleteMany({
      $or: [
        { reportDate },
        { reportDate: norm },
        { rawDateStr: reportDate },
        { rawDateStr: norm }
      ]
    });
    res.json({ success: true, message: `Attendance report for ${reportDate} deleted successfully for all users.`, deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Update a single record in an attendance audit report
app.put('/api/attendance-audit/:reportDate/record/:recordId', async (req, res) => {
  try {
    const { reportDate, recordId } = req.params;
    const { shiftName, present, workHrs, dotReason, department, unit, fullName } = req.body;
    const norm = normalizeDateStr(reportDate);

    const audit = await AttendanceAudit.findOne({
      $or: [{ reportDate }, { reportDate: norm }, { rawDateStr: reportDate }, { rawDateStr: norm }]
    });

    if (!audit) {
      return res.status(404).json({ error: 'Attendance audit report not found for this date' });
    }

    const rec = audit.dotRecords.id(recordId);
    if (!rec) {
      return res.status(404).json({ error: 'Record not found in this audit' });
    }

    if (shiftName !== undefined) rec.shiftName = shiftName;
    if (present !== undefined) rec.present = present;
    if (workHrs !== undefined) rec.workHrs = Number(workHrs);
    if (dotReason !== undefined) rec.dotReason = dotReason;
    if (department !== undefined) rec.department = department;
    if (unit !== undefined) rec.unit = unit;
    if (fullName !== undefined) rec.fullName = fullName;

    const shift = String(rec.shiftName || '').toLowerCase().trim();
    const isPresent = String(rec.present || '').toLowerCase().trim() === 'yes';
    const hrs = Number(rec.workHrs || 0);
    rec.isDot = (shift === 'off' || shift.includes('off')) && isPresent;
    rec.is24Hours = hrs >= 19;
    if (rec.isDot && rec.is24Hours) rec.category = 'BOTH';
    else if (rec.isDot) rec.category = 'DOT';
    else rec.category = '24_HRS';

    audit.dotCount = audit.dotRecords.filter(r => r.isDot).length;
    audit.twentyFourHrsCount = audit.dotRecords.filter(r => r.is24Hours).length;
    audit.totalIncidentsCount = audit.dotRecords.length;

    await audit.save();

    res.json({ success: true, message: 'Record updated successfully', record: rec });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Delete a single employee record from an attendance audit report
app.delete('/api/attendance-audit/:reportDate/record/:recordId', async (req, res) => {
  try {
    const { reportDate, recordId } = req.params;
    const norm = normalizeDateStr(reportDate);

    const audit = await AttendanceAudit.findOne({
      $or: [{ reportDate }, { reportDate: norm }, { rawDateStr: reportDate }, { rawDateStr: norm }]
    });

    if (!audit) {
      return res.status(404).json({ error: 'Attendance audit report not found for this date' });
    }

    audit.dotRecords = audit.dotRecords.filter(r => String(r._id) !== String(recordId));
    audit.dotCount = audit.dotRecords.filter(r => r.isDot).length;
    audit.twentyFourHrsCount = audit.dotRecords.filter(r => r.is24Hours).length;
    audit.totalIncidentsCount = audit.dotRecords.length;
    await audit.save();

    res.json({ success: true, message: 'Employee record removed from audit.', remainingCount: audit.dotRecords.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Add a manual employee record to an attendance audit report
app.post('/api/attendance-audit/:reportDate/record', async (req, res) => {
  try {
    const { reportDate } = req.params;
    const { epfNo, fullName, shiftName, present, workHrs, department, unit, dotReason } = req.body;
    if (!epfNo) {
      return res.status(400).json({ error: 'EPF Number is required' });
    }
    const norm = normalizeDateStr(reportDate);

    const audit = await AttendanceAudit.findOne({
      $or: [{ reportDate }, { reportDate: norm }, { rawDateStr: reportDate }, { rawDateStr: norm }]
    });

    if (!audit) {
      return res.status(404).json({ error: 'Attendance audit report not found for this date' });
    }

    // Auto-match name from employee directory if not specified
    let resolvedName = fullName;
    if (!resolvedName) {
      const epfClean = String(parseInt(epfNo, 10) || epfNo);
      const emp = await Employee.findOne({
        $or: [{ epfNo: String(epfNo).trim() }, { epfNo: epfClean }]
      });
      resolvedName = emp ? emp.fullName : `Employee #${epfNo}`;
    }

    // Check Vinod approval for this EPF and date
    const matchingRequests = await DotRequest.find({
      isDeleted: false,
      date: { $in: [audit.reportDate, audit.rawDateStr, norm, reportDate].filter(Boolean) }
    });

    const epfRaw = String(epfNo).trim();
    const epfClean = String(parseInt(epfRaw, 10) || epfRaw);
    const epfReqs = matchingRequests.filter(q => 
      q.employees && q.employees.some(e => {
        const eNum = String(e.epfNo || '').trim();
        const eClean = String(parseInt(eNum, 10) || eNum);
        return eNum === epfRaw || eClean === epfClean || eClean === epfRaw || eNum === epfClean;
      })
    );

    let vinodStatus = 'NOT_APPROVED';
    let vinodReqNumber = '';
    let vinodReqId = '';
    const approvedReq = epfReqs.find(q => q.status === 'APPROVED');
    if (approvedReq) {
      vinodStatus = 'APPROVED';
      vinodReqNumber = approvedReq.reqNumber;
      vinodReqId = String(approvedReq._id);
    } else {
      const pendingReq = epfReqs.find(q => q.status === 'PENDING_FINAL' || q.status === 'PENDING_L1');
      if (pendingReq) {
        vinodStatus = 'PENDING';
        vinodReqNumber = pendingReq.reqNumber;
        vinodReqId = String(pendingReq._id);
      }
    }

    const shift = String(shiftName || 'Off').toLowerCase().trim();
    const isPresent = String(present || 'Yes').toLowerCase().trim() === 'yes';
    const hrs = Number(workHrs || 0);
    const isDot = (shift === 'off' || shift.includes('off')) && isPresent;
    const is24Hours = hrs >= 19;
    let category = 'DOT';
    if (isDot && is24Hours) category = 'BOTH';
    else if (isDot) category = 'DOT';
    else category = '24_HRS';

    let reason = dotReason;
    if (!reason) {
      if (isDot && is24Hours) reason = 'Off Day & 24 Hours Duty';
      else if (isDot) reason = 'Double OT (Off Day)';
      else reason = `24 Hours Duty (${hrs}h)`;
    }

    const newRecord = {
      epfNo: epfRaw,
      fullName: resolvedName,
      department: department || 'General',
      unit: unit || 'General',
      shiftName: shiftName || 'Off',
      present: present || 'Yes',
      firstDate: reportDate,
      workHrs: hrs,
      dotReason: reason,
      category,
      isDot,
      is24Hours,
      vinodStatus,
      vinodReqNumber,
      vinodReqId
    };

    audit.dotRecords.push(newRecord);
    audit.dotCount = audit.dotRecords.filter(r => r.isDot).length;
    audit.twentyFourHrsCount = audit.dotRecords.filter(r => r.is24Hours).length;
    audit.totalIncidentsCount = audit.dotRecords.length;
    await audit.save();

    res.json({ success: true, message: `Employee #${epfNo} (${resolvedName}) added to audit.`, record: newRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// --- Daily Headcount & Plant-Wide Attendance Analytics Routes ---
// =========================================================================

function parseLateMinutes(t) {
  if (!t) return 0;
  const parts = String(t).trim().split(':');
  if (parts.length >= 2) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return h * 60 + m;
  }
  return 0;
}

function isLeaveVal(val) {
  if (!val) return false;
  const s = String(val).trim().toLowerCase();
  return s !== '' && s !== 'no' && s !== 'none' && s !== '-';
}

function computeHeadcountMetrics(records) {
  // strictly exclude Number = 00001
  const valid = records.filter(r => {
    const epf = String(r.epfNo || '').trim();
    return epf !== '00001' && epf !== '1' && !epf.endsWith('00001');
  });

  const headcount = valid.length;
  const maleCount = valid.filter(r => String(r.gender || '').trim().toUpperCase() === 'MALE').length;
  const femaleCount = valid.filter(r => String(r.gender || '').trim().toUpperCase() === 'FEMALE').length;
  const presentCount = valid.filter(r => String(r.present || '').trim().toLowerCase() === 'yes').length;
  const absentCount = Math.max(0, headcount - presentCount);
  const leaveCount = valid.filter(r => isLeaveVal(r.leave)).length;
  const lateOver15Count = valid.filter(r => {
    const mins = r.lateMinutes !== undefined ? r.lateMinutes : parseLateMinutes(r.late);
    return mins > 15;
  }).length;

  return {
    headcount,
    maleCount,
    femaleCount,
    presentCount,
    absentCount,
    leaveCount,
    lateOver15Count
  };
}

// 1. Save or Update Daily Headcount Report
app.post('/api/daily-headcount/save', async (req, res) => {
  try {
    const { reportDate, rawDateStr, uploadedBy, records } = req.body;
    if (!reportDate || !Array.isArray(records)) {
      return res.status(400).json({ error: 'reportDate and records array are required' });
    }

    const normDate = normalizeDateStr(reportDate);

    // Fetch employee directory for official name lookup
    const allEmployees = await Employee.find({});
    const empMap = new Map();
    allEmployees.forEach(emp => {
      const epf = String(emp.epfNo).trim();
      const clean = String(parseInt(epf, 10) || epf);
      empMap.set(epf, emp.fullName);
      empMap.set(clean, emp.fullName);
    });

    // Filter out Number = 00001
    const validRaw = records.filter(r => {
      const epf = String(r.epfNo || r.number || '').trim();
      return epf && epf !== '00001' && epf !== '1' && !epf.endsWith('00001');
    });

    const enrichedRecords = validRaw.map(r => {
      const epfRaw = String(r.epfNo || r.number || '').trim();
      const epfClean = String(parseInt(epfRaw, 10) || epfRaw);
      const matchedName = empMap.get(epfRaw) || empMap.get(epfClean) || r.fullName || r.name || 'Unknown';
      const lateStr = String(r.late || '').trim();
      const lateMins = parseLateMinutes(lateStr);

      return {
        epfNo: epfRaw,
        fullName: matchedName,
        department: r.department || 'General',
        unit: r.unit || 'General',
        gender: String(r.gender || 'MALE').trim().toUpperCase(),
        shiftName: r.shiftName || '',
        present: String(r.present || 'Yes').trim(),
        leave: String(r.leave || 'No').trim(),
        firstDate: r.firstDate || rawDateStr || normDate,
        inTime: r.inTime || '',
        outTime: r.outTime || '',
        secondDate: r.secondDate || '',
        secondInTime: r.secondInTime || '',
        secondOutTime: r.secondOutTime || '',
        late: lateStr,
        lateMinutes: lateMins,
        isLateOver15: lateMins > 15,
        earlyDeparture: r.earlyDeparture || '',
        workHrs: Number(r.workHrs || 0),
        rostered: r.rostered || 'No'
      };
    });

    const metrics = computeHeadcountMetrics(enrichedRecords);

    const saved = await DailyHeadcount.findOneAndUpdate(
      { reportDate: normDate },
      {
        $set: {
          reportDate: normDate,
          rawDateStr: rawDateStr || reportDate,
          uploadedBy: uploadedBy || 'Mr. Nimesh',
          uploadedAt: new Date(),
          headcount: metrics.headcount,
          maleCount: metrics.maleCount,
          femaleCount: metrics.femaleCount,
          presentCount: metrics.presentCount,
          absentCount: metrics.absentCount,
          leaveCount: metrics.leaveCount,
          lateOver15Count: metrics.lateOver15Count,
          records: enrichedRecords
        }
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: `Daily Headcount for date ${normDate} saved successfully (${metrics.headcount} employees processed).`,
      headcount: saved
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get Daily Headcount with Single Day, Month-Wise, or Date-Range Filtering
app.get('/api/daily-headcount', async (req, res) => {
  try {
    const { mode = 'single', date, month, startDate, endDate } = req.query;

    const allDates = await DailyHeadcount.find({}, 'reportDate uploadedBy').sort({ reportDate: -1 });
    const availableDates = allDates.map(a => a.reportDate);
    const availableMonths = Array.from(new Set(availableDates.map(d => d.slice(0, 7)))).sort().reverse();

    // A. Month-Wise Aggregation
    if (mode === 'month') {
      let targetMonth = month;
      if (!targetMonth && availableMonths.length > 0) {
        targetMonth = availableMonths[0];
      }
      if (!targetMonth) {
        targetMonth = new Date().toISOString().slice(0, 7);
      }

      const monthAudits = await DailyHeadcount.find({
        reportDate: { $regex: `^${targetMonth}` }
      }).sort({ reportDate: 1 });

      const daysCount = monthAudits.length;
      let totalHeadcount = 0;
      let totalMale = 0;
      let totalFemale = 0;
      let totalPresent = 0;
      let totalAbsent = 0;
      let totalLeave = 0;
      let totalLateOver15 = 0;

      const dailyTimeline = [];
      const allRecords = [];

      monthAudits.forEach(audit => {
        totalHeadcount += audit.headcount || 0;
        totalMale += audit.maleCount || 0;
        totalFemale += audit.femaleCount || 0;
        totalPresent += audit.presentCount || 0;
        totalAbsent += audit.absentCount || 0;
        const dayLeave = audit.records
          ? audit.records.filter(r => isLeaveVal(r.leave) && r.epfNo !== '00001' && r.epfNo !== '1').length
          : (audit.leaveCount || 0);
        const dayLateOver15 = audit.records
          ? audit.records.filter(r => (r.isLateOver15 || parseLateMinutes(r.late) > 15) && r.epfNo !== '00001' && r.epfNo !== '1').length
          : (audit.lateOver15Count || 0);
        totalLeave += dayLeave;
        totalLateOver15 += dayLateOver15;

        dailyTimeline.push({
          date: audit.reportDate,
          headcount: audit.headcount || 0,
          male: audit.maleCount || 0,
          female: audit.femaleCount || 0,
          present: audit.presentCount || 0,
          absent: audit.absentCount || 0,
          leave: dayLeave,
          lateOver15: dayLateOver15
        });

        audit.records.forEach(r => {
          allRecords.push({
            ...r.toObject(),
            reportDate: audit.reportDate,
            firstDate: r.firstDate || audit.reportDate
          });
        });
      });

      const avgHeadcount = daysCount > 0 ? Math.round(totalHeadcount / daysCount) : 0;
      const avgMale = daysCount > 0 ? Math.round(totalMale / daysCount) : 0;
      const avgFemale = daysCount > 0 ? Math.round(totalFemale / daysCount) : 0;
      const avgPresent = daysCount > 0 ? Math.round(totalPresent / daysCount) : 0;
      const avgAbsent = daysCount > 0 ? Math.round(totalAbsent / daysCount) : 0;

      return res.json({
        filterMode: 'month',
        targetMonth,
        availableDates,
        availableMonths,
        availableAudits: allDates,
        headcountData: {
          reportDate: targetMonth,
          isAggregated: true,
          daysCount,
          headcount: avgHeadcount,
          maleCount: avgMale,
          femaleCount: avgFemale,
          presentCount: avgPresent,
          absentCount: avgAbsent,
          leaveCount: totalLeave,
          lateOver15Count: totalLateOver15,
          totalHeadcountCumulative: totalHeadcount,
          dailyTimeline,
          records: allRecords
        }
      });
    }

    // B. Custom Date Range Aggregation
    if (mode === 'range') {
      const startNorm = normalizeDateStr(startDate || '2000-01-01');
      const endNorm = normalizeDateStr(endDate || '2099-12-31');

      const rangeAudits = await DailyHeadcount.find({
        reportDate: { $gte: startNorm, $lte: endNorm }
      }).sort({ reportDate: 1 });

      const daysCount = rangeAudits.length;
      let totalHeadcount = 0;
      let totalMale = 0;
      let totalFemale = 0;
      let totalPresent = 0;
      let totalAbsent = 0;
      let totalLeave = 0;
      let totalLateOver15 = 0;

      const dailyTimeline = [];
      const allRecords = [];

      rangeAudits.forEach(audit => {
        totalHeadcount += audit.headcount || 0;
        totalMale += audit.maleCount || 0;
        totalFemale += audit.femaleCount || 0;
        totalPresent += audit.presentCount || 0;
        totalAbsent += audit.absentCount || 0;
        const dayLeave = audit.records
          ? audit.records.filter(r => isLeaveVal(r.leave) && r.epfNo !== '00001' && r.epfNo !== '1').length
          : (audit.leaveCount || 0);
        const dayLateOver15 = audit.records
          ? audit.records.filter(r => (r.isLateOver15 || parseLateMinutes(r.late) > 15) && r.epfNo !== '00001' && r.epfNo !== '1').length
          : (audit.lateOver15Count || 0);
        totalLeave += dayLeave;
        totalLateOver15 += dayLateOver15;

        dailyTimeline.push({
          date: audit.reportDate,
          headcount: audit.headcount || 0,
          male: audit.maleCount || 0,
          female: audit.femaleCount || 0,
          present: audit.presentCount || 0,
          absent: audit.absentCount || 0,
          leave: dayLeave,
          lateOver15: dayLateOver15
        });

        audit.records.forEach(r => {
          allRecords.push({
            ...r.toObject(),
            reportDate: audit.reportDate,
            firstDate: r.firstDate || audit.reportDate
          });
        });
      });

      const avgHeadcount = daysCount > 0 ? Math.round(totalHeadcount / daysCount) : 0;
      const avgMale = daysCount > 0 ? Math.round(totalMale / daysCount) : 0;
      const avgFemale = daysCount > 0 ? Math.round(totalFemale / daysCount) : 0;
      const avgPresent = daysCount > 0 ? Math.round(totalPresent / daysCount) : 0;
      const avgAbsent = daysCount > 0 ? Math.round(totalAbsent / daysCount) : 0;

      return res.json({
        filterMode: 'range',
        startDate: startNorm,
        endDate: endNorm,
        availableDates,
        availableMonths,
        availableAudits: allDates,
        headcountData: {
          reportDate: `${startNorm} to ${endNorm}`,
          isAggregated: true,
          daysCount,
          headcount: avgHeadcount,
          maleCount: avgMale,
          femaleCount: avgFemale,
          presentCount: avgPresent,
          absentCount: avgAbsent,
          leaveCount: totalLeave,
          lateOver15Count: totalLateOver15,
          dailyTimeline,
          records: allRecords
        }
      });
    }

    // C. Single Day Mode (Default)
    let queryDate = date;
    if (!queryDate && availableDates.length > 0) {
      queryDate = availableDates[0];
    }

    let report = null;
    if (queryDate) {
      const norm = normalizeDateStr(queryDate);
      report = await DailyHeadcount.findOne({
        $or: [{ reportDate: norm }, { rawDateStr: queryDate }, { reportDate: queryDate }]
      });
    }

    if (!report && availableDates.length > 0) {
      report = await DailyHeadcount.findOne({ reportDate: availableDates[0] });
    }

    if (report) {
      const repObj = report.toObject();
      if (repObj.records) {
        repObj.leaveCount = repObj.records.filter(r => isLeaveVal(r.leave) && r.epfNo !== '00001' && r.epfNo !== '1').length;
        repObj.lateOver15Count = repObj.records.filter(r => (r.isLateOver15 || parseLateMinutes(r.late) > 15) && r.epfNo !== '00001' && r.epfNo !== '1').length;
      }
      return res.json({
        filterMode: 'single',
        availableDates,
        availableMonths,
        availableAudits: allDates,
        headcountData: repObj
      });
    }

    res.json({
      filterMode: 'single',
      availableDates,
      availableMonths,
      availableAudits: allDates,
      headcountData: null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Edit Employee Attendance Record (Mr. Nimesh / Admin)
app.put('/api/daily-headcount/:reportDate/record/:recordId', async (req, res) => {
  try {
    const { reportDate, recordId } = req.params;
    const { epfNo, fullName, department, unit, gender, shiftName, present, leave, late, workHrs, inTime, outTime } = req.body;

    const norm = normalizeDateStr(reportDate);
    const report = await DailyHeadcount.findOne({
      $or: [{ reportDate: norm }, { rawDateStr: reportDate }, { reportDate }]
    });

    if (!report) {
      return res.status(404).json({ error: 'Daily headcount report not found for this date' });
    }

    const rec = report.records.id(recordId);
    if (!rec) {
      return res.status(404).json({ error: 'Employee record not found in headcount report' });
    }

    if (epfNo !== undefined) rec.epfNo = String(epfNo).trim();
    if (fullName !== undefined) rec.fullName = String(fullName).trim();
    if (department !== undefined) rec.department = String(department).trim();
    if (unit !== undefined) rec.unit = String(unit).trim();
    if (gender !== undefined) rec.gender = String(gender).trim().toUpperCase();
    if (shiftName !== undefined) rec.shiftName = String(shiftName).trim();
    if (present !== undefined) rec.present = String(present).trim();
    if (leave !== undefined) rec.leave = String(leave).trim();
    if (inTime !== undefined) rec.inTime = String(inTime).trim();
    if (outTime !== undefined) rec.outTime = String(outTime).trim();
    if (workHrs !== undefined) rec.workHrs = Number(workHrs || 0);

    if (late !== undefined) {
      rec.late = String(late).trim();
      rec.lateMinutes = parseLateMinutes(rec.late);
      rec.isLateOver15 = rec.lateMinutes > 15;
    }

    const metrics = computeHeadcountMetrics(report.records);
    report.headcount = metrics.headcount;
    report.maleCount = metrics.maleCount;
    report.femaleCount = metrics.femaleCount;
    report.presentCount = metrics.presentCount;
    report.absentCount = metrics.absentCount;
    report.leaveCount = metrics.leaveCount;
    report.lateOver15Count = metrics.lateOver15Count;

    await report.save();

    res.json({
      success: true,
      message: `Employee #${rec.epfNo} (${rec.fullName}) record updated successfully.`,
      record: rec,
      headcount: report
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Delete Employee Record from Headcount (Mr. Nimesh / Admin)
app.delete('/api/daily-headcount/:reportDate/record/:recordId', async (req, res) => {
  try {
    const { reportDate, recordId } = req.params;
    const norm = normalizeDateStr(reportDate);

    const report = await DailyHeadcount.findOne({
      $or: [{ reportDate: norm }, { rawDateStr: reportDate }, { reportDate }]
    });

    if (!report) {
      return res.status(404).json({ error: 'Daily headcount report not found for this date' });
    }

    report.records = report.records.filter(r => String(r._id) !== String(recordId));

    const metrics = computeHeadcountMetrics(report.records);
    report.headcount = metrics.headcount;
    report.maleCount = metrics.maleCount;
    report.femaleCount = metrics.femaleCount;
    report.presentCount = metrics.presentCount;
    report.absentCount = metrics.absentCount;
    report.leaveCount = metrics.leaveCount;
    report.lateOver15Count = metrics.lateOver15Count;

    await report.save();

    res.json({
      success: true,
      message: 'Employee record deleted successfully.',
      headcount: report
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Delete Full Day's Headcount Report (Mr. Nimesh / Admin)
app.delete('/api/daily-headcount/:reportDate', async (req, res) => {
  try {
    const { reportDate } = req.params;
    const norm = normalizeDateStr(reportDate);

    const deleted = await DailyHeadcount.findOneAndDelete({
      $or: [{ reportDate: norm }, { rawDateStr: reportDate }, { reportDate }]
    });

    if (!deleted) {
      return res.status(404).json({ error: 'Daily headcount report not found for this date' });
    }

    res.json({
      success: true,
      message: `Daily Headcount report for ${norm} permanently deleted.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Add Manual Employee Record to Headcount Report (Mr. Nimesh / Admin)
app.post('/api/daily-headcount/:reportDate/record', async (req, res) => {
  try {
    const { reportDate } = req.params;
    const { epfNo, fullName, department, unit, gender, shiftName, present, leave, late, workHrs, inTime, outTime } = req.body;

    if (!epfNo) {
      return res.status(400).json({ error: 'EPF Number is required' });
    }

    const norm = normalizeDateStr(reportDate);
    const report = await DailyHeadcount.findOne({
      $or: [{ reportDate: norm }, { rawDateStr: reportDate }, { reportDate }]
    });

    if (!report) {
      return res.status(404).json({ error: 'Daily headcount report not found for this date' });
    }

    let resolvedName = fullName;
    if (!resolvedName) {
      const epfClean = String(parseInt(epfNo, 10) || epfNo);
      const emp = await Employee.findOne({
        $or: [{ epfNo: String(epfNo).trim() }, { epfNo: epfClean }]
      });
      resolvedName = emp ? emp.fullName : `Employee #${epfNo}`;
    }

    const lateStr = String(late || '00:00').trim();
    const lateMins = parseLateMinutes(lateStr);

    const newRecord = {
      epfNo: String(epfNo).trim(),
      fullName: resolvedName,
      department: department || 'General',
      unit: unit || 'General',
      gender: String(gender || 'MALE').trim().toUpperCase(),
      shiftName: shiftName || 'General GE',
      present: present || 'Yes',
      leave: leave || 'No',
      firstDate: report.reportDate,
      inTime: inTime || '',
      outTime: outTime || '',
      late: lateStr,
      lateMinutes: lateMins,
      isLateOver15: lateMins > 15,
      workHrs: Number(workHrs || 8)
    };

    report.records.push(newRecord);

    const metrics = computeHeadcountMetrics(report.records);
    report.headcount = metrics.headcount;
    report.maleCount = metrics.maleCount;
    report.femaleCount = metrics.femaleCount;
    report.presentCount = metrics.presentCount;
    report.absentCount = metrics.absentCount;
    report.leaveCount = metrics.leaveCount;
    report.lateOver15Count = metrics.lateOver15Count;

    await report.save();

    res.json({
      success: true,
      message: `Employee #${epfNo} (${resolvedName}) added to headcount.`,
      record: newRecord,
      headcount: report
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
