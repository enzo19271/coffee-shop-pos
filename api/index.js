import crypto from 'crypto';

// ─── AUTH ────────────────────────────────────────────────────────────────────
function generateToken(payload) {
  const secret = process.env.JWT_SECRET || 'default-secret-key';
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyToken(token) {
  try {
    const secret = process.env.JWT_SECRET || 'default-secret-key';
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token format');
    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');
    if (signature !== expectedSignature) throw new Error('Invalid signature');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
    return payload;
  } catch {
    return null;
  }
}

function simplePasswordVerify(inputPassword, storedHash) {
  const staffPassword = 'password';
  const adminPassword = 'admin';
  if (storedHash.includes('staff') && inputPassword === staffPassword) return true;
  if (storedHash.includes('admin') && inputPassword === adminPassword) return true;
  return false;
}

// ─── GITHUB ──────────────────────────────────────────────────────────────────
const GITHUB_API = 'https://api.github.com';

async function getGitHubFile(path) {
  const cacheBuster = Date.now();
  const branch = process.env.GITHUB_BRANCH || 'main';
  const response = await fetch(
    `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${path}?ref=${branch}&_=${cacheBuster}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3.raw',
        'Cache-Control': 'no-cache'
      },
      cache: 'no-store'
    }
  );
  if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
  return await response.text();
}

async function updateGitHubFile(path, content, message) {
  const shaResponse = await fetch(
    `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${path}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json'
      }
    }
  );
  let sha = '';
  if (shaResponse.ok) {
    const data = await shaResponse.json();
    sha = data.sha;
  }
  const updateResponse = await fetch(
    `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: message || `Update ${path}`,
        content: Buffer.from(content).toString('base64'),
        sha: sha || undefined,
        branch: process.env.GITHUB_BRANCH || 'main'
      })
    }
  );
  if (!updateResponse.ok) throw new Error(`Failed to update file: ${updateResponse.status}`);
  return await updateResponse.json();
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getCurrentOrderFile() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `data/orders/orders-${year}-${month}.json`;
}

function getOrderFileForMonth(yearMonth) {
  return `data/orders/orders-${yearMonth}.json`;
}

function generateOrderId() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substr(2, 5).toUpperCase();
  return `ORD-${timestamp}-${random}`;
}

function getAuthPayload(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  return verifyToken(token);
}

// ─── ROUTE HANDLERS ──────────────────────────────────────────────────────────
async function handleLogin(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const staffData = await getGitHubFile('data/staff/users.json');
    const users = JSON.parse(staffData);
    const user = users.find(u => u.username === username);
    if (!user || !simplePasswordVerify(password, user.passwordHash))
      return res.status(401).json({ error: 'Invalid credentials' });
    if (user.status !== 'active') return res.status(401).json({ error: 'User account is inactive' });
    const token = generateToken({
      userId: user.id, username: user.username, role: user.role, name: user.name,
      exp: Math.floor(Date.now() / 1000) + 86400
    });
    return res.status(200).json({ success: true, token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const menuData = await getGitHubFile('data/menu/items.json');
    return res.status(200).json({ success: true, data: JSON.parse(menuData) });
  } catch (error) {
    console.error('Menu list error:', error);
    return res.status(500).json({ error: 'Failed to fetch menu' });
  }
}

async function handleCreate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { customerName, tableNo, items, paymentMethod, paymentProof, notes } = req.body;
    if (!customerName || !tableNo || !items || items.length === 0 || !paymentMethod)
      return res.status(400).json({ error: 'Missing required fields' });
    if (paymentMethod !== 'cash' && !paymentProof)
      return res.status(400).json({ error: 'Payment proof required for this payment method' });
    let totalPrice = 0;
    items.forEach(item => { totalPrice += item.price * item.quantity; });
    const orderId = generateOrderId();
    const orderFile = getCurrentOrderFile();
    const newOrder = {
      id: orderId, timestamp: new Date().toISOString(),
      customer: { name: customerName, tableNo },
      items, totalPrice, paymentMethod,
      paymentProof: paymentProof || null, notes: notes || '',
      status: paymentMethod === 'cash' ? 'pending' : 'pending_verification',
      createdAt: new Date().toISOString(),
      recordedBy: req.body.recordedBy || 'unknown'
    };
    let orders = [];
    try { orders = JSON.parse(await getGitHubFile(orderFile)); } catch { orders = []; }
    orders.push(newOrder);
    await updateGitHubFile(orderFile, JSON.stringify(orders, null, 2), `Add order ${orderId}`);
    return res.status(201).json({ success: true, orderId, message: 'Order created successfully', order: newOrder });
  } catch (error) {
    console.error('Order creation error:', error);
    return res.status(500).json({ error: 'Failed to create order' });
  }
}

async function handlePending(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'staff' && payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    let orders = [];
    try { orders = JSON.parse(await getGitHubFile(getCurrentOrderFile())); } catch { orders = []; }
    const pendingOrders = orders
      .filter(o => ['pending', 'pending_verification', 'confirmed'].includes(o.status))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return res.status(200).json({ success: true, data: pendingOrders, count: pendingOrders.length });
  } catch (error) {
    console.error('Pending orders error:', error);
    return res.status(500).json({ error: 'Failed to fetch pending orders' });
  }
}

async function handleOrders(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    
    const month = req.query.month || '';
    const status = req.query.status || '';
    
    if (!month) return res.status(400).json({ error: 'Month parameter required' });
    
    const orderFile = getOrderFileForMonth(month);
    let orders = [];
    try { orders = JSON.parse(await getGitHubFile(orderFile)); } catch { orders = []; }
    
    if (status) {
      orders = orders.filter(o => o.status === status);
    }
    
    orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return res.status(200).json({ success: true, data: orders });
  } catch (error) {
    console.error('Orders error:', error);
    return res.status(500).json({ error: 'Failed to fetch orders' });
  }
}

async function handleUpdateStatus(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'staff' && payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { orderId, status } = req.body;
    if (!orderId || !status) return res.status(400).json({ error: 'Order ID and status required' });
    const validStatuses = ['pending', 'pending_verification', 'confirmed', 'completed', 'rejected'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const orderFile = getCurrentOrderFile();
    let orders = JSON.parse(await getGitHubFile(orderFile));
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) return res.status(404).json({ error: 'Order not found' });
    orders[orderIndex].status = status;
    orders[orderIndex].updatedAt = new Date().toISOString();
    orders[orderIndex].updatedBy = payload.username;
    await updateGitHubFile(orderFile, JSON.stringify(orders, null, 2), `Update order ${orderId} status to ${status}`);
    return res.status(200).json({ success: true, message: 'Order status updated', order: orders[orderIndex] });
  } catch (error) {
    console.error('Update order status error:', error);
    return res.status(500).json({ error: 'Failed to update order' });
  }
}

async function handleUpdateOrderStatus(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    
    const { orderId, status } = req.body;
    if (!orderId || !status) return res.status(400).json({ error: 'Order ID and status required' });
    
    const validStatuses = ['pending', 'pending_verification', 'confirmed', 'completed', 'rejected'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    
    const orderFile = getCurrentOrderFile();
    let orders = [];
    try { orders = JSON.parse(await getGitHubFile(orderFile)); } catch { orders = []; }
    
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) return res.status(404).json({ error: 'Order not found' });
    
    orders[orderIndex].status = status;
    orders[orderIndex].updatedAt = new Date().toISOString();
    orders[orderIndex].updatedBy = payload.username;
    
    await updateGitHubFile(orderFile, JSON.stringify(orders, null, 2), `Update order ${orderId} status to ${status}`);
    return res.status(200).json({ success: true, message: 'Order status updated', order: orders[orderIndex] });
  } catch (error) {
    console.error('Update order status error:', error);
    return res.status(500).json({ error: 'Failed to update order' });
  }
}

async function handleSummary(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'staff' && payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const period = req.query.period || 'today';
    let orders = [];
    try { orders = JSON.parse(await getGitHubFile(getCurrentOrderFile())); } catch { orders = []; }
    let expenses = [];
    try { expenses = JSON.parse(await getGitHubFile('data/analytics/expenses.json')); } catch { expenses = []; }
    const today = new Date().toISOString().split('T')[0];
    let filteredOrders = orders;
    let filteredExpenses = expenses;
    if (period === 'today') {
      filteredOrders = orders.filter(o => o.timestamp.startsWith(today));
      filteredExpenses = expenses.filter(e => e.date === today);
    } else if (period === 'thisMonth') {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const monthPrefix = `${year}-${month}`;
      filteredOrders = orders.filter(o => o.timestamp.startsWith(monthPrefix));
      filteredExpenses = expenses.filter(e => e.date.startsWith(monthPrefix));
    }
    const completedOrders = filteredOrders.filter(o => o.status === 'completed');
    const totalRevenue = completedOrders.reduce((sum, o) => sum + o.totalPrice, 0);
    const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
    return res.status(200).json({
      success: true,
      data: {
        period, totalOrders: filteredOrders.length,
        completedOrders: completedOrders.length,
        totalRevenue, totalExpenses,
        netProfit: totalRevenue - totalExpenses,
        averageOrderValue: completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0
      }
    });
  } catch (error) {
    console.error('Analytics summary error:', error);
    return res.status(500).json({ error: 'Failed to fetch analytics' });
  }
}

async function handleExpenses(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'staff' && payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    
    let expenses = [];
    try { expenses = JSON.parse(await getGitHubFile('data/analytics/expenses.json')); } catch { expenses = []; }
    
    expenses.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.status(200).json({ success: true, data: expenses });
  } catch (error) {
    console.error('Expenses list error:', error);
    return res.status(500).json({ error: 'Failed to fetch expenses' });
  }
}

async function handleExpense(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    
    const expenseId = req.query.id;
    if (!expenseId) return res.status(400).json({ error: 'Expense ID required' });
    
    let expenses = [];
    try { expenses = JSON.parse(await getGitHubFile('data/analytics/expenses.json')); } catch { expenses = []; }
    
    const expense = expenses.find(e => e.id === expenseId);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    
    return res.status(200).json({ success: true, data: expense });
  } catch (error) {
    console.error('Expense error:', error);
    return res.status(500).json({ error: 'Failed to fetch expense' });
  }
}

async function handleAddExpense(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'staff' && payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { category, amount, description, date, notes } = req.body;
    if (!category || !amount || amount <= 0) return res.status(400).json({ error: 'Category and valid amount required' });
    const expense = {
      id: `EXP-${Date.now()}`, category, amount,
      description: description || '',
      date: date || new Date().toISOString().split('T')[0],
      notes: notes || '',
      recordedBy: payload.username, createdAt: new Date().toISOString()
    };
    let expenses = [];
    try { expenses = JSON.parse(await getGitHubFile('data/analytics/expenses.json')); } catch { expenses = []; }
    expenses.push(expense);
    await updateGitHubFile('data/analytics/expenses.json', JSON.stringify(expenses, null, 2), `Add expense: ${category} - ${amount}`);
    return res.status(201).json({ success: true, message: 'Expense recorded', expense });
  } catch (error) {
    console.error('Add expense error:', error);
    return res.status(500).json({ error: 'Failed to add expense' });
  }
}

async function handleUpdateExpense(req, res) {
  if (req.method !== 'PUT' && req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    
    const expenseId = req.query.id || req.body?.id;
    if (!expenseId) return res.status(400).json({ error: 'Expense ID is required' });
    
    let expenses = [];
    try { expenses = JSON.parse(await getGitHubFile('data/analytics/expenses.json')); } catch { expenses = []; }
    
    const index = expenses.findIndex(e => e.id === expenseId);
    if (index === -1) return res.status(404).json({ error: 'Expense not found' });
    
    if (req.method === 'DELETE') {
      const removed = expenses.splice(index, 1)[0];
      await updateGitHubFile('data/analytics/expenses.json', JSON.stringify(expenses, null, 2), `Delete expense: ${removed.description}`);
      return res.status(200).json({ success: true, message: 'Expense deleted' });
    }
    
    const { category, amount, description, date, notes } = req.body;
    expenses[index] = {
      ...expenses[index],
      category: category ?? expenses[index].category,
      amount: amount ?? expenses[index].amount,
      description: description ?? expenses[index].description,
      date: date ?? expenses[index].date,
      notes: notes ?? expenses[index].notes,
      updatedAt: new Date().toISOString()
    };
    
    await updateGitHubFile('data/analytics/expenses.json', JSON.stringify(expenses, null, 2), `Update expense: ${expenses[index].description}`);
    return res.status(200).json({ success: true, data: expenses[index] });
  } catch (error) {
    console.error('Update/delete expense error:', error);
    return res.status(500).json({ error: 'Failed to update expense' });
  }
}

async function handleAddMenu(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { name, category, price, image, description, variants } = req.body;
    if (!name || !category || !price || price <= 0 || !image)
      return res.status(400).json({ error: 'Name, category, price, and image are required' });
    let items = [];
    try { items = JSON.parse(await getGitHubFile('data/menu/items.json')); } catch { items = []; }
    const nextId = items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1;
    const newItem = { id: nextId, name, category, price, description: description || '', image, variants: Array.isArray(variants) ? variants : [] };
    items.push(newItem);
    await updateGitHubFile('data/menu/items.json', JSON.stringify(items, null, 2), `Add menu item: ${name}`);
    return res.status(201).json({ success: true, message: 'Menu item added', data: newItem });
  } catch (error) {
    console.error('Add menu error:', error);
    return res.status(500).json({ error: 'Failed to add menu item' });
  }
}

async function handleUpdateMenu(req, res) {
  if (req.method !== 'PUT' && req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload || payload.role !== 'admin') return res.status(401).json({ error: 'Unauthorized' });
    const menuId = parseInt(req.query.id || req.body?.id);
    if (!menuId) return res.status(400).json({ error: 'Menu id is required' });
    let items = [];
    try { items = JSON.parse(await getGitHubFile('data/menu/items.json')); } catch { items = []; }
    const index = items.findIndex(i => i.id === menuId);
    if (index === -1) return res.status(404).json({ error: 'Menu item not found' });
    if (req.method === 'DELETE') {
      const removed = items.splice(index, 1)[0];
      await updateGitHubFile('data/menu/items.json', JSON.stringify(items, null, 2), `Delete menu item: ${removed.name}`);
      return res.status(200).json({ success: true, message: 'Menu item deleted' });
    }
    const { name, category, price, image, description, variants } = req.body;
    items[index] = {
      ...items[index],
      name: name ?? items[index].name, category: category ?? items[index].category,
      price: price ?? items[index].price, image: image ?? items[index].image,
      description: description ?? items[index].description,
      variants: Array.isArray(variants) ? variants : items[index].variants || []
    };
    await updateGitHubFile('data/menu/items.json', JSON.stringify(items, null, 2), `Update menu item: ${items[index].name}`);
    return res.status(200).json({ success: true, data: items[index] });
  } catch (error) {
    console.error('Update/delete menu error:', error);
    return res.status(500).json({ error: 'Failed to update menu item' });
  }
}

async function handleStaff(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    
    const staffData = await getGitHubFile('data/staff/users.json');
    const users = JSON.parse(staffData);
    return res.status(200).json({ success: true, data: users });
  } catch (error) {
    console.error('Staff list error:', error);
    return res.status(500).json({ error: 'Failed to fetch staff' });
  }
}

async function handleAddStaff(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    
    const { name, username, password, role } = req.body;
    if (!name || !username || !password || !role) {
      return res.status(400).json({ error: 'Name, username, password, and role are required' });
    }
    
    let users = [];
    try { users = JSON.parse(await getGitHubFile('data/staff/users.json')); } catch { users = []; }
    
    if (users.some(u => u.username === username)) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    const newUser = {
      id: `USR-${Date.now()}`,
      name,
      username,
      passwordHash: `${role}-hashed`,
      role,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    
    users.push(newUser);
    await updateGitHubFile('data/staff/users.json', JSON.stringify(users, null, 2), `Add staff: ${name}`);
    return res.status(201).json({ success: true, message: 'Staff added successfully', data: newUser });
  } catch (error) {
    console.error('Add staff error:', error);
    return res.status(500).json({ error: 'Failed to add staff' });
  }
}

async function handleDeleteStaff(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    
    const { staffId } = req.body;
    if (!staffId) return res.status(400).json({ error: 'Staff ID is required' });
    
    let users = [];
    try { users = JSON.parse(await getGitHubFile('data/staff/users.json')); } catch { users = []; }
    
    const index = users.findIndex(u => u.id === staffId);
    if (index === -1) return res.status(404).json({ error: 'Staff not found' });
    
    const removed = users.splice(index, 1)[0];
    await updateGitHubFile('data/staff/users.json', JSON.stringify(users, null, 2), `Delete staff: ${removed.name}`);
    return res.status(200).json({ success: true, message: 'Staff deleted successfully' });
  } catch (error) {
    console.error('Delete staff error:', error);
    return res.status(500).json({ error: 'Failed to delete staff' });
  }
}

async function handleSettings(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    
    let settings = {};
    try { settings = JSON.parse(await getGitHubFile('data/settings/config.json')); } catch { settings = {}; }
    
    return res.status(200).json({ success: true, data: settings });
  } catch (error) {
    console.error('Get settings error:', error);
    return res.status(500).json({ error: 'Failed to fetch settings' });
  }
}

async function handleSaveSettings(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    
    const { shopName, shopAddress, shopPhone, shopEmail, shopHours, paymentMethods } = req.body;
    
    const settings = {
      shopName: shopName || '',
      shopAddress: shopAddress || '',
      shopPhone: shopPhone || '',
      shopEmail: shopEmail || '',
      shopHours: shopHours || '',
      paymentMethods: paymentMethods || '',
      updatedAt: new Date().toISOString(),
      updatedBy: payload.username
    };
    
    await updateGitHubFile('data/settings/config.json', JSON.stringify(settings, null, 2), 'Update shop settings');
    return res.status(200).json({ success: true, message: 'Settings saved successfully', data: settings });
  } catch (error) {
    console.error('Save settings error:', error);
    return res.status(500).json({ error: 'Failed to save settings' });
  }
}

// ─── MAIN ROUTER ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname.replace(/^\/api/, '');

  // forward query string params onto req.query
  req.query = Object.fromEntries(url.searchParams.entries());

  // Parse body for JSON requests
  if (req.method !== 'GET' && req.headers['content-type']?.includes('application/json')) {
    try {
      req.body = JSON.parse(await req.text());
    } catch {
      req.body = {};
    }
  }

  switch (pathname) {
    case '/login':                 return handleLogin(req, res);
    case '/list':                  return handleList(req, res);
    case '/create':                return handleCreate(req, res);
    case '/pending':               return handlePending(req, res);
    case '/orders':                return handleOrders(req, res);
    case '/update-status':         return handleUpdateStatus(req, res);
    case '/update-order-status':   return handleUpdateOrderStatus(req, res);
    case '/summary':               return handleSummary(req, res);
    case '/expenses':              return handleExpenses(req, res);
    case '/expense':               return handleExpense(req, res);
    case '/add-expense':           return handleAddExpense(req, res);
    case '/update-expense':        return handleUpdateExpense(req, res);
    case '/add-menu':              return handleAddMenu(req, res);
    case '/update-menu':           return handleUpdateMenu(req, res);
    case '/staff':                 return handleStaff(req, res);
    case '/add-staff':             return handleAddStaff(req, res);
    case '/delete-staff':          return handleDeleteStaff(req, res);
    case '/settings':              return handleSettings(req, res);
    case '/save-settings':         return handleSaveSettings(req, res);
    default:                       return res.status(404).json({ error: 'Not found' });
  }
}
