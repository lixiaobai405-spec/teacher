const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../server/app.js');
const { createHistoryRouter } = require('../server/history/router.js');
const { hashRecoveryCode } = require('../server/security/recovery-code.js');
const { AuthClient } = require('./helpers/auth-client.js');
const { historySnapshot } = require('./helpers/history-fixture.js');
const { createAuthTestApp } = require('./helpers/test-app.js');
const { createTestAuthBoundary } = require('./helpers/test-auth-boundary.js');

const PRIVATE_MARKER = 'SQLITE_PRIVATE_MARKER D:\\private\\teacher.sqlite 员工正文';

function failingRepository() {
  return Object.fromEntries(['save', 'list', 'getById', 'deleteById'].map((method) => [
    method,
    async () => {
      throw Object.assign(new Error(PRIVATE_MARKER), {
        code: 'SQLITE_ERROR',
        sql: `SELECT ${PRIVATE_MARKER}`,
      });
    },
  ]));
}

async function startSecurityServer(t) {
  const historyRouter = createHistoryRouter({ historyRepository: failingRepository() });
  const app = createApp({
    coachService: {},
    authBoundary: createTestAuthBoundary({ historyRouter }),
  });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => (
    error ? reject(error) : resolve()
  ))));
  return `http://127.0.0.1:${server.address().port}`;
}

test('history database failures use one stable 503 response without private details', async (t) => {
  const logLines = [];
  const originalConsoleError = console.error;
  console.error = (...values) => logLines.push(values.join(' '));
  t.after(() => {
    console.error = originalConsoleError;
  });
  const origin = await startSecurityServer(t);
  const cases = [
    ['/api/history', { method: 'GET' }],
    ['/api/history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }],
    ['/api/history/10000000-0000-4000-8000-000000000001', { method: 'GET' }],
    ['/api/history/10000000-0000-4000-8000-000000000001', { method: 'DELETE' }],
  ];

  for (const [path, options] of cases) {
    const response = await fetch(`${origin}${path}`, options);
    const text = await response.text();
    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(text), {
      ok: false,
      code: 'DATABASE_UNAVAILABLE',
      message: '历史数据库暂时不可用，请稍后重试。',
    });
    assert.doesNotMatch(text, /SQLITE_PRIVATE_MARKER|private|teacher\.sqlite|员工正文/i);
  }
  assert.doesNotMatch(logLines.join('\n'), /SQLITE_PRIVATE_MARKER|teacher\.sqlite|员工正文/i);
});

test('credentials and session tokens are hashed while owned history stays isolated', async (t) => {
  const USERNAME_MARKER = 'Security_User_Marker_01';
  const PASSWORD_MARKER = 'Password-Private-Marker-2026';
  const RAW_SESSION_MARKER = 'Raw-Session-Private-Marker';
  const CSRF_MARKER = 'Csrf-Private-Marker';
  const EMPLOYEE_MARKER = 'Employee-Private-Marker-正文';
  const { baseUrl, database } = await createAuthTestApp(t);
  const owner = new AuthClient(baseUrl);
  const registration = await owner.register(USERNAME_MARKER, PASSWORD_MARKER);
  const registrationPayload = await registration.json();
  const recoveryCode = registrationPayload.recoveryCode;
  assert.equal(registration.status, 201);

  assert.equal((await owner.login(USERNAME_MARKER, PASSWORD_MARKER)).status, 200);
  const rawSessionCookie = owner.cookie;
  const me = await owner.me();
  const mePayload = await me.json();
  const sessionCsrfToken = mePayload.csrfToken;
  const snapshot = historySnapshot({
    intake: {
      ...historySnapshot().intake,
      goal: EMPLOYEE_MARKER,
      pain: `${EMPLOYEE_MARKER}-困扰`,
    },
  });
  const saved = await owner.request('/api/history', {
    method: 'POST',
    csrfToken: owner.sessionCsrfToken,
    body: snapshot,
  });
  const savedPayload = await saved.json();
  assert.equal(saved.status, 201);

  const safeFailureTexts = [];
  const wrongPassword = await owner.login(USERNAME_MARKER, `${PASSWORD_MARKER}-wrong`);
  safeFailureTexts.push(await wrongPassword.text());
  const badCsrf = await owner.request('/api/history', {
    method: 'POST',
    csrfToken: CSRF_MARKER,
    body: snapshot,
  });
  safeFailureTexts.push(await badCsrf.text());
  const forgedSession = await owner.request('/api/history', {
    cookie: `teacher.sid=${RAW_SESSION_MARKER}`,
  });
  safeFailureTexts.push(await forgedSession.text());

  const other = new AuthClient(baseUrl);
  await other.register('Security_Other_User_01', 'Other-Password-Marker-2026');
  await other.login('Security_Other_User_01', 'Other-Password-Marker-2026');
  await other.me();
  const crossUser = await other.request(`/api/history/${savedPayload.data.id}`);
  safeFailureTexts.push(await crossUser.text());
  const safeFailures = safeFailureTexts.join('\n');
  for (const secret of [
    PASSWORD_MARKER,
    recoveryCode,
    rawSessionCookie,
    sessionCsrfToken,
    RAW_SESSION_MARKER,
    CSRF_MARKER,
    EMPLOYEE_MARKER,
    PRIVATE_MARKER,
  ]) {
    assert.equal(safeFailures.includes(secret), false, `failure response leaked: ${secret}`);
  }

  const userRow = await database.get(
    `SELECT username, password_hash, recovery_code_hash
       FROM users
      WHERE id = ?`,
    [registrationPayload.user.id],
  );
  assert.equal(userRow.username, USERNAME_MARKER);
  assert.equal(userRow.password_hash.includes(PASSWORD_MARKER), false);
  assert.equal(userRow.recovery_code_hash, hashRecoveryCode(recoveryCode));
  assert.equal(userRow.recovery_code_hash.includes(recoveryCode), false);

  const sessionRows = await database.all(
    'SELECT token_hash, csrf_token_hash FROM sessions WHERE user_id = ?',
    [registrationPayload.user.id],
  );
  assert.equal(sessionRows.length, 1);
  assert.equal(JSON.stringify(sessionRows).includes(rawSessionCookie), false);
  assert.equal(JSON.stringify(sessionRows).includes(sessionCsrfToken), false);

  const historyRows = await database.all(
    'SELECT user_id, intake_json FROM coaching_records ORDER BY created_at',
  );
  assert.equal(historyRows.length, 1);
  assert.equal(historyRows[0].user_id, registrationPayload.user.id);
  assert.match(historyRows[0].intake_json, new RegExp(EMPLOYEE_MARKER));
});
