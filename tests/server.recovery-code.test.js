const assert = require('node:assert/strict');
const test = require('node:test');

const {
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyRecoveryCode,
} = require('../server/security/recovery-code.js');

test('recovery codes use 24 random bytes in copyable uppercase groups', () => {
  const bytes = Buffer.from(Array.from({ length: 24 }, (_, index) => index));
  const code = generateRecoveryCode((size) => {
    assert.equal(size, 24);
    return bytes;
  });

  assert.match(code, /^(?:[0-9A-F]{4}-){11}[0-9A-F]{4}$/);
  assert.equal(normalizeRecoveryCode(code), bytes.toString('hex').toUpperCase());
  assert.equal(normalizeRecoveryCode(`  ${code.toLowerCase()}  `), bytes.toString('hex').toUpperCase());
});

test('recovery code storage uses a canonical SHA-256 hash and constant-time verification', () => {
  const code = generateRecoveryCode(() => Buffer.alloc(24, 0xAB));
  const stored = hashRecoveryCode(code);
  const changedCode = `${code[0] === '0' ? '1' : '0'}${code.slice(1)}`;

  assert.equal(Buffer.from(stored, 'base64url').length, 32);
  assert.equal(Buffer.from(stored, 'base64url').toString('base64url'), stored);
  assert.notEqual(stored, code);
  assert.equal(verifyRecoveryCode(code, stored), true);
  assert.equal(verifyRecoveryCode(changedCode, stored), false);
});

test('invalid recovery codes and stored hashes fail without exposing the submitted value', () => {
  for (const value of ['', 'ABCD-1234', 'G'.repeat(48), null]) {
    assert.throws(
      () => normalizeRecoveryCode(value),
      (error) => error?.code === 'INPUT_INVALID'
        && (!value || !String(error.message).includes(String(value))),
    );
    assert.equal(verifyRecoveryCode(value, 'invalid-hash'), false);
  }
});

test('recovery code generation rejects an invalid randomness source result', () => {
  assert.throws(
    () => generateRecoveryCode(() => Buffer.alloc(23)),
    /randomness source returned an invalid result/i,
  );
  assert.throws(
    () => generateRecoveryCode(() => 'not-a-buffer'),
    /randomness source returned an invalid result/i,
  );
});
