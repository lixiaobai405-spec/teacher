const crypto = require('node:crypto');

const { createSemaphore } = require('./semaphore.js');

const SCRYPT_OPTIONS = Object.freeze({
  N: 32768,
  r: 8,
  p: 3,
  maxmem: 128 * 1024 * 1024,
});
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const ENCODED_PATTERN = /^scrypt\$v=1\$N=32768\$r=8\$p=3\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

function passwordError() {
  return Object.assign(
    new Error('Password must contain at least 6 Unicode characters and differ from the username.'),
    { code: 'INPUT_INVALID' },
  );
}

function validatePassword(value, normalizedUsername) {
  if (typeof value !== 'string') throw passwordError();
  if (Array.from(value).length < 6) throw passwordError();
  if (typeof normalizedUsername === 'string' && value === normalizedUsername) {
    throw passwordError();
  }
  return value;
}

function decodeCanonicalBase64url(value, expectedLength) {
  const buffer = Buffer.from(value, 'base64url');
  if (buffer.length !== expectedLength || buffer.toString('base64url') !== value) return null;
  return buffer;
}

function createPasswordService({
  concurrency = 2,
  randomBytesImpl = crypto.randomBytes,
  scryptImpl = crypto.scrypt,
  timingSafeEqualImpl = crypto.timingSafeEqual,
} = {}) {
  const semaphore = createSemaphore(concurrency);

  function derive(password, salt) {
    return semaphore.run(() => new Promise((resolve, reject) => {
      scryptImpl(password, salt, KEY_BYTES, SCRYPT_OPTIONS, (error, derivedKey) => {
        if (error) return reject(error);
        resolve(Buffer.from(derivedKey));
      });
    }));
  }

  return Object.freeze({
    async hashPassword(password) {
      const salt = randomBytesImpl(SALT_BYTES);
      const derivedKey = await derive(password, salt);
      return [
        'scrypt',
        'v=1',
        `N=${SCRYPT_OPTIONS.N}`,
        `r=${SCRYPT_OPTIONS.r}`,
        `p=${SCRYPT_OPTIONS.p}`,
        salt.toString('base64url'),
        derivedKey.toString('base64url'),
      ].join('$');
    },

    async verifyPassword(password, encoded) {
      if (typeof password !== 'string' || typeof encoded !== 'string') return false;
      const match = ENCODED_PATTERN.exec(encoded);
      if (!match) return false;
      const salt = decodeCanonicalBase64url(match[1], SALT_BYTES);
      const expected = decodeCanonicalBase64url(match[2], KEY_BYTES);
      if (!salt || !expected) return false;

      try {
        const actual = await derive(password, salt);
        return actual.length === expected.length && timingSafeEqualImpl(actual, expected);
      } catch {
        return false;
      }
    },
  });
}

const defaultService = createPasswordService();

module.exports = {
  KEY_BYTES,
  SALT_BYTES,
  SCRYPT_OPTIONS,
  createPasswordService,
  hashPassword: defaultService.hashPassword,
  validatePassword,
  verifyPassword: defaultService.verifyPassword,
};
