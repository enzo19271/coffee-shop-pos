import { getGitHubFile } from './github.js';
import { verifyToken } from './auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify JWT token
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Only staff and admin can view
    if (payload.role !== 'staff' && payload.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Get current month orders
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const orderFile = `data/orders/orders-${year}-${month}.json`;

    let orders = [];
    try {
      const ordersData = await getGitHubFile(orderFile);
      orders = JSON.parse(ordersData);
    } catch (error) {
      orders = [];
    }

    // Filter pending orders (not completed)
    const pendingOrders = orders.filter(order =>
      ['pending', 'pending_verification', 'confirmed'].includes(order.status)
    );

    // Sort by newest first
    pendingOrders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.status(200).json({
      success: true,
      data: pendingOrders,
      count: pendingOrders.length
    });
  } catch (error) {
    console.error('Pending orders error:', error);
    return res.status(500).json({ error: 'Failed to fetch pending orders' });
  }
}
