const assert = require('node:assert/strict');
const test = require('node:test');

const { createUserRepository } = require('../server/repositories/user-repository.js');
const { createSessionRepository } = require('../server/repositories/session-repository.js');
const { SqliteSessionStore } = require('../server/session/sqlite-session-store.js');
const { generateSessionId, hashToken } = require('../server/security/token-hash.js');
const { createTestDatabase } = require('./helpers/test-database.js');

const MAX_AGE_MS = 604_800_000;
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function invoke(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (error, value) => (error ? reject(error) : resolve(value)));
  });
}

async function createUser(database, id, username) {
  const users = createUserRepository({
    database,
    now: () => '2026-07-23T00:00:00.000Z',
  });
  await database.transaction((transaction) => users.createUser(transaction, {
    id,
    username,
    passwordHash: 'password-hash',
    recoveryCodeHash: 'recovery-hash',
  }));
}

function createFixture(database, clock) {
  let sessionSequence = 0;
  const repository = createSessionRepository({
    database,
    now: () => new Date(clock.value).toISOString(),
    randomUUID: () => {
      sessionSequence += 1;
      return `aaaaaaaa-aaaa-4aaa-8aaa-${String(sessionSequence).padStart(12, '0')}`;
    },
  });
  const store = new SqliteSessionStore({
    repository,
    sessionMaxAgeMs: MAX_AGE_MS,
    cookie: { httpOnly: true, secure: false, sameSite: 'strict', path: '/' },
    createCsrfTokenHash: (sessionId) => hashToken(`csrf:${sessionId}`),
  });
  return { repository, store };
}

test('session identifiers contain 32 random bytes and token hashes are canonical SHA-256', () => {
  const sessionId = generateSessionId((size) => {
    assert.equal(size, 32);
    return Buffer.alloc(size, 9);
  });
  const tokenHash = hashToken(sessionId);

  assert.equal(Buffer.from(sessionId, 'base64url').length, 32);
  assert.equal(Buffer.from(tokenHash, 'base64url').length, 32);
  assert.notEqual(tokenHash, sessionId);
  assert.throws(() => generateSessionId(() => Buffer.alloc(31)), /randomness source/i);
  assert.throws(() => hashToken(''), /Token is required/);
});

test('Store set/get persists only hashes and reconstructs the fixed seven-day cookie', async (t) => {
  const { database } = await createTestDatabase(t);
  await createUser(database, USER_A, 'Manager_A');
  const clock = { value: Date.parse('2026-07-23T01:00:00.000Z') };
  const { store } = createFixture(database, clock);
  const rawSessionId = generateSessionId();

  await invoke(store, 'set', rawSessionId, { userId: USER_A, cookie: {} });
  const row = await database.get(
    'SELECT id, token_hash, csrf_token_hash, expires_at FROM sessions WHERE user_id = ?',
    [USER_A],
  );
  assert.match(row.id, /^[0-9a-f-]{36}$/i);
  assert.notEqual(row.token_hash, rawSessionId);
  assert.equal(row.token_hash, hashToken(rawSessionId));
  assert.equal(row.csrf_token_hash, hashToken(`csrf:${rawSessionId}`));
  assert.equal(JSON.stringify(row).includes(rawSessionId), false);
  assert.equal(row.expires_at, '2026-07-30T01:00:00.000Z');

  const restored = await invoke(store, 'get', rawSessionId);
  assert.deepEqual(
    {
      userId: restored.userId,
      httpOnly: restored.cookie.httpOnly,
      secure: restored.cookie.secure,
      sameSite: restored.cookie.sameSite,
      path: restored.cookie.path,
      originalMaxAge: restored.cookie.originalMaxAge,
      expires: restored.cookie.expires.toISOString(),
    },
    {
      userId: USER_A,
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/',
      originalMaxAge: MAX_AGE_MS,
      expires: row.expires_at,
    },
  );
  assert.equal('tokenHash' in restored, false);
  assert.equal('csrfTokenHash' in restored, false);
});

test('Store rejects unauthenticated values without creating a database row', async (t) => {
  const { database } = await createTestDatabase(t);
  const clock = { value: Date.parse('2026-07-23T01:00:00.000Z') };
  const { store } = createFixture(database, clock);

  await assert.rejects(
    invoke(store, 'set', generateSessionId(), { cookie: {} }),
    (error) => error?.code === 'AUTH_REQUIRED',
  );
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM sessions')).count, 0);
});

test('touch updates last seen without extending the original expiry', async (t) => {
  const { database } = await createTestDatabase(t);
  await createUser(database, USER_A, 'Manager_A');
  const clock = { value: Date.parse('2026-07-23T01:00:00.000Z') };
  const { store } = createFixture(database, clock);
  const sessionId = generateSessionId();
  await invoke(store, 'set', sessionId, { userId: USER_A, cookie: {} });

  clock.value += 60_000;
  await invoke(store, 'touch', sessionId, { userId: USER_A, cookie: {} });
  const row = await database.get('SELECT expires_at, last_seen_at FROM sessions');
  assert.equal(row.expires_at, '2026-07-30T01:00:00.000Z');
  assert.equal(row.last_seen_at, '2026-07-23T01:01:00.000Z');
});

test('expired sessions are deleted when read and pruneExpired removes unread sessions', async (t) => {
  const { database } = await createTestDatabase(t);
  await createUser(database, USER_A, 'Manager_A');
  const clock = { value: Date.parse('2026-07-23T01:00:00.000Z') };
  const { repository, store } = createFixture(database, clock);
  const [readSession, unreadSession] = [generateSessionId(), generateSessionId()];
  await invoke(store, 'set', readSession, { userId: USER_A, cookie: {} });
  await invoke(store, 'set', unreadSession, { userId: USER_A, cookie: {} });

  clock.value += MAX_AGE_MS + 1;
  assert.equal(await invoke(store, 'get', readSession), null);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM sessions')).count, 1);
  assert.equal((await repository.pruneExpired()).changes, 1);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM sessions')).count, 0);
});

test('destroy removes one session while user-wide revocation remains isolated', async (t) => {
  const { database } = await createTestDatabase(t);
  await createUser(database, USER_A, 'Manager_A');
  await createUser(database, USER_B, 'Manager_B');
  const clock = { value: Date.parse('2026-07-23T01:00:00.000Z') };
  const { repository, store } = createFixture(database, clock);
  const [sessionA1, sessionA2, sessionB] = [
    generateSessionId(),
    generateSessionId(),
    generateSessionId(),
  ];
  await invoke(store, 'set', sessionA1, { userId: USER_A, cookie: {} });
  await invoke(store, 'set', sessionA2, { userId: USER_A, cookie: {} });
  await invoke(store, 'set', sessionB, { userId: USER_B, cookie: {} });

  await invoke(store, 'destroy', sessionA1);
  assert.equal(await invoke(store, 'get', sessionA1), null);
  assert.equal((await invoke(store, 'get', sessionA2)).userId, USER_A);
  assert.equal((await invoke(store, 'get', sessionB)).userId, USER_B);

  await database.transaction(
    (transaction) => repository.destroyAllForUser(transaction, USER_A),
  );
  assert.equal(await invoke(store, 'get', sessionA2), null);
  assert.equal((await invoke(store, 'get', sessionB)).userId, USER_B);
});
