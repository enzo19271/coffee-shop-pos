// Simple JWT implementation (untuk production gunakan jsonwebtoken package)
import crypto from 'crypto';

function generateToken(payload) {
  const secret = process.env.JWT_SECRET || 'default-secret-key';
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyToken(token) {
  try {
    const secret = process.env.JWT_SECRET || 'default-secret-key';
    const parts = token.split('.');

    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    if (signature !== expectedSignature) {
      throw new Error('Invalid signature');
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('Token expired');
    }

    return payload;
  } catch (error) {
    return null;
  }
}

function simplePasswordVerify(inputPassword, storedHash) {
  // For testing purposes, kita gunakan simple string comparison
  // Password sebenarnya: "password" untuk staff, "admin" untuk admin
  const staffPassword = 'password';
  const adminPassword = 'admin';

  if (storedHash.includes('staff') && inputPassword === staffPassword) {
    return true;
  }
  if (storedHash.includes('admin') && inputPassword === adminPassword) {
    return true;
  }
  return false;
}

export { generateToken, verifyToken, simplePasswordVerify };
