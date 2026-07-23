const assert = require('node:assert/strict');
const test = require('node:test');

const { AuthClient } = require('./helpers/auth-client.js');
const { createAuthTestApp } = require('./helpers/test-app.js');

const USERNAME = 'Workflow_User';
const PASSWORD = 'Workflow-Horse-2026';
const METHODS = ['intake', 'classify', 'plan', 'feedback'];

function createCoachService(calls) {
  return Object.fromEntries(METHODS.map((method) => [
    method,
    async (body) => {
      calls.push({ method, body });
      return { source: method };
    },
  ]));
}

async function authenticate(client) {
  assert.equal((await client.register(USERNAME, PASSWORD)).status, 201);
  assert.equal((await client.login(USERNAME, PASSWORD)).status, 200);
  assert.equal((await client.me()).status, 200);
}

test('anonymous coaching requests return 401 before the coach service runs', async (t) => {
  const calls = [];
  const { baseUrl } = await createAuthTestApp(t, {
    coachService: createCoachService(calls),
  });
  const anonymous = new AuthClient(baseUrl);

  for (const method of METHODS) {
    const response = await anonymous.request(`/api/coach/${method}`, {
      method: 'POST',
      body: { request: method },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      ok: false,
      code: 'AUTH_REQUIRED',
      message: '请先登录后再继续。',
    });
  }

  assert.deepEqual(calls, []);
});

test('authenticated coaching requests require same-origin and session CSRF checks', async (t) => {
  const calls = [];
  const { baseUrl } = await createAuthTestApp(t, {
    coachService: createCoachService(calls),
  });
  const client = new AuthClient(baseUrl);
  await authenticate(client);

  const withoutOrigin = await fetch(`${baseUrl}/api/coach/intake`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: client.cookie,
      'x-csrf-token': client.sessionCsrfToken,
    },
    body: JSON.stringify({ request: 'without-origin' }),
  });
  assert.equal(withoutOrigin.status, 403);

  const wrongCsrf = await client.request('/api/coach/intake', {
    method: 'POST',
    csrfToken: 'wrong-csrf-token',
    body: { request: 'wrong-csrf' },
  });
  assert.equal(wrongCsrf.status, 403);
  assert.deepEqual(calls, []);
});

test('authenticated coaching requests preserve existing request and response contracts', async (t) => {
  const calls = [];
  const { baseUrl } = await createAuthTestApp(t, {
    coachService: createCoachService(calls),
  });
  const client = new AuthClient(baseUrl);
  await authenticate(client);

  for (const method of METHODS) {
    const body = { request: method, nested: { keep: true } };
    const response = await client.request(`/api/coach/${method}`, {
      method: 'POST',
      csrfToken: client.sessionCsrfToken,
      body,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      blocked: false,
      data: { source: method },
    });
  }

  assert.deepEqual(calls, METHODS.map((method) => ({
    method,
    body: { request: method, nested: { keep: true } },
  })));
});
