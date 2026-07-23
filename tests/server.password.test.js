const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  createPasswordService,
  hashPassword,
  validatePassword,
  verifyPassword,
} = require('../server/security/password.js');

test('password validation counts Unicode characters, has no maximum, and differs from username', () => {
  assert.equal(validatePassword('六位密码ab', 'User'), '六位密码ab');
  assert.equal(validatePassword('😀'.repeat(6), 'User'), '😀'.repeat(6));
  assert.equal(validatePassword('x'.repeat(10_000), 'User'), 'x'.repeat(10_000));

  for (const value of ['12345', '😀'.repeat(5), null]) {
    assert.throws(
      () => validatePassword(value, 'User'),
      (error) => error?.code === 'INPUT_INVALID',
    );
  }
  assert.throws(
    () => validatePassword('User', 'User'),
    (error) => error?.code === 'INPUT_INVALID',
  );
});

test('password hashes use the fixed scrypt format and verify correct and incorrect passwords', async () => {
  const encoded = await hashPassword('正确密码1');
  const fields = encoded.split('$');

  assert.deepEqual(fields.slice(0, 5), ['scrypt', 'v=1', 'N=32768', 'r=8', 'p=3']);
  assert.equal(Buffer.from(fields[5], 'base64url').length, 16);
  assert.equal(Buffer.from(fields[6], 'base64url').length, 64);
  assert.equal(await verifyPassword('正确密码1', encoded), true);
  assert.equal(await verifyPassword('错误密码1', encoded), false);
});

test('valid hashes use timingSafeEqual while malformed encodings fail safely', async () => {
  let comparisons = 0;
  const service = createPasswordService({
    timingSafeEqualImpl(left, right) {
      comparisons += 1;
      return crypto.timingSafeEqual(left, right);
    },
  });
  const encoded = await service.hashPassword('正确密码1');

  assert.equal(await service.verifyPassword('正确密码1', encoded), true);
  assert.equal(comparisons, 1);
  for (const damaged of [
    '',
    'scrypt$v=2$N=32768$r=8$p=3$bad$bad',
    'scrypt$v=1$N=1$r=8$p=3$bad$bad',
    `${encoded}junk`,
    null,
  ]) {
    assert.equal(await service.verifyPassword('正确密码1', damaged), false);
  }
});

test('password hashing executes no more than two scrypt operations concurrently', async () => {
  let active = 0;
  let maximumActive = 0;
  const fakeScrypt = (password, salt, keyLength, options, callback) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    setTimeout(() => {
      active -= 1;
      callback(null, Buffer.alloc(keyLength, 7));
    }, 10);
  };
  const service = createPasswordService({ scryptImpl: fakeScrypt, concurrency: 2 });

  await Promise.all(Array.from(
    { length: 6 },
    (_, index) => service.hashPassword(`password-${index}-long-enough`),
  ));

  assert.equal(maximumActive, 2);
});
