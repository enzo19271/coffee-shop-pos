import { getGitHubFile } from './github.js';
import { verifyToken } from './auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // month format: YYYY-MM, defaults to current month
    const month = req.query.month || (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    })();

    const orderFile = `data/orders/orders-${month}.json`;

    let orders = [];
    try {
      const ordersData = await getGitHubFile(orderFile);
      orders = JSON.parse(ordersData);
    } catch (error) {
      orders = [];
    }

    // Optional status filter
    const status = req.query.status;
    if (status) {
      orders = orders.filter(o => o.status === status);
    }

    // Newest first
    orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.status(200).json({
      success: true,
      data: orders,
      count: orders.length
    });
  } catch (error) {
    console.error('Orders history error:', error);
    return res.status(500).json({ error: 'Failed to fetch orders' });
  }
}
