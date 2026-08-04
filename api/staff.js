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

    let users = [];
    try {
      const usersData = await getGitHubFile('data/staff/users.json');
      users = JSON.parse(usersData);
    } catch (error) {
      users = [];
    }

    // Never expose password hashes
    const safeUsers = users.map(({ passwordHash, ...rest }) => rest);

    return res.status(200).json({
      success: true,
      data: safeUsers
    });
  } catch (error) {
    console.error('Staff list error:', error);
    return res.status(500).json({ error: 'Failed to fetch staff' });
  }
}

