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

    if (payload.role !== 'staff' && payload.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const period = req.query.period || 'today'; // today, all

    let expenses = [];
    try {
      const expensesData = await getGitHubFile('data/analytics/expenses.json');
      expenses = JSON.parse(expensesData);
    } catch (error) {
      expenses = [];
    }

    if (period === 'today') {
      const today = new Date().toISOString().split('T')[0];
      expenses = expenses.filter(e => e.date === today);
    }

    // Newest first
    expenses.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({
      success: true,
      data: expenses
    });
  } catch (error) {
    console.error('Expenses list error:', error);
    return res.status(500).json({ error: 'Failed to fetch expenses' });
  }
}

