const crypto = require('node:crypto');

function generateSessionId(randomBytesImpl = crypto.randomBytes) {
  const bytes = randomBytesImpl(32);
  if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
    throw new Error('Session randomness source returned an invalid result.');
  }
  return bytes.toString('base64url');
}

function hashToken(value) {
  if (typeof value !== 'string' || !value) {
    throw new TypeError('Token is required');
  }
  return crypto.createHash('sha256').update(value, 'utf8').digest('base64url');
}

module.exports = { generateSessionId, hashToken };
