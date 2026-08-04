import { getGitHubFile } from '../utils/github.js';
import { generateToken, simplePasswordVerify } from '../utils/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Fetch staff data from GitHub
    const staffData = await getGitHubFile('data/staff/users.json');
    const users = JSON.parse(staffData);

    // Find user
    const user = users.find(u => u.username === username);

    if (!user || !simplePasswordVerify(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status !== 'active') {
      return res.status(401).json({ error: 'User account is inactive' });
    }

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      exp: Math.floor(Date.now() / 1000) + 86400 // 24 hours
    });

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
