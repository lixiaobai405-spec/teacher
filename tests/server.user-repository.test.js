const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeUsername, validateUsername } = require('../server/auth/username.js');
const { createUserRepository } = require('../server/repositories/user-repository.js');
const { createTestDatabase } = require('./helpers/test-database.js');

const NOW = '2026-07-23T08:00:00.000Z';

function user(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    username: '  管理者_A1  ',
    passwordHash: 'password-hash',
    recoveryCodeHash: 'recovery-hash',
    ...overrides,
  };
}

test('username validation trims text and preserves case without an application length cap', () => {
  assert.equal(validateUsername('  管理者_A1  '), '管理者_A1');
  assert.equal(normalizeUsername('Alice'), 'Alice');
  assert.notEqual(normalizeUsername('Alice'), normalizeUsername('alice'));
  assert.equal(validateUsername('长'.repeat(1_000)), '长'.repeat(1_000));
});

test('username validation rejects empty, unsupported, and non-string values safely', () => {
  for (const value of ['   ', 'user-name', 'user name', '管理者！', null]) {
    assert.throws(
      () => validateUsername(value),
      (error) => error?.code === 'INPUT_INVALID'
        && !/SQLITE|SELECT|INSERT|users/i.test(error.message),
    );
  }
});

test('user repository creates and finds a mapped user by case-sensitive name or id', async (t) => {
  const { database } = await createTestDatabase(t);
  const repository = createUserRepository({ database, now: () => NOW });

  const created = await database.transaction(
    (transaction) => repository.createUser(transaction, user()),
  );

  assert.deepEqual(created, {
    id: user().id,
    username: '管理者_A1',
    normalizedUsername: '管理者_A1',
    passwordHash: 'password-hash',
    recoveryCodeHash: 'recovery-hash',
    recoveryCodeVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.deepEqual(await repository.findByNormalizedUsername('管理者_A1'), created);
  assert.deepEqual(await repository.findById(user().id), created);
  assert.equal(await repository.findByNormalizedUsername('管理者_a1'), null);
  assert.equal(await repository.findById('missing-user'), null);
  assert.equal(Object.isFrozen(repository), true);
});

test('username uniqueness is case-sensitive and exact duplicates return a safe error', async (t) => {
  const { database } = await createTestDatabase(t);
  const repository = createUserRepository({ database, now: () => NOW });

  await database.transaction((transaction) => repository.createUser(transaction, user()));
  const differentCase = await database.transaction(
    (transaction) => repository.createUser(transaction, user({
      id: '22222222-2222-4222-8222-222222222222',
      username: '管理者_a1',
    })),
  );
  assert.equal(differentCase.username, '管理者_a1');

  await assert.rejects(
    database.transaction((transaction) => repository.createUser(transaction, user({
      id: '33333333-3333-4333-8333-333333333333',
      username: '管理者_A1',
    }))),
    (error) => error?.code === 'AUTH_USERNAME_TAKEN'
      && !/SQLITE|users|normalized_username|INSERT/i.test(error.message),
  );
});

test('credential update uses parameters and increments the recovery code version', async (t) => {
  const { database } = await createTestDatabase(t);
  const repository = createUserRepository({
    database,
    now: () => '2026-07-23T09:00:00.000Z',
  });
  await database.transaction((transaction) => repository.createUser(transaction, user()));

  const injectionMarker = "new-hash'); DROP TABLE users; --";
  const result = await database.transaction(
    (transaction) => repository.updateCredentials(transaction, {
      userId: user().id,
      passwordHash: injectionMarker,
      recoveryCodeHash: 'new-recovery-hash',
    }),
  );

  assert.equal(result.changes, 1);
  const updated = await repository.findById(user().id);
  assert.equal(updated.passwordHash, injectionMarker);
  assert.equal(updated.recoveryCodeHash, 'new-recovery-hash');
  assert.equal(updated.recoveryCodeVersion, 2);
  assert.equal(updated.updatedAt, '2026-07-23T09:00:00.000Z');
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM users')).count, 1);
});
