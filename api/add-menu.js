import { getGitHubFile, updateGitHubFile } from './github.js';
import { verifyToken } from './auth.js';

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
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (payload.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { name, category, price, image, description, variants } = req.body;

    if (!name || !category || !price || price <= 0 || !image) {
      return res.status(400).json({ error: 'Name, category, price, and image are required' });
    }

    let items = [];
    try {
      const menuData = await getGitHubFile('data/menu/items.json');
      items = JSON.parse(menuData);
    } catch (error) {
      items = [];
    }

    const nextId = items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1;

    const newItem = {
      id: nextId,
      name,
      category,
      price,
      description: description || '',
      image,
      variants: Array.isArray(variants) ? variants : []
    };

    items.push(newItem);

    await updateGitHubFile(
      'data/menu/items.json',
      JSON.stringify(items, null, 2),
      `Add menu item: ${name}`
    );

    return res.status(201).json({
      success: true,
      message: 'Menu item added',
      data: newItem
    });
  } catch (error) {
    console.error('Add menu error:', error);
    return res.status(500).json({ error: 'Failed to add menu item' });
  }
}

