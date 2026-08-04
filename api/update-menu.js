import { getGitHubFile, updateGitHubFile } from './github.js';
import { verifyToken } from './auth.js';

function authorize(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'admin') return null;
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== 'PUT' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = authorize(req);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const menuId = parseInt(req.query.id || req.body?.id);
    if (!menuId) {
      return res.status(400).json({ error: 'Menu id is required' });
    }

    let items = [];
    try {
      const menuData = await getGitHubFile('data/menu/items.json');
      items = JSON.parse(menuData);
    } catch (error) {
      items = [];
    }

    const index = items.findIndex(i => i.id === menuId);
    if (index === -1) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    if (req.method === 'DELETE') {
      const removed = items.splice(index, 1)[0];

      await updateGitHubFile(
        'data/menu/items.json',
        JSON.stringify(items, null, 2),
        `Delete menu item: ${removed.name}`
      );

      return res.status(200).json({ success: true, message: 'Menu item deleted' });
    }

    // PUT: update fields
    const { name, category, price, image, description, variants } = req.body;

    items[index] = {
      ...items[index],
      name: name ?? items[index].name,
      category: category ?? items[index].category,
      price: price ?? items[index].price,
      image: image ?? items[index].image,
      description: description ?? items[index].description,
      variants: Array.isArray(variants) ? variants : items[index].variants || []
    };

    await updateGitHubFile(
      'data/menu/items.json',
      JSON.stringify(items, null, 2),
      `Update menu item: ${items[index].name}`
    );

    return res.status(200).json({ success: true, data: items[index] });
  } catch (error) {
    console.error('Update/delete menu error:', error);
    return res.status(500).json({ error: 'Failed to update menu item' });
  }
}

