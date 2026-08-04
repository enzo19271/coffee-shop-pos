import { getGitHubFile } from '../utils/github.js';
import { verifyToken } from '../utils/auth.js';

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

    const period = req.query.period || 'today'; // today, thisMonth, allTime

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

    let expenses = [];
    try {
      const expensesData = await getGitHubFile('data/analytics/expenses.json');
      expenses = JSON.parse(expensesData);
    } catch (error) {
      expenses = [];
    }

    // Filter based on period
    const today = new Date().toISOString().split('T')[0];
    let filteredOrders = orders;
    let filteredExpenses = expenses;

    if (period === 'today') {
      filteredOrders = orders.filter(o => o.timestamp.startsWith(today));
      filteredExpenses = expenses.filter(e => e.date === today);
    } else if (period === 'thisMonth') {
      // Already filtered by file name (current month)
    }

    // Calculate metrics
    const completedOrders = filteredOrders.filter(o => o.status === 'completed');
    const totalRevenue = completedOrders.reduce((sum, o) => sum + o.totalPrice, 0);
    const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
    const netProfit = totalRevenue - totalExpenses;

    const analytics = {
      period: period,
      totalOrders: filteredOrders.length,
      completedOrders: completedOrders.length,
      totalRevenue: totalRevenue,
      totalExpenses: totalExpenses,
      netProfit: netProfit,
      averageOrderValue: completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0
    };

    return res.status(200).json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Analytics summary error:', error);
    return res.status(500).json({ error: 'Failed to fetch analytics' });
  }
}
