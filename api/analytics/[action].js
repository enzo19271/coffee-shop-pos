import { getGitHubFile, updateGitHubFile } from '../github.js';
import { verifyToken } from '../auth.js';

export default async function handler(req, res) {
  const action = req.query.action;

  try {
    // All analytics actions require authentication
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Only staff and admin can access analytics
    if (payload.role !== 'staff' && payload.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // LIST action - GET expenses
    if (action === 'expenses') {
      if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
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
    }

    // ADD action - POST new expense
    if (action === 'add') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      const { category, amount, description, date } = req.body;

      if (!category || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Category and valid amount required' });
      }

      const expense = {
        id: `EXP-${Date.now()}`,
        category: category,
        amount: amount,
        description: description || '',
        date: date || new Date().toISOString().split('T')[0],
        recordedBy: payload.username,
        createdAt: new Date().toISOString()
      };

      // Get expenses
      let expenses = [];
      try {
        const expensesData = await getGitHubFile('data/analytics/expenses.json');
        expenses = JSON.parse(expensesData);
      } catch (error) {
        expenses = [];
      }

      // Add new expense
      expenses.push(expense);

      // Save to GitHub
      await updateGitHubFile(
        'data/analytics/expenses.json',
        JSON.stringify(expenses, null, 2),
        `Add expense: ${category} - ${amount}`
      );

      return res.status(201).json({
        success: true,
        message: 'Expense recorded',
        expense: expense
      });
    }

    // Invalid action
    return res.status(404).json({ error: 'Action not found' });

  } catch (error) {
    console.error('Analytics handler error:', error);
    return res.status(500).json({ error: 'Failed to process analytics request' });
  }
}
