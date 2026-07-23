const assert = require('node:assert/strict');
const test = require('node:test');

const { createApp } = require('../server/app.js');
const { hashRecoveryCode } = require('../server/security/recovery-code.js');
const { AuthClient } = require('./helpers/auth-client.js');
const { createAuthTestApp } = require('./helpers/test-app.js');

const USERNAME = 'Manager_01';
const PASSWORD = 'Correct-Horse-2026';

test('createApp fails closed when the complete authentication boundary is missing', () => {
  assert.throws(
    () => createApp({ coachService: {} }),
    (error) => error?.code === 'CONFIG_INVALID' && /authBoundary/.test(error.message),
  );
});

test('registration returns one recovery code without logging the user in', async (t) => {
  const { baseUrl, database } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  const response = await client.register(USERNAME, PASSWORD);
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.user.username, USERNAME);
  assert.match(payload.recoveryCode, /^(?:[0-9A-F]{4}-){11}[0-9A-F]{4}$/);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await client.me()).status, 401);

  const row = await database.get(
    'SELECT password_hash, recovery_code_hash FROM users WHERE id = ?',
    [payload.user.id],
  );
  assert.notEqual(row.password_hash, PASSWORD);
  assert.notEqual(row.recovery_code_hash, payload.recoveryCode);
  assert.equal(row.recovery_code_hash, hashRecoveryCode(payload.recoveryCode));
});

test('registration follows the approved Chinese, case-sensitive username and password rules', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);

  assert.equal((await client.register('管理者A', '五位密码')).status, 400);
  assert.equal((await client.register('管理者A', '六位密码通过')).status, 201);
  assert.equal((await client.register('管理者a', 'x'.repeat(1_000))).status, 201);
  assert.equal((await client.login('管理者A', '六位密码通过')).status, 200);
  assert.equal((await client.login('管理者a', 'x'.repeat(1_000))).status, 200);
});

test('exact duplicate usernames return a safe stable conflict response', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  assert.equal((await client.register(USERNAME, PASSWORD)).status, 201);
  assert.equal((await client.register('manager_01', 'Different-Horse-2026')).status, 201);

  const response = await client.register(USERNAME, 'Different-Horse-2026');
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.deepEqual(payload, {
    ok: false,
    code: 'AUTH_USERNAME_TAKEN',
    message: '该用户名已被使用。',
  });
  assert.doesNotMatch(JSON.stringify(payload), /SQLITE|users|normalized_username/i);
});

test('unknown usernames and wrong passwords share the same login failure', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await client.register(USERNAME, PASSWORD);

  const unknown = await client.login('Unknown_01', PASSWORD);
  const unknownPayload = await unknown.json();
  const wrong = await client.login(USERNAME, 'Wrong-Horse-2026');
  const wrongPayload = await wrong.json();

  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(unknownPayload, wrongPayload);
  assert.deepEqual(unknownPayload, {
    ok: false,
    code: 'AUTH_INVALID_CREDENTIALS',
    message: '用户名或密码不正确。',
  });
});

test('login regenerates the sid and sets the fixed hardened HTTP cookie', async (t) => {
  const { baseUrl, database } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await client.register(USERNAME, PASSWORD);
  client.cookie = 'teacher.sid=s%3Aattacker-controlled.invalid-signature';

  const response = await client.login(USERNAME, PASSWORD);
  const payload = await response.json();
  const setCookie = response.headers.get('set-cookie');

  assert.equal(response.status, 200);
  assert.equal(payload.user.username, USERNAME);
  assert.match(setCookie, /^teacher\.sid=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\//i);
  assert.match(setCookie, /Max-Age=604800/i);
  assert.doesNotMatch(setCookie, /Secure/i);
  assert.equal(setCookie.includes('attacker-controlled'), false);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM sessions')).count, 1);
});

test('me restores identity and logout invalidates only the current session', async (t) => {
  const { baseUrl, database } = await createAuthTestApp(t);
  const first = new AuthClient(baseUrl);
  await first.register(USERNAME, PASSWORD);
  assert.equal((await first.login(USERNAME, PASSWORD)).status, 200);

  const firstMe = await first.me();
  const firstPayload = await firstMe.json();
  assert.equal(firstMe.status, 200);
  assert.equal(firstPayload.user.username, USERNAME);
  assert.match(firstPayload.csrfToken, /^[A-Za-z0-9_-]{43}$/);

  const refreshed = new AuthClient(baseUrl);
  refreshed.cookie = first.cookie;
  const refreshedMe = await refreshed.me();
  assert.equal(refreshedMe.status, 200);
  assert.equal((await refreshedMe.json()).user.username, USERNAME);

  const second = new AuthClient(baseUrl);
  assert.equal((await second.login(USERNAME, PASSWORD)).status, 200);
  assert.equal((await second.me()).status, 200);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM sessions')).count, 2);

  assert.equal((await first.logout()).status, 204);
  assert.equal((await first.me()).status, 401);
  assert.equal((await second.me()).status, 200);
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM sessions')).count, 1);
});

test('authentication request bodies reject extra or malformed fields', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await client.getPreAuthCsrf();
  const response = await client.request('/api/auth/register', {
    method: 'POST',
    csrfToken: client.preAuthCsrfToken,
    body: { username: USERNAME, password: PASSWORD, admin: true },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: 'INPUT_INVALID',
    message: '用户名或密码格式不正确。',
  });
});
