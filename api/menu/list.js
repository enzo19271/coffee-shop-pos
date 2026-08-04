import { getGitHubFile } from '../utils/github.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const menuData = await getGitHubFile('data/menu/items.json');
    const items = JSON.parse(menuData);

    return res.status(200).json({
      success: true,
      data: items
    });
  } catch (error) {
    console.error('Menu list error:', error);
    return res.status(500).json({ error: 'Failed to fetch menu' });
  }
}
