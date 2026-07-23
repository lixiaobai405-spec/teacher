const assert = require('node:assert/strict');
const test = require('node:test');

const { createHistoryRepository } = require('../server/repositories/history-repository.js');
const { createUserRepository } = require('../server/repositories/user-repository.js');
const {
  feedbackResult,
  historySnapshot,
  planResult,
} = require('./helpers/history-fixture.js');
const { createTestDatabase } = require('./helpers/test-database.js');

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function seedUser(database, id, username) {
  const users = createUserRepository({ database });
  await database.transaction((transaction) => users.createUser(transaction, {
    id,
    username,
    passwordHash: 'fake-password-hash',
    recoveryCodeHash: 'fake-recovery-hash',
  }));
}

test('save creates once then updates only plan and feedback for the same owner and client record', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_A');
  const repository = createHistoryRepository({
    database,
    now: () => '2026-07-21T16:00:00.000Z',
    randomUUID: () => '10000000-0000-4000-8000-000000000001',
  });

  const original = historySnapshot();
  const first = await repository.save({ userId: USER_A, snapshot: original });
  const updatedPlan = planResult({ frequency: '每周复盘一次。' });
  const retry = await repository.save({
    userId: USER_A,
    snapshot: historySnapshot({
      intake: { ...original.intake, role: '不应覆盖的岗位' },
      plan: updatedPlan,
      feedbackText: '员工本周主动同步了风险。',
      feedback: feedbackResult(),
    }),
  });

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.item.id, first.item.id);
  assert.equal(retry.item.createdAt, first.item.createdAt);
  assert.equal(retry.item.title, '基层管理岗 · 2026/7/22');
  assert.deepEqual(retry.item.intake, original.intake);
  assert.deepEqual(retry.item.plan, updatedPlan);
  assert.equal(retry.item.feedbackText, '员工本周主动同步了风险。');
  assert.equal((await database.get('SELECT COUNT(*) AS count FROM coaching_records')).count, 1);
});

test('all history repository operations require a server-supplied userId', async (t) => {
  const { database } = await createTestDatabase(t);
  const repository = createHistoryRepository({ database });
  const calls = [
    () => repository.save({ snapshot: historySnapshot() }),
    () => repository.list({}),
    () => repository.getById({ id: '10000000-0000-4000-8000-000000000001' }),
    () => repository.deleteById({ id: '10000000-0000-4000-8000-000000000001' }),
  ];
  for (const call of calls) {
    await assert.rejects(call, (error) => error.code === 'AUTH_REQUIRED');
  }
});

test('user A cannot list, read, update, or delete user B history', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_A');
  await seedUser(database, USER_B, 'History_B');
  const ids = [
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
  ];
  const repository = createHistoryRepository({
    database,
    randomUUID: () => ids.shift(),
  });
  const savedB = await repository.save({ userId: USER_B, snapshot: historySnapshot() });
  const savedA = await repository.save({
    userId: USER_A,
    snapshot: historySnapshot({ plan: planResult({ frequency: 'A 用户频率。' }) }),
  });

  assert.notEqual(savedA.item.id, savedB.item.id);
  assert.deepEqual(await repository.list({ userId: USER_A }), {
    items: [{
      id: savedA.item.id,
      title: savedA.item.title,
      createdAt: savedA.item.createdAt,
      updatedAt: savedA.item.updatedAt,
    }],
    nextCursor: null,
  });
  assert.equal(await repository.getById({ userId: USER_A, id: savedB.item.id }), null);
  assert.equal(await repository.deleteById({ userId: USER_A, id: savedB.item.id }), false);
  assert.notEqual(await repository.getById({ userId: USER_B, id: savedB.item.id }), null);
  assert.equal(await repository.deleteById({ userId: USER_B, id: savedB.item.id }), true);
});

test('list uses stable descending cursor pagination and returns summaries only', async (t) => {
  const { database } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_A');
  const ids = [
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
  ];
  const repository = createHistoryRepository({
    database,
    now: () => '2026-07-21T08:00:00.000Z',
    randomUUID: () => ids.shift(),
  });
  for (let index = 1; index <= 3; index += 1) {
    await repository.save({
      userId: USER_A,
      snapshot: historySnapshot({
        clientRecordId: `90000000-0000-4000-8000-00000000000${index}`,
        intake: { ...historySnapshot().intake, role: `岗位 ${index}` },
      }),
    });
  }

  const first = await repository.list({ userId: USER_A, limit: 2 });
  assert.deepEqual(first.items.map((item) => item.title), [
    '岗位 3 · 2026/7/21',
    '岗位 2 · 2026/7/21',
  ]);
  assert.equal(typeof first.nextCursor, 'string');
  assert.deepEqual(Object.keys(first.items[0]).sort(), ['createdAt', 'id', 'title', 'updatedAt']);

  const second = await repository.list({
    userId: USER_A,
    limit: 2,
    cursor: first.nextCursor,
  });
  assert.deepEqual(second.items.map((item) => item.title), ['岗位 1 · 2026/7/21']);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 3);
});

test('details reject unknown schema versions and damaged JSON with a stable safe error', async (t) => {
  const { database, filename } = await createTestDatabase(t);
  await seedUser(database, USER_A, 'History_A');
  const repository = createHistoryRepository({
    database,
    randomUUID: () => '40000000-0000-4000-8000-000000000004',
  });
  const saved = await repository.save({ userId: USER_A, snapshot: historySnapshot() });

  await database.run(
    'UPDATE coaching_records SET schema_version = 2 WHERE id = ? AND user_id = ?',
    [saved.item.id, USER_A],
  );
  await assert.rejects(
    repository.getById({ userId: USER_A, id: saved.item.id }),
    (error) => error.code === 'HISTORY_DATA_INVALID'
      && !error.message.includes(filename)
      && !/SQLITE|SELECT|coaching_records/i.test(error.message),
  );

  await database.run(
    `UPDATE coaching_records
     SET schema_version = 1, plan_json = ?
     WHERE id = ? AND user_id = ?`,
    ['{damaged', saved.item.id, USER_A],
  );
  await assert.rejects(
    repository.getById({ userId: USER_A, id: saved.item.id }),
    (error) => error.code === 'HISTORY_DATA_INVALID'
      && !error.message.includes('{damaged'),
  );
});
