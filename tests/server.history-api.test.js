const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');

const { AuthClient } = require('./helpers/auth-client.js');
const {
  historySnapshot,
  planResult,
} = require('./helpers/history-fixture.js');
const { createAuthTestApp } = require('./helpers/test-app.js');

const PASSWORD = 'History-Horse-2026';

async function login(client, username) {
  assert.equal((await client.register(username, PASSWORD)).status, 201);
  assert.equal((await client.login(username, PASSWORD)).status, 200);
  assert.equal((await client.me()).status, 200);
}

function saveHistory(client, snapshot, csrfToken = client.sessionCsrfToken) {
  return client.request('/api/history', {
    method: 'POST',
    csrfToken,
    body: snapshot,
  });
}

test('history APIs require authentication and mutations require session CSRF', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const anonymous = new AuthClient(baseUrl);

  const anonymousList = await anonymous.request('/api/history');
  assert.equal(anonymousList.status, 401);
  assert.equal((await anonymousList.json()).code, 'AUTH_REQUIRED');
  const anonymousSave = await saveHistory(anonymous, historySnapshot(), 'fake-token');
  assert.equal(anonymousSave.status, 401);
  assert.equal((await anonymousSave.json()).code, 'AUTH_REQUIRED');

  const client = new AuthClient(baseUrl);
  await login(client, 'History_Csrf');
  const missing = await saveHistory(client, historySnapshot(), '');
  assert.equal(missing.status, 403);
  assert.equal((await missing.json()).code, 'AUTH_CSRF_INVALID');
  const incorrect = await saveHistory(client, historySnapshot(), 'incorrect-token');
  assert.equal(incorrect.status, 403);
  assert.equal((await incorrect.json()).code, 'AUTH_CSRF_INVALID');
});

test('save creates then updates the same record and rejects client identity fields', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await login(client, 'History_Save');

  const firstResponse = await saveHistory(client, historySnapshot());
  const firstPayload = await firstResponse.json();
  assert.equal(firstResponse.status, 201);
  assert.equal(firstPayload.ok, true);
  assert.match(firstPayload.data.id, /^[0-9a-f-]{36}$/i);
  assert.match(firstPayload.data.title, /^基层管理岗 · /);

  const updatedPlan = planResult({ frequency: '每周复盘一次。' });
  const retryResponse = await saveHistory(client, historySnapshot({ plan: updatedPlan }));
  const retryPayload = await retryResponse.json();
  assert.equal(retryResponse.status, 200);
  assert.equal(retryPayload.ok, true);
  assert.equal(retryPayload.data.id, firstPayload.data.id);
  assert.deepEqual(retryPayload.data.plan, updatedPlan);

  for (const identity of [{ userId: randomUUID() }, { user_id: randomUUID() }]) {
    const response = await saveHistory(client, { ...historySnapshot(), ...identity });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INPUT_INVALID');
  }
});

test('list returns summary-only cursor pages and detail returns the read-only snapshot', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const client = new AuthClient(baseUrl);
  await login(client, 'History_List');

  const saved = [];
  for (let index = 1; index <= 3; index += 1) {
    const response = await saveHistory(client, historySnapshot({
      clientRecordId: randomUUID(),
      intake: { ...historySnapshot().intake, role: `岗位 ${index}` },
    }));
    assert.equal(response.status, 201);
    saved.push((await response.json()).data);
  }

  const firstResponse = await client.request('/api/history?limit=2');
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200);
  assert.equal(first.ok, true);
  assert.equal(first.data.items.length, 2);
  assert.equal(typeof first.data.nextCursor, 'string');
  assert.deepEqual(
    Object.keys(first.data.items[0]).sort(),
    ['createdAt', 'id', 'title', 'updatedAt'],
  );

  const secondResponse = await client.request(
    `/api/history?limit=2&cursor=${encodeURIComponent(first.data.nextCursor)}`,
  );
  const second = await secondResponse.json();
  assert.equal(secondResponse.status, 200);
  assert.equal(second.data.items.length, 1);
  assert.equal(second.data.nextCursor, null);
  const pageIds = [...first.data.items, ...second.data.items].map(({ id }) => id);
  assert.equal(new Set(pageIds).size, 3);

  const detailResponse = await client.request(`/api/history/${saved[0].id}`);
  const detail = await detailResponse.json();
  assert.equal(detailResponse.status, 200);
  assert.equal(detail.ok, true);
  assert.deepEqual(detail.data.intake, historySnapshot({
    intake: { ...historySnapshot().intake, role: '岗位 1' },
  }).intake);
  assert.deepEqual(detail.data.plan, historySnapshot().plan);
});

test('detail and delete conceal ownership and deletion requires CSRF', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const owner = new AuthClient(baseUrl);
  const other = new AuthClient(baseUrl);
  await login(owner, 'History_Owner');
  await login(other, 'History_Other');

  const savedResponse = await saveHistory(owner, historySnapshot());
  const saved = (await savedResponse.json()).data;
  assert.equal(savedResponse.status, 201);

  const absentId = randomUUID();
  const forbiddenResponse = await other.request(`/api/history/${saved.id}`);
  const absentResponse = await other.request(`/api/history/${absentId}`);
  const forbidden = await forbiddenResponse.json();
  const absent = await absentResponse.json();
  assert.equal(forbiddenResponse.status, 404);
  assert.equal(absentResponse.status, 404);
  assert.deepEqual(
    { code: forbidden.code, message: forbidden.message },
    { code: absent.code, message: absent.message },
  );

  const missingCsrf = await owner.request(`/api/history/${saved.id}`, {
    method: 'DELETE',
    csrfToken: '',
  });
  assert.equal(missingCsrf.status, 403);

  const otherDelete = await other.request(`/api/history/${saved.id}`, {
    method: 'DELETE',
    csrfToken: other.sessionCsrfToken,
  });
  assert.equal(otherDelete.status, 404);
  assert.equal((await owner.request(`/api/history/${saved.id}`)).status, 200);

  const ownerDelete = await owner.request(`/api/history/${saved.id}`, {
    method: 'DELETE',
    csrfToken: owner.sessionCsrfToken,
  });
  assert.equal(ownerDelete.status, 204);
  assert.equal(await ownerDelete.text(), '');
  assert.equal((await owner.request(`/api/history/${saved.id}`)).status, 404);
});
