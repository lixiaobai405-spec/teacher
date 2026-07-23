const assert = require('node:assert/strict');
const test = require('node:test');

const { hashRecoveryCode } = require('../server/security/recovery-code.js');
const { AuthClient } = require('./helpers/auth-client.js');
const { createAuthTestApp } = require('./helpers/test-app.js');

const USERNAME = 'Recovery_User';
const PASSWORD = 'Original-Horse-2026';
const NEW_PASSWORD = 'Updated-Horse-2026';

async function register(client) {
  const response = await client.register(USERNAME, PASSWORD);
  assert.equal(response.status, 201);
  return response.json();
}

async function resetWithRecovery(client, {
  username = USERNAME,
  recoveryCode,
  newPassword = NEW_PASSWORD,
} = {}) {
  if (!client.preAuthCsrfToken) await client.getPreAuthCsrf();
  return client.request('/api/auth/password/reset-with-recovery', {
    method: 'POST',
    csrfToken: client.preAuthCsrfToken,
    body: { username, recoveryCode, newPassword },
  });
}

async function rotateRecoveryCode(client, password = PASSWORD, csrfToken = client.sessionCsrfToken) {
  return client.request('/api/auth/recovery-code/rotate', {
    method: 'POST',
    csrfToken,
    body: { password },
  });
}

test('recovery reset rotates credentials and revokes every existing session atomically', async (t) => {
  const { baseUrl, database } = await createAuthTestApp(t);
  const first = new AuthClient(baseUrl);
  const registration = await register(first);
  assert.equal((await first.login(USERNAME, PASSWORD)).status, 200);
  assert.equal((await first.me()).status, 200);

  const second = new AuthClient(baseUrl);
  assert.equal((await second.login(USERNAME, PASSWORD)).status, 200);
  assert.equal((await second.me()).status, 200);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM sessions')).count, 2);

  const resetClient = new AuthClient(baseUrl);
  const reset = await resetWithRecovery(resetClient, {
    recoveryCode: registration.recoveryCode,
  });
  const payload = await reset.json();

  assert.equal(reset.status, 200);
  assert.match(payload.recoveryCode, /^(?:[0-9A-F]{4}-){11}[0-9A-F]{4}$/);
  assert.notEqual(payload.recoveryCode, registration.recoveryCode);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM sessions')).count, 0);
  assert.equal((await first.me()).status, 401);
  assert.equal((await second.me()).status, 401);
  assert.equal((await resetClient.login(USERNAME, PASSWORD)).status, 401);
  assert.equal((await resetClient.login(USERNAME, NEW_PASSWORD)).status, 200);

  const user = await database.get(
    'SELECT recovery_code_hash, recovery_code_version FROM users WHERE username = ?',
    [USERNAME],
  );
  assert.equal(user.recovery_code_version, 2);
  assert.equal(user.recovery_code_hash, hashRecoveryCode(payload.recoveryCode));

  const oldCode = await resetWithRecovery(new AuthClient(baseUrl), {
    recoveryCode: registration.recoveryCode,
    newPassword: 'Another-Horse-2026',
  });
  assert.equal(oldCode.status, 401);
});

test('recovery reset rolls back credential changes when session revocation fails', async (t) => {
  const { baseUrl, database } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  const registration = await register(client);
  const before = await database.get(
    `SELECT password_hash, recovery_code_hash, recovery_code_version
     FROM users WHERE username = ?`,
    [USERNAME],
  );

  await database.exec('DROP TABLE sessions');
  const response = await resetWithRecovery(client, {
    recoveryCode: registration.recoveryCode,
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: 'INTERNAL_ERROR',
    message: '服务内部错误，请稍后重试。',
  });

  const after = await database.get(
    `SELECT password_hash, recovery_code_hash, recovery_code_version
     FROM users WHERE username = ?`,
    [USERNAME],
  );
  assert.deepEqual(after, before);
});

test('authenticated recovery-code rotation requires CSRF and password but preserves other sessions', async (t) => {
  const { baseUrl, database } = await createAuthTestApp(t);
  const first = new AuthClient(baseUrl);
  const registration = await register(first);
  assert.equal((await first.login(USERNAME, PASSWORD)).status, 200);
  assert.equal((await first.me()).status, 200);

  const second = new AuthClient(baseUrl);
  assert.equal((await second.login(USERNAME, PASSWORD)).status, 200);
  assert.equal((await second.me()).status, 200);

  const wrongPassword = await rotateRecoveryCode(first, 'Wrong-Horse-2026');
  assert.equal(wrongPassword.status, 401);
  const wrongCsrf = await rotateRecoveryCode(first, PASSWORD, 'wrong-csrf-token');
  assert.equal(wrongCsrf.status, 403);

  const rotation = await rotateRecoveryCode(first);
  const payload = await rotation.json();
  assert.equal(rotation.status, 200);
  assert.match(payload.recoveryCode, /^(?:[0-9A-F]{4}-){11}[0-9A-F]{4}$/);
  assert.notEqual(payload.recoveryCode, registration.recoveryCode);
  assert.equal((await first.me()).status, 200);
  assert.equal((await second.me()).status, 200);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM sessions')).count, 2);

  const user = await database.get(
    'SELECT recovery_code_hash, recovery_code_version FROM users WHERE username = ?',
    [USERNAME],
  );
  assert.equal(user.recovery_code_version, 2);
  assert.equal(user.recovery_code_hash, hashRecoveryCode(payload.recoveryCode));

  const anonymous = new AuthClient(baseUrl);
  await anonymous.getPreAuthCsrf();
  const noSession = await anonymous.request('/api/auth/recovery-code/rotate', {
    method: 'POST',
    csrfToken: anonymous.preAuthCsrfToken,
    body: { password: PASSWORD },
  });
  assert.equal(noSession.status, 401);
});
