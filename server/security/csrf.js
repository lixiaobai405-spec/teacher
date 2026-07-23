const crypto = require('node:crypto');

const { httpProblem } = require('../http/problem.js');
const { hashToken } = require('./token-hash.js');

const PRE_AUTH_MAX_AGE_MS = 10 * 60 * 1000;

function csrfError() {
  return httpProblem('AUTH_CSRF_INVALID', '请求验证失败，请刷新后重试。', 403);
}

function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value, 'utf8').digest();
}

function decodeCanonical(value, bytes) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const buffer = Buffer.from(value, 'base64url');
  if (buffer.length !== bytes || buffer.toString('base64url') !== value) return null;
  return buffer;
}

function safeEqualText(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createPreAuthCsrfToken(secret, {
  now = Date.now,
  randomBytesImpl = crypto.randomBytes,
} = {}) {
  const randomBytes = randomBytesImpl(16);
  if (!Buffer.isBuffer(randomBytes) || randomBytes.length !== 16) {
    throw new Error('CSRF randomness source returned an invalid result.');
  }
  const issuedAt = Math.floor(now() / 1000).toString(36);
  const nonce = randomBytes.toString('base64url');
  const payload = `${issuedAt}.${nonce}`;
  const signature = hmac(secret, `preauth:${payload}`).toString('base64url');
  return `${payload}.${signature}`;
}

function verifyPreAuthCsrfToken(token, secret, { now = Date.now } = {}) {
  if (typeof token !== 'string') return false;
  const fields = token.split('.');
  if (fields.length !== 3) return false;
  const [issuedAtText, nonce, signatureText] = fields;
  if (!/^[0-9a-z]+$/.test(issuedAtText) || !decodeCanonical(nonce, 16)) return false;

  const issuedAt = Number.parseInt(issuedAtText, 36) * 1000;
  const age = now() - issuedAt;
  if (!Number.isFinite(issuedAt) || age < 0 || age > PRE_AUTH_MAX_AGE_MS) return false;

  const signature = decodeCanonical(signatureText, 32);
  if (!signature) return false;
  const expected = hmac(secret, `preauth:${issuedAtText}.${nonce}`);
  return crypto.timingSafeEqual(signature, expected);
}

function createSessionCsrfToken(secret, sessionId) {
  return hmac(secret, `csrf:${sessionId}`).toString('base64url');
}

function createSessionCsrfTokenHash(secret, sessionId) {
  return hashToken(createSessionCsrfToken(secret, sessionId));
}

function requirePreAuthCsrf({ secret, now = Date.now }) {
  return (request, _response, next) => {
    const token = request.get('x-csrf-token');
    if (!verifyPreAuthCsrfToken(token, secret, { now })) return next(csrfError());
    next();
  };
}

function requireSessionCsrf({ secret, sessionRepository }) {
  return async (request, _response, next) => {
    try {
      const sessionId = request.sessionID;
      if (!sessionId || !request.session?.userId) return next(csrfError());
      const expectedToken = createSessionCsrfToken(secret, sessionId);
      if (!safeEqualText(request.get('x-csrf-token'), expectedToken)) {
        return next(csrfError());
      }

      const stored = await sessionRepository.findByToken(sessionId);
      if (
        !stored
        || stored.userId !== request.session.userId
        || !safeEqualText(stored.csrfTokenHash, hashToken(expectedToken))
      ) {
        return next(csrfError());
      }
      next();
    } catch {
      next(csrfError());
    }
  };
}

module.exports = {
  PRE_AUTH_MAX_AGE_MS,
  createPreAuthCsrfToken,
  createSessionCsrfToken,
  createSessionCsrfTokenHash,
  requirePreAuthCsrf,
  requireSessionCsrf,
  verifyPreAuthCsrfToken,
};
