import { getGitHubFile, updateGitHubFile } from './github.js';
import { verifyToken, hashPassword } from './auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
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

    const { username, password, name, role } = req.body;

    if (!username || !password || !name || !role) {
      return res.status(400).json({ error: 'Username, password, name, and role are required' });
    }

    if (!['staff', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be staff or admin' });
    }

    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    let users = [];
    try {
      const usersData = await getGitHubFile('data/staff/users.json');
      users = JSON.parse(usersData);
    } catch (error) {
      users = [];
    }

    if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const newUser = {
      id: `${role}_${Date.now()}`,
      username,
      passwordHash: hashPassword(password),
      role,
      name,
      status: 'active',
      createdAt: new Date().toISOString()
    };

    users.push(newUser);

    await updateGitHubFile(
      'data/staff/users.json',
      JSON.stringify(users, null, 2),
      `Add staff: ${username}`
    );

    const { passwordHash, ...safeUser } = newUser;

    return res.status(201).json({
      success: true,
      message: 'Staff added',
      data: safeUser
    });
  } catch (error) {
    console.error('Add staff error:', error);
    return res.status(500).json({ error: 'Failed to add staff' });
  }
}
