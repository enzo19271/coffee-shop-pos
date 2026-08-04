import { getGitHubFile, updateGitHubFile } from '../utils/github.js';

function generateOrderId() {
  const now = new Date();
  const timestamp = now.getTime().toString(36).toUpperCase();
  const random = Math.random().toString(36).substr(2, 5).toUpperCase();
  return `ORD-${timestamp}-${random}`;
}

function getCurrentOrderFile() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `data/orders/orders-${year}-${month}.json`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { customerName, tableNo, items, paymentMethod, paymentProof, notes } = req.body;

    // Validation
    if (!customerName || !tableNo || !items || items.length === 0 || !paymentMethod) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (paymentMethod !== 'cash' && !paymentProof) {
      return res.status(400).json({ error: 'Payment proof required for this payment method' });
    }

    // Calculate total
    let totalPrice = 0;
    items.forEach(item => {
      totalPrice += item.price * item.quantity;
    });

    // Create order object
    const orderId = generateOrderId();
    const orderFile = getCurrentOrderFile();

    const newOrder = {
      id: orderId,
      timestamp: new Date().toISOString(),
      customer: {
        name: customerName,
        tableNo: tableNo
      },
      items: items,
      totalPrice: totalPrice,
      paymentMethod: paymentMethod,
      paymentProof: paymentProof || null, // base64 encoded
      notes: notes || '',
      status: paymentMethod === 'cash' ? 'pending' : 'pending_verification',
      createdAt: new Date().toISOString()
    };

    // Fetch current orders
    let orders = [];
    try {
      const ordersData = await getGitHubFile(orderFile);
      orders = JSON.parse(ordersData);
    } catch (error) {
      // File might not exist yet, start with empty array
      orders = [];
    }

    // Add new order
    orders.push(newOrder);

    // Update GitHub
    await updateGitHubFile(
      orderFile,
      JSON.stringify(orders, null, 2),
      `Add order ${orderId}`
    );

    return res.status(201).json({
      success: true,
      orderId: orderId,
      message: 'Order created successfully',
      order: newOrder
    });
  } catch (error) {
    console.error('Order creation error:', error);
    return res.status(500).json({ error: 'Failed to create order' });
  }
}
