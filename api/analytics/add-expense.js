import { getGitHubFile, updateGitHubFile } from '../utils/github.js';
import { verifyToken } from '../utils/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
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

    // Only staff and admin can add expenses
    if (payload.role !== 'staff' && payload.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
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
  } catch (error) {
    console.error('Add expense error:', error);
    return res.status(500).json({ error: 'Failed to add expense' });
  }
}
