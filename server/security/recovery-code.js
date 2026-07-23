const crypto = require('node:crypto');

const RECOVERY_CODE_BYTES = 24;
const HASH_BYTES = 32;

function recoveryCodeError() {
  return Object.assign(new Error('Recovery code format is invalid.'), {
    code: 'INPUT_INVALID',
  });
}

function normalizeRecoveryCode(value) {
  if (typeof value !== 'string') throw recoveryCodeError();
  const normalized = value.replace(/[-\s]/g, '').toUpperCase();
  if (!/^[0-9A-F]{48}$/.test(normalized)) throw recoveryCodeError();
  return normalized;
}

function generateRecoveryCode(randomBytesImpl = crypto.randomBytes) {
  const bytes = randomBytesImpl(RECOVERY_CODE_BYTES);
  if (!Buffer.isBuffer(bytes) || bytes.length !== RECOVERY_CODE_BYTES) {
    throw new Error('Recovery code randomness source returned an invalid result.');
  }
  return bytes.toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
}

function hashRecoveryCode(value) {
  return crypto
    .createHash('sha256')
    .update(normalizeRecoveryCode(value), 'ascii')
    .digest('base64url');
}

function decodeStoredHash(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const buffer = Buffer.from(value, 'base64url');
  if (buffer.length !== HASH_BYTES || buffer.toString('base64url') !== value) return null;
  return buffer;
}

function verifyRecoveryCode(value, storedHash) {
  try {
    const expected = decodeStoredHash(storedHash);
    if (!expected) return false;
    const actual = Buffer.from(hashRecoveryCode(value), 'base64url');
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

module.exports = {
  RECOVERY_CODE_BYTES,
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyRecoveryCode,
};
