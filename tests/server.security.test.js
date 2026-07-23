const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../server/app.js');
const { createHistoryRouter } = require('../server/history/router.js');
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
});
