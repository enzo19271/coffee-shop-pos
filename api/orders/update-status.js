import { getGitHubFile, updateGitHubFile } from '../utils/github.js';
import { verifyToken } from '../utils/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
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

    // Only staff and admin can update
    if (payload.role !== 'staff' && payload.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { orderId, status } = req.body;

    if (!orderId || !status) {
      return res.status(400).json({ error: 'Order ID and status required' });
    }

    const validStatuses = ['pending', 'pending_verification', 'confirmed', 'completed', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Get current month orders
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const orderFile = `data/orders/orders-${year}-${month}.json`;

    const ordersData = await getGitHubFile(orderFile);
    let orders = JSON.parse(ordersData);

    // Find and update order
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex === -1) {
      return res.status(404).json({ error: 'Order not found' });
    }

    orders[orderIndex].status = status;
    orders[orderIndex].updatedAt = new Date().toISOString();
    orders[orderIndex].updatedBy = payload.username;

    // Save updated orders
    await updateGitHubFile(
      orderFile,
      JSON.stringify(orders, null, 2),
      `Update order ${orderId} status to ${status}`
    );

    return res.status(200).json({
      success: true,
      message: 'Order status updated',
      order: orders[orderIndex]
    });
  } catch (error) {
    console.error('Update order status error:', error);
    return res.status(500).json({ error: 'Failed to update order' });
  }
}
