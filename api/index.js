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

function hashPassword(password) {
  const secret = process.env.JWT_SECRET || 'default-secret-key';
  return crypto.createHash('sha256').update(String(password) + '|' + secret).digest('hex');
}

function simplePasswordVerify(inputPassword, storedHash) {
  if (!storedHash) return false;
  // New format: sha256 hash
  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    return hashPassword(inputPassword) === storedHash;
  }
  // Legacy demo accounts
  if (storedHash.includes('staff') && inputPassword === 'password') return true;
  if (storedHash.includes('admin') && inputPassword === 'admin') return true;
  // Plain password fallback (legacy mis-stored)
  if (storedHash === inputPassword) return true;
  return false;
}

// ─── GITHUB ──────────────────────────────────────────────────────────────────
const GITHUB_API = 'https://api.github.com';

// Dual-branch: code stays on main (deploy), data writes go to data branch
// Set GITHUB_DATA_BRANCH=data in env to isolate data commits from deploys
function getDataBranch() {
  return process.env.GITHUB_DATA_BRANCH || process.env.GITHUB_BRANCH || 'main';
}
function getCodeBranch() {
  return process.env.GITHUB_BRANCH || 'main';
}

async function getGitHubFile(path) {
  const cacheBuster = Date.now();
  const branch = getDataBranch();
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
  const branch = getDataBranch();
  // Get SHA from the data branch specifically
  const shaResponse = await fetch(
    `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${path}?ref=${branch}`,
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
        branch: branch
      })
    }
  );
  if (!updateResponse.ok) {
    const errText = await updateResponse.text().catch(() => '');
    throw new Error(`Failed to update file: ${updateResponse.status} ${errText}`);
  }
  return await updateResponse.json();
}

async function deleteGitHubFile(path, message) {
  const branch = getDataBranch();
  const shaResponse = await fetch(
    `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${path}?ref=${branch}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json'
      }
    }
  );
  if (!shaResponse.ok) throw new Error(`File not found: ${path}`);
  const data = await shaResponse.json();
  const delResponse = await fetch(
    `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${path}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: message || `Delete ${path}`,
        sha: data.sha,
        branch: branch
      })
    }
  );
  if (!delResponse.ok) throw new Error(`Failed to delete file: ${delResponse.status}`);
  return true;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getCurrentOrderFile() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `data/orders/orders-${year}-${month}.json`;
}

function getOrderFileByMonth(monthStr) {
  const [year, month] = monthStr.split('-');
  return `data/orders/orders-${year}-${month}.json`;
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
    const name = (req.body.name || req.body.username || '').trim();
    const password = req.body.password;
    if (!name || !password) return res.status(400).json({ error: 'Nama dan password wajib diisi' });
    const staffData = await getGitHubFile('data/staff/users.json');
    const users = JSON.parse(staffData);
    const nameLower = name.toLowerCase();
    const user = users.find(u =>
      (u.name && String(u.name).toLowerCase() === nameLower) ||
      (u.username && String(u.username).toLowerCase() === nameLower)
    );
    if (!user || !simplePasswordVerify(password, user.passwordHash))
      return res.status(401).json({ error: 'Nama atau password salah' });
    if (user.status && user.status !== 'active') return res.status(401).json({ error: 'Akun tidak aktif' });
    const token = generateToken({
      userId: user.id, username: user.username || user.name, role: user.role, name: user.name,
      exp: Math.floor(Date.now() / 1000) + 86400
    });
    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username || user.name,
        name: user.name,
        role: user.role,
        avatar: user.avatar || null
      }
    });
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
    const { customerName, tableNo, items, paymentMethod, paymentProof, notes, source, voucherCode } = req.body;
    if (!customerName || !tableNo || !items || items.length === 0 || !paymentMethod)
      return res.status(400).json({ error: 'Missing required fields' });

    // Staff/admin creating order (kasir) → auto-verified, no proof required for cash
    const payload = getAuthPayload(req);
    const isStaffOrder = source === 'staff' || source === 'kasir';
    if (isStaffOrder) {
      if (!payload || (payload.role !== 'staff' && payload.role !== 'admin')) {
        return res.status(401).json({ error: 'Unauthorized: staff login required for kasir orders' });
      }
    } else {
      // Customer order: proof required for non-cash
      if (paymentMethod !== 'cash' && !paymentProof)
        return res.status(400).json({ error: 'Payment proof required for this payment method' });
    }

    let totalPrice = 0;
    items.forEach(item => { totalPrice += item.price * item.quantity; });

    // Optional voucher code
    let appliedVoucher = null;
    const codeRaw = voucherCode ? String(voucherCode).trim().toUpperCase() : '';
    if (codeRaw) {
      const codes = await readJsonFile('data/loyalty/codes.json', []);
      const entry = codes.find(c => String(c.code).toUpperCase() === codeRaw);
      if (!entry) return res.status(400).json({ error: 'Kode voucher tidak valid' });
      if (entry.status === 'used') return res.status(400).json({ error: 'Kode voucher sudah dipakai' });
      appliedVoucher = entry;
      if (entry.type === 'discount_nominal') {
        totalPrice = Math.max(0, totalPrice - (Number(entry.discountValue) || 0));
      }
      // free_item: informational — staff/kasir should add item free; discount not auto unless matched
    }

    const orderId = generateOrderId();
    const orderFile = getCurrentOrderFile();

    // Staff orders skip verification → status confirmed immediately
    let status;
    if (isStaffOrder) {
      status = 'confirmed';
    } else {
      status = paymentMethod === 'cash' ? 'pending' : 'pending_verification';
    }

    const newOrder = {
      id: orderId,
      timestamp: new Date().toISOString(),
      customer: { name: customerName, tableNo },
      items,
      totalPrice,
      paymentMethod,
      paymentProof: paymentProof || null,
      notes: notes || '',
      status,
      source: isStaffOrder ? 'staff' : 'customer',
      createdBy: isStaffOrder ? payload.username : null,
      createdAt: new Date().toISOString(),
      voucherCode: appliedVoucher ? appliedVoucher.code : null,
      voucherDiscount: appliedVoucher && appliedVoucher.type === 'discount_nominal' ? (Number(appliedVoucher.discountValue) || 0) : 0,
      voucherFreeItem: appliedVoucher && appliedVoucher.type === 'free_item' ? (appliedVoucher.freeItemName || '') : '',
      pointsAwarded: false
    };
    let orders = [];
    try { orders = JSON.parse(await getGitHubFile(orderFile)); } catch { orders = []; }
    orders.push(newOrder);
    await updateGitHubFile(orderFile, JSON.stringify(orders, null, 2), `Add order ${orderId}${isStaffOrder ? ' (staff/kasir)' : ''}`);
    if (appliedVoucher) {
      try { await markVoucherCodeUsed(appliedVoucher.code, orderId); } catch (ve) { console.error(ve); }
    }
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
    if (payload.role !== 'staff' && payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    
    const month = req.query.month;
    const status = req.query.status;
    
    let orders = [];
    try {
      const orderFile = month ? getOrderFileByMonth(month) : getCurrentOrderFile();
      orders = JSON.parse(await getGitHubFile(orderFile));
    } catch { 
      orders = []; 
    }
    
    // Filter by status if provided
    if (status) {
      orders = orders.filter(o => o.status === status);
    }
    
    orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    return res.status(200).json({ success: true, data: orders, count: orders.length });
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
    const prevStatus = orders[orderIndex].status;
    orders[orderIndex].status = status;
    orders[orderIndex].updatedAt = new Date().toISOString();
    orders[orderIndex].updatedBy = payload.username;

    let pointsInfo = null;
    if (status === 'completed' && prevStatus !== 'completed' && !orders[orderIndex].pointsAwarded) {
      try {
        const member = await awardPointForOrder(orders[orderIndex]);
        if (member) {
          orders[orderIndex].pointsAwarded = true;
          orders[orderIndex].pointsAwardedTo = member.name;
          orders[orderIndex].pointsEarned = member.lastEarned || 0;
          pointsInfo = { name: member.name, points: member.points, earned: member.lastEarned || 0 };
        }
      } catch (pe) {
        console.error('Award point error:', pe);
      }
    }

    await updateGitHubFile(orderFile, JSON.stringify(orders, null, 2), `Update order ${orderId} status to ${status}`);
    return res.status(200).json({ success: true, message: 'Order status updated', order: orders[orderIndex], points: pointsInfo });
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
    const period = req.query.period || 'today';
    let expenses = [];
    try { expenses = JSON.parse(await getGitHubFile('data/analytics/expenses.json')); } catch { expenses = []; }
    if (period === 'today') {
      const today = new Date().toISOString().split('T')[0];
      expenses = expenses.filter(e => e.date === today);
    }
    expenses.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.status(200).json({ success: true, data: expenses });
  } catch (error) {
    console.error('Expenses list error:', error);
    return res.status(500).json({ error: 'Failed to fetch expenses' });
  }
}

async function handleAddExpense(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'staff' && payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { category, amount, description, date } = req.body;
    if (!category || !amount || amount <= 0) return res.status(400).json({ error: 'Category and valid amount required' });
    const expense = {
      id: `EXP-${Date.now()}`, category, amount,
      description: description || '',
      date: date || new Date().toISOString().split('T')[0],
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

async function handleStaffList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const staffData = await getGitHubFile('data/staff/users.json');
    const users = JSON.parse(staffData);
    // Remove password hashes from response
    const safeUsers = users.map(u => ({
      id: u.id,
      name: u.name,
      username: u.username,
      role: u.role,
      status: u.status,
      avatar: u.avatar || null,
      createdAt: u.createdAt || new Date().toISOString()
    }));
    return res.status(200).json({ success: true, data: safeUsers });
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
    
    const { name, password, role, avatar } = req.body;
    let username = (req.body.username || '').trim();
    if (!name || !password || !role) {
      return res.status(400).json({ error: 'Nama, password, dan role wajib diisi' });
    }
    if (!username) {
      username = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || ('user' + Date.now());
    }
    
    if (!['staff', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    let users = [];
    try { users = JSON.parse(await getGitHubFile('data/staff/users.json')); } catch { users = []; }
    
    // Check if username already exists
    if (users.find(u => u.username === username)) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    
    const numericIds = users.map(u => parseInt(u.id, 10)).filter(n => !isNaN(n));
    const nextId = numericIds.length > 0 ? Math.max(...numericIds) + 1 : users.length + 1;
    const newUser = {
      id: nextId,
      name,
      username,
      passwordHash: hashPassword(password),
      avatar: avatar || null,
      role,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    
    users.push(newUser);
    await updateGitHubFile('data/staff/users.json', JSON.stringify(users, null, 2), `Add staff: ${username}`);
    
    return res.status(201).json({ 
      success: true, 
      message: 'Staff added successfully',
      data: {
        id: newUser.id,
        name: newUser.name,
        username: newUser.username,
        role: newUser.role
      }
    });
  } catch (error) {
    console.error('Add staff error:', error);
    return res.status(500).json({ error: 'Failed to add staff' });
  }
}


// ─── DELETE ORDERS (admin) ───────────────────────────────────────────────────
async function handleDeleteOrders(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden: admin only' });

    const { mode, orderId, startDate, endDate, month } = req.body || {};
    // mode: 'one' | 'range' | 'month' | 'all'

    if (!mode || !['one', 'range', 'month', 'all'].includes(mode)) {
      return res.status(400).json({ error: 'mode required: one | range | month | all' });
    }

    let deletedCount = 0;
    const results = [];

    if (mode === 'one') {
      if (!orderId) return res.status(400).json({ error: 'orderId required' });
      // Search current month first, then try provided month
      const filesToTry = [getCurrentOrderFile()];
      if (month) filesToTry.unshift(getOrderFileByMonth(month));
      let found = false;
      for (const orderFile of filesToTry) {
        try {
          let orders = JSON.parse(await getGitHubFile(orderFile));
          const before = orders.length;
          orders = orders.filter(o => o.id !== orderId);
          if (orders.length < before) {
            await updateGitHubFile(orderFile, JSON.stringify(orders, null, 2), `Delete order ${orderId} by ${payload.username}`);
            deletedCount = before - orders.length;
            found = true;
            results.push({ file: orderFile, deleted: deletedCount });
            break;
          }
        } catch (e) { /* file may not exist */ }
      }
      if (!found) return res.status(404).json({ error: 'Order not found' });
    } else if (mode === 'month') {
      if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month required as YYYY-MM' });
      const orderFile = getOrderFileByMonth(month);
      try {
        const orders = JSON.parse(await getGitHubFile(orderFile));
        deletedCount = orders.length;
        await updateGitHubFile(orderFile, '[]', `Clear all orders ${month} by ${payload.username}`);
        results.push({ file: orderFile, deleted: deletedCount });
      } catch {
        return res.status(404).json({ error: 'No order file for that month' });
      }
    } else if (mode === 'range') {
      if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required (ISO or YYYY-MM-DD)' });
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      if (isNaN(start) || isNaN(end)) return res.status(400).json({ error: 'Invalid dates' });

      // Collect unique year-months in range
      const months = new Set();
      const cursor = new Date(start);
      while (cursor <= end) {
        months.add(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
        cursor.setMonth(cursor.getMonth() + 1);
      }
      // also add end month
      months.add(`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`);

      for (const m of months) {
        const orderFile = getOrderFileByMonth(m);
        try {
          let orders = JSON.parse(await getGitHubFile(orderFile));
          const before = orders.length;
          orders = orders.filter(o => {
            const t = new Date(o.timestamp || o.createdAt);
            return t < start || t > end;
          });
          const removed = before - orders.length;
          if (removed > 0) {
            await updateGitHubFile(orderFile, JSON.stringify(orders, null, 2), `Delete orders ${startDate}..${endDate} by ${payload.username}`);
            deletedCount += removed;
            results.push({ file: orderFile, deleted: removed });
          }
        } catch (e) { /* skip missing months */ }
      }
    } else if (mode === 'all') {
      // Clear current month + try last 12 months
      const now = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const orderFile = getOrderFileByMonth(m);
        try {
          const orders = JSON.parse(await getGitHubFile(orderFile));
          if (orders.length > 0) {
            deletedCount += orders.length;
            await updateGitHubFile(orderFile, '[]', `Clear ALL orders ${m} by ${payload.username}`);
            results.push({ file: orderFile, deleted: orders.length });
          }
        } catch (e) { /* skip */ }
      }
    }

    return res.status(200).json({
      success: true,
      message: `Deleted ${deletedCount} order(s)`,
      deletedCount,
      results
    });
  } catch (error) {
    console.error('Delete orders error:', error);
    return res.status(500).json({ error: 'Failed to delete orders: ' + error.message });
  }
}

// ─── REPORT DATA (admin) – raw data for client-side Excel/Word/PDF ───────────
async function handleReport(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden: admin only' });

    const month = req.query.month; // YYYY-MM optional
    const status = req.query.status;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    let orders = [];
    try {
      const orderFile = month ? getOrderFileByMonth(month) : getCurrentOrderFile();
      orders = JSON.parse(await getGitHubFile(orderFile));
    } catch { orders = []; }

    if (status) orders = orders.filter(o => o.status === status);
    if (startDate) {
      const s = new Date(startDate);
      orders = orders.filter(o => new Date(o.timestamp || o.createdAt) >= s);
    }
    if (endDate) {
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);
      orders = orders.filter(o => new Date(o.timestamp || o.createdAt) <= e);
    }

    orders.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const completed = orders.filter(o => o.status === 'completed' || o.status === 'confirmed');
    const totalRevenue = completed.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
    const byPayment = {};
    const byItem = {};
    completed.forEach(o => {
      byPayment[o.paymentMethod] = (byPayment[o.paymentMethod] || 0) + (o.totalPrice || 0);
      (o.items || []).forEach(it => {
        const key = `${it.name}${it.variant ? ' (' + it.variant + ')' : ''}`;
        if (!byItem[key]) byItem[key] = { qty: 0, revenue: 0 };
        byItem[key].qty += it.quantity || 1;
        byItem[key].revenue += (it.price || 0) * (it.quantity || 1);
      });
    });

    let expenses = [];
    try { expenses = JSON.parse(await getGitHubFile('data/analytics/expenses.json')); } catch { expenses = []; }
    if (month) {
      expenses = expenses.filter(e => (e.createdAt || '').startsWith(month));
    }
    const totalExpenses = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    return res.status(200).json({
      success: true,
      meta: {
        generatedAt: new Date().toISOString(),
        generatedBy: payload.username,
        shopName: 'TAN COFFEE',
        month: month || getCurrentOrderFile().match(/orders-(\d{4}-\d{2})/)?.[1],
        period: { startDate: startDate || null, endDate: endDate || null }
      },
      summary: {
        totalOrders: orders.length,
        completedOrders: completed.length,
        totalRevenue,
        totalExpenses,
        netProfit: totalRevenue - totalExpenses,
        byPayment,
        byItem
      },
      orders,
      expenses
    });
  } catch (error) {
    console.error('Report error:', error);
    return res.status(500).json({ error: 'Failed to generate report' });
  }
}



async function handleDeleteData(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden: admin only' });

    const { type, mode, orderId, startDate, endDate, month, staffId, username } = req.body || {};
    // type: 'orders' | 'expenses' | 'staff'
    if (!type || !['orders', 'expenses', 'staff', 'loyalty'].includes(type)) {
      return res.status(400).json({ error: 'type required: orders | expenses | staff | loyalty' });
    }

    if (type === 'orders') {
      // reuse existing logic via internal call pattern - inline
      if (!mode || !['one', 'range', 'month', 'all'].includes(mode)) {
        return res.status(400).json({ error: 'mode required for orders: one | range | month | all' });
      }
      let deletedCount = 0;
      const results = [];
      if (mode === 'one') {
        if (!orderId) return res.status(400).json({ error: 'orderId required' });
        const filesToTry = [getCurrentOrderFile()];
        if (month) filesToTry.unshift(getOrderFileByMonth(month));
        let found = false;
        for (const orderFile of filesToTry) {
          try {
            let orders = JSON.parse(await getGitHubFile(orderFile));
            const before = orders.length;
            orders = orders.filter(o => o.id !== orderId);
            if (orders.length < before) {
              await updateGitHubFile(orderFile, JSON.stringify(orders, null, 2), `Delete order ${orderId} by ${payload.username}`);
              deletedCount = before - orders.length;
              found = true;
              results.push({ file: orderFile, deleted: deletedCount });
              break;
            }
          } catch (e) {}
        }
        if (!found) return res.status(404).json({ error: 'Order not found' });
      } else if (mode === 'month') {
        if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month required as YYYY-MM' });
        const orderFile = getOrderFileByMonth(month);
        try {
          const orders = JSON.parse(await getGitHubFile(orderFile));
          deletedCount = orders.length;
          await updateGitHubFile(orderFile, '[]', `Clear all orders ${month} by ${payload.username}`);
          results.push({ file: orderFile, deleted: deletedCount });
        } catch {
          return res.status(404).json({ error: 'No order file for that month' });
        }
      } else if (mode === 'range') {
        if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        if (isNaN(start) || isNaN(end)) return res.status(400).json({ error: 'Invalid dates' });
        const months = new Set();
        const cursor = new Date(start);
        while (cursor <= end) {
          months.add(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
          cursor.setMonth(cursor.getMonth() + 1);
        }
        months.add(`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`);
        for (const m of months) {
          const orderFile = getOrderFileByMonth(m);
          try {
            let orders = JSON.parse(await getGitHubFile(orderFile));
            const before = orders.length;
            orders = orders.filter(o => {
              const t = new Date(o.timestamp || o.createdAt);
              return t < start || t > end;
            });
            const removed = before - orders.length;
            if (removed > 0) {
              await updateGitHubFile(orderFile, JSON.stringify(orders, null, 2), `Delete orders range by ${payload.username}`);
              deletedCount += removed;
              results.push({ file: orderFile, deleted: removed });
            }
          } catch (e) {}
        }
      } else if (mode === 'all') {
        const now = new Date();
        for (let i = 0; i < 12; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          const orderFile = getOrderFileByMonth(m);
          try {
            const orders = JSON.parse(await getGitHubFile(orderFile));
            if (orders.length > 0) {
              deletedCount += orders.length;
              await updateGitHubFile(orderFile, '[]', `Clear ALL orders ${m} by ${payload.username}`);
              results.push({ file: orderFile, deleted: orders.length });
            }
          } catch (e) {}
        }
      }
      return res.status(200).json({ success: true, type: 'orders', message: `Deleted ${deletedCount} order(s)`, deletedCount, results });
    }

    if (type === 'expenses') {
      let expenses = [];
      try { expenses = JSON.parse(await getGitHubFile('data/analytics/expenses.json')); } catch { expenses = []; }
      const before = expenses.length;
      if (mode === 'all' || !mode) {
        expenses = [];
      } else if (mode === 'range' && startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        expenses = expenses.filter(e => {
          const t = new Date(e.createdAt || e.date);
          return t < start || t > end;
        });
      } else if (mode === 'month' && month) {
        expenses = expenses.filter(e => !(String(e.createdAt || e.date || '').startsWith(month)));
      } else {
        return res.status(400).json({ error: 'For expenses use mode: all | range | month' });
      }
      const deletedCount = before - expenses.length;
      await updateGitHubFile('data/analytics/expenses.json', JSON.stringify(expenses, null, 2), `Delete expenses by ${payload.username}`);
      return res.status(200).json({ success: true, type: 'expenses', message: `Deleted ${deletedCount} expense(s)`, deletedCount });
    }

    if (type === 'staff') {
      let users = [];
      try { users = JSON.parse(await getGitHubFile('data/staff/users.json')); } catch { users = []; }
      const before = users.length;
      if (mode === 'one') {
        if (!staffId && !username) return res.status(400).json({ error: 'staffId or username required' });
        users = users.filter(u => {
          if (staffId && String(u.id) === String(staffId)) return false;
          if (username && u.username === username) return false;
          return true;
        });
        // never delete the last admin
        const adminsLeft = users.filter(u => u.role === 'admin' && u.status !== 'inactive');
        if (adminsLeft.length === 0) {
          return res.status(400).json({ error: 'Cannot delete the last admin account' });
        }
      } else if (mode === 'all_staff') {
        // keep only admins
        users = users.filter(u => u.role === 'admin');
      } else {
        return res.status(400).json({ error: 'For staff use mode: one | all_staff' });
      }
      const deletedCount = before - users.length;
      await updateGitHubFile('data/staff/users.json', JSON.stringify(users, null, 2), `Delete staff by ${payload.username}`);
      return res.status(200).json({ success: true, type: 'staff', message: `Deleted ${deletedCount} staff account(s)`, deletedCount });
    }

    return res.status(400).json({ error: 'Unknown type' });

    if (type === 'loyalty') {
      // mode: all | vouchers | members | codes | member_one | voucher_one
      const lmode = mode || 'all';
      const results = [];
      if (lmode === 'all' || lmode === 'vouchers') {
        await writeJsonFile('data/loyalty/vouchers.json', [], `Reset vouchers by ${payload.username}`);
        results.push({ file: 'vouchers', deleted: 'all' });
      }
      if (lmode === 'all' || lmode === 'codes') {
        await writeJsonFile('data/loyalty/codes.json', [], `Reset codes by ${payload.username}`);
        results.push({ file: 'codes', deleted: 'all' });
      }
      if (lmode === 'all' || lmode === 'members') {
        await writeJsonFile('data/loyalty/members.json', [], `Reset members/points by ${payload.username}`);
        results.push({ file: 'members', deleted: 'all' });
      }
      if (lmode === 'member_one') {
        const nameKey = normalizeMemberName(username || req.body?.name || '');
        if (!nameKey) return res.status(400).json({ error: 'name/username member wajib' });
        let members = await readJsonFile('data/loyalty/members.json', []);
        const before = members.length;
        members = members.filter(m => m.nameKey !== nameKey);
        if (members.length === before) return res.status(404).json({ error: 'Member tidak ditemukan' });
        await writeJsonFile('data/loyalty/members.json', members, `Delete member ${nameKey} by ${payload.username}`);
        results.push({ file: 'members', deleted: 1, nameKey });
      }
      if (lmode === 'voucher_one') {
        const vid = req.body?.voucherId || orderId;
        if (!vid) return res.status(400).json({ error: 'voucherId wajib' });
        let vouchers = await readJsonFile('data/loyalty/vouchers.json', []);
        const before = vouchers.length;
        vouchers = vouchers.filter(v => v.id !== vid);
        if (vouchers.length === before) return res.status(404).json({ error: 'Voucher tidak ditemukan' });
        await writeJsonFile('data/loyalty/vouchers.json', vouchers, `Delete voucher ${vid} by ${payload.username}`);
        results.push({ file: 'vouchers', deleted: 1, id: vid });
      }
      if (lmode === 'reset_points_one') {
        const nameKey = normalizeMemberName(username || req.body?.name || '');
        if (!nameKey) return res.status(400).json({ error: 'name member wajib' });
        let members = await readJsonFile('data/loyalty/members.json', []);
        const m = members.find(x => x.nameKey === nameKey);
        if (!m) return res.status(404).json({ error: 'Member tidak ditemukan' });
        m.points = 0;
        m.history = m.history || [];
        m.history.unshift({ type: 'reset', points: 0, at: new Date().toISOString(), by: payload.username });
        m.updatedAt = new Date().toISOString();
        await writeJsonFile('data/loyalty/members.json', members, `Reset points ${nameKey} by ${payload.username}`);
        results.push({ file: 'members', reset: nameKey });
      }
      return res.status(200).json({ success: true, message: 'Loyalty data updated', results });
    }

  } catch (error) {
    console.error('Delete data error:', error);
    return res.status(500).json({ error: 'Failed to delete data: ' + error.message });
  }
}



async function handleUpdateStaff(req, res) {
  if (req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const payload = getAuthPayload(req);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    const { id, username, name, password, role, status, avatar } = req.body;
    if (!id && !username) return res.status(400).json({ error: 'id or username required' });

    let users = [];
    try { users = JSON.parse(await getGitHubFile('data/staff/users.json')); } catch { users = []; }

    const index = users.findIndex(u =>
      (id != null && String(u.id) === String(id)) ||
      (username && u.username === username)
    );
    if (index === -1) return res.status(404).json({ error: 'Staff not found' });

    if (name != null && String(name).trim()) users[index].name = String(name).trim();
    if (role && ['staff', 'admin'].includes(role)) users[index].role = role;
    if (status && ['active', 'inactive'].includes(status)) users[index].status = status;
    if (password && String(password).length >= 3) users[index].passwordHash = hashPassword(password);
    if (avatar !== undefined) users[index].avatar = avatar; // base64 data URL or null
    users[index].updatedAt = new Date().toISOString();
    users[index].updatedBy = payload.username;

    await updateGitHubFile('data/staff/users.json', JSON.stringify(users, null, 2), `Update staff: ${users[index].username || users[index].name}`);

    return res.status(200).json({
      success: true,
      message: 'Staff updated',
      data: {
        id: users[index].id,
        name: users[index].name,
        username: users[index].username,
        role: users[index].role,
        status: users[index].status,
        avatar: users[index].avatar || null
      }
    });
  } catch (error) {
    console.error('Update staff error:', error);
    return res.status(500).json({ error: 'Failed to update staff' });
  }
}



// ─── LOYALTY / POINTS / VOUCHER ──────────────────────────────────────────────
function normalizeMemberName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function genVoucherId() {
  return 'VCH-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function genRedeemCode() {
  const part = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return 'TC-' + part() + part();
}

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await getGitHubFile(path));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(path, data, message) {
  await updateGitHubFile(path, JSON.stringify(data, null, 2), message);
}

async function awardPointForOrder(order) {
  if (!order || order.pointsAwarded) return null;
  const rawName = (order.customer && order.customer.name) || order.customerName || '';
  const nameKey = normalizeMemberName(rawName);
  if (!nameKey) return null;

  // 1 qty produk = 1 poin
  let earn = 0;
  (order.items || []).forEach(it => {
    const q = Number(it.quantity);
    earn += Number.isFinite(q) && q > 0 ? Math.floor(q) : 1;
  });
  if (earn < 1) earn = 1;

  const members = await readJsonFile('data/loyalty/members.json', []);
  let member = members.find(m => m.nameKey === nameKey);
  if (!member) {
    member = {
      name: String(rawName).trim(),
      nameKey,
      points: 0,
      history: [],
      createdAt: new Date().toISOString()
    };
    members.push(member);
  }
  member.points = (member.points || 0) + earn;
  member.history = member.history || [];
  member.history.unshift({
    type: 'earn',
    points: earn,
    orderId: order.id,
    at: new Date().toISOString()
  });
  if (member.history.length > 50) member.history = member.history.slice(0, 50);
  member.updatedAt = new Date().toISOString();
  await writeJsonFile('data/loyalty/members.json', members, `Award ${earn} point(s) to ${member.name} for ${order.id}`);
  return { ...member, lastEarned: earn };
}

async function handleLoyaltyMember(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const name = req.query.name || '';
    const nameKey = normalizeMemberName(name);
    if (!nameKey) return res.status(400).json({ error: 'Nama diperlukan' });
    const members = await readJsonFile('data/loyalty/members.json', []);
    const member = members.find(m => m.nameKey === nameKey);
    if (!member) {
      return res.status(200).json({
        success: true,
        data: { name: String(name).trim(), nameKey, points: 0, history: [], isNew: true }
      });
    }
    return res.status(200).json({ success: true, data: { ...member, isNew: false } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Gagal memuat data member' });
  }
}

async function handleLoyaltyMembers(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const payload = getAuthPayload(req);
    if (!payload || payload.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const members = await readJsonFile('data/loyalty/members.json', []);
    members.sort((a, b) => (b.points || 0) - (a.points || 0));
    return res.status(200).json({ success: true, data: members, count: members.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Gagal memuat members' });
  }
}

async function handleLoyaltyVouchers(req, res) {
  try {
    if (req.method === 'GET') {
      const vouchers = await readJsonFile('data/loyalty/vouchers.json', []);
      const payload = getAuthPayload(req);
      const isAdmin = payload && payload.role === 'admin';
      const list = isAdmin ? vouchers : vouchers.filter(v => v.active !== false);
      return res.status(200).json({ success: true, data: list });
    }

    if (req.method === 'POST') {
      const payload = getAuthPayload(req);
      if (!payload || payload.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const body = req.body || {};
      const title = String(body.title || '').trim();
      const type = body.type;
      const pointsCost = Number(body.pointsCost);
      if (!title || !['discount_nominal', 'free_item'].includes(type)) {
        return res.status(400).json({ error: 'Judul dan tipe voucher wajib (discount_nominal / free_item)' });
      }
      if (!Number.isFinite(pointsCost) || pointsCost < 1) {
        return res.status(400).json({ error: 'Biaya poin minimal 1' });
      }
      const voucher = {
        id: genVoucherId(),
        title,
        type,
        pointsCost,
        discountValue: type === 'discount_nominal' ? Math.max(0, Number(body.discountValue) || 0) : 0,
        freeItemName: type === 'free_item' ? String(body.freeItemName || '').trim() : '',
        freeItemId: type === 'free_item' ? (body.freeItemId || null) : null,
        active: body.active !== false,
        stock: body.stock == null || body.stock === '' ? null : Number(body.stock),
        createdAt: new Date().toISOString(),
        createdBy: payload.username
      };
      if (type === 'discount_nominal' && voucher.discountValue <= 0) {
        return res.status(400).json({ error: 'Nilai diskon harus > 0' });
      }
      if (type === 'free_item' && !voucher.freeItemName) {
        return res.status(400).json({ error: 'Nama menu gratis wajib diisi' });
      }
      const vouchers = await readJsonFile('data/loyalty/vouchers.json', []);
      vouchers.unshift(voucher);
      await writeJsonFile('data/loyalty/vouchers.json', vouchers, `Add voucher ${voucher.id}`);
      return res.status(201).json({ success: true, data: voucher });
    }

    if (req.method === 'PATCH') {
      const payload = getAuthPayload(req);
      if (!payload || payload.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { id, active, title, pointsCost, discountValue, freeItemName, stock, delete: delFlag } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID voucher wajib' });
      let vouchers = await readJsonFile('data/loyalty/vouchers.json', []);
      const idx = vouchers.findIndex(v => v.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Voucher tidak ditemukan' });
      if (delFlag === true) {
        const removed = vouchers[idx];
        vouchers.splice(idx, 1);
        await writeJsonFile('data/loyalty/vouchers.json', vouchers, `Delete voucher ${id}`);
        return res.status(200).json({ success: true, deleted: removed });
      }
      if (active !== undefined) vouchers[idx].active = !!active;
      if (title) vouchers[idx].title = String(title).trim();
      if (pointsCost != null && Number(pointsCost) >= 1) vouchers[idx].pointsCost = Number(pointsCost);
      if (discountValue != null) vouchers[idx].discountValue = Number(discountValue);
      if (freeItemName != null) vouchers[idx].freeItemName = String(freeItemName).trim();
      if (stock !== undefined) vouchers[idx].stock = stock === null || stock === '' ? null : Number(stock);
      vouchers[idx].updatedAt = new Date().toISOString();
      await writeJsonFile('data/loyalty/vouchers.json', vouchers, `Update voucher ${id}`);
      return res.status(200).json({ success: true, data: vouchers[idx] });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Gagal memproses voucher' });
  }
}

async function handleLoyaltyRedeem(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { name, voucherId } = req.body || {};
    const nameKey = normalizeMemberName(name);
    if (!nameKey || !voucherId) return res.status(400).json({ error: 'Nama dan voucherId wajib' });

    const members = await readJsonFile('data/loyalty/members.json', []);
    const member = members.find(m => m.nameKey === nameKey);
    if (!member) return res.status(404).json({ error: 'Member belum punya poin. Selesaikan pesanan dulu.' });

    const vouchers = await readJsonFile('data/loyalty/vouchers.json', []);
    const voucher = vouchers.find(v => v.id === voucherId);
    if (!voucher || voucher.active === false) return res.status(404).json({ error: 'Voucher tidak tersedia' });
    if (voucher.stock != null && voucher.stock <= 0) return res.status(400).json({ error: 'Stok voucher habis' });
    if ((member.points || 0) < voucher.pointsCost) {
      return res.status(400).json({ error: `Poin tidak cukup. Butuh ${voucher.pointsCost}, punya ${member.points || 0}` });
    }

    member.points -= voucher.pointsCost;
    member.history = member.history || [];
    const code = genRedeemCode();
    member.history.unshift({
      type: 'redeem',
      points: -voucher.pointsCost,
      voucherId: voucher.id,
      code,
      at: new Date().toISOString()
    });
    if (member.history.length > 50) member.history = member.history.slice(0, 50);
    member.updatedAt = new Date().toISOString();

    if (voucher.stock != null) voucher.stock = Math.max(0, Number(voucher.stock) - 1);

    const codes = await readJsonFile('data/loyalty/codes.json', []);
    const entry = {
      code,
      voucherId: voucher.id,
      voucherTitle: voucher.title,
      type: voucher.type,
      discountValue: voucher.discountValue || 0,
      freeItemName: voucher.freeItemName || '',
      memberName: member.name,
      nameKey,
      status: 'unused',
      createdAt: new Date().toISOString()
    };
    codes.unshift(entry);

    await writeJsonFile('data/loyalty/members.json', members, `Redeem ${code} by ${member.name}`);
    await writeJsonFile('data/loyalty/vouchers.json', vouchers, `Stock update ${voucher.id}`);
    await writeJsonFile('data/loyalty/codes.json', codes, `New code ${code}`);

    return res.status(200).json({
      success: true,
      data: {
        code,
        pointsLeft: member.points,
        voucher: {
          title: voucher.title,
          type: voucher.type,
          discountValue: voucher.discountValue || 0,
          freeItemName: voucher.freeItemName || ''
        }
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Gagal redeem voucher' });
  }
}

async function handleLoyaltyValidate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const code = String((req.body || {}).code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Kode voucher wajib' });
    const codes = await readJsonFile('data/loyalty/codes.json', []);
    const entry = codes.find(c => String(c.code).toUpperCase() === code);
    if (!entry) return res.status(404).json({ error: 'Kode tidak valid' });
    if (entry.status === 'used') return res.status(400).json({ error: 'Kode sudah dipakai' });
    return res.status(200).json({
      success: true,
      data: {
        code: entry.code,
        title: entry.voucherTitle,
        type: entry.type,
        discountValue: entry.discountValue || 0,
        freeItemName: entry.freeItemName || '',
        memberName: entry.memberName
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Gagal validasi kode' });
  }
}

async function markVoucherCodeUsed(code, orderId) {
  if (!code) return null;
  const codes = await readJsonFile('data/loyalty/codes.json', []);
  const idx = codes.findIndex(c => String(c.code).toUpperCase() === String(code).toUpperCase());
  if (idx === -1) return null;
  if (codes[idx].status === 'used') return null;
  codes[idx].status = 'used';
  codes[idx].usedAt = new Date().toISOString();
  codes[idx].usedOnOrderId = orderId;
  await writeJsonFile('data/loyalty/codes.json', codes, `Use code ${code} on ${orderId}`);
  return codes[idx];
}


// ─── MAIN ROUTER ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname.replace(/^\/api/, '');

  // forward query string params onto req.query
  req.query = Object.fromEntries(url.searchParams.entries());

  switch (pathname) {
    case '/login':         return handleLogin(req, res);
    case '/list':          return handleList(req, res);
    case '/create':        return handleCreate(req, res);
    case '/pending':       return handlePending(req, res);
    case '/orders':        return handleOrders(req, res);
    case '/update-status': return handleUpdateStatus(req, res);
    case '/summary':       return handleSummary(req, res);
    case '/expenses':      return handleExpenses(req, res);
    case '/add-expense':   return handleAddExpense(req, res);
    case '/add-menu':      return handleAddMenu(req, res);
    case '/update-menu':   return handleUpdateMenu(req, res);
    case '/staff':         return handleStaffList(req, res);
    case '/add-staff':     return handleAddStaff(req, res);
    case '/update-staff':  return handleUpdateStaff(req, res);
    case '/delete-orders': return handleDeleteOrders(req, res);
    case '/delete-data':   return handleDeleteData(req, res);
    case '/report':        return handleReport(req, res);
    case '/loyalty/member':   return handleLoyaltyMember(req, res);
    case '/loyalty/members':  return handleLoyaltyMembers(req, res);
    case '/loyalty/vouchers': return handleLoyaltyVouchers(req, res);
    case '/loyalty/redeem':   return handleLoyaltyRedeem(req, res);
    case '/loyalty/validate': return handleLoyaltyValidate(req, res);
    default:               return res.status(404).json({ error: 'Not found' });
  }
}
