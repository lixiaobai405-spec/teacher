const assert = require('node:assert/strict');
const test = require('node:test');

const {
  HISTORY_SCHEMA_VERSION,
  decodeStoredSnapshot,
  validateHistorySnapshot,
} = require('../server/history/contracts.js');
const {
  decodeHistoryCursor,
  encodeHistoryCursor,
  normalizeHistoryLimit,
} = require('../server/history/cursor.js');
const {
  feedbackResult,
  historySnapshot,
} = require('./helpers/history-fixture.js');

function inputInvalid(block) {
  assert.throws(
    block,
    (error) => error.code === 'INPUT_INVALID'
      && error.status === 400
      && !/SQLITE|SELECT|INSERT/i.test(error.message),
  );
}

function stored(snapshot, schemaVersion = 1) {
  return {
    clientRecordId: snapshot.clientRecordId,
    intakeJson: JSON.stringify(snapshot.intake),
    answersJson: JSON.stringify(snapshot.answers),
    selectedProfileId: snapshot.selectedProfileId,
    classificationJson: JSON.stringify(snapshot.classification),
    planJson: JSON.stringify(snapshot.plan),
    feedbackText: snapshot.feedbackText,
    feedbackJson: snapshot.feedback === null ? null : JSON.stringify(snapshot.feedback),
    schemaVersion,
  };
}

test('a complete version-1 Teacher history snapshot preserves the workflow contract', () => {
  const snapshot = historySnapshot();
  assert.equal(HISTORY_SCHEMA_VERSION, 1);
  assert.deepEqual(validateHistorySnapshot(snapshot), snapshot);
  assert.deepEqual(decodeStoredSnapshot(stored(snapshot)), snapshot);
});

test('history rejects identity, title, cookie, prompt, debug, unknown fields, and bad UUIDs', () => {
  for (const injected of [
    { userId: 'attacker' },
    { user_id: 'attacker' },
    { title: '伪造标题' },
    { cookie: 'teacher.sid=secret' },
    { systemPrompt: 'hidden prompt' },
    { debug: { rawModelResponse: 'secret' } },
  ]) {
    inputInvalid(() => validateHistorySnapshot({ ...historySnapshot(), ...injected }));
  }
  inputInvalid(() => validateHistorySnapshot({
    ...historySnapshot(),
    clientRecordId: 'not-a-uuid',
  }));
  const incomplete = historySnapshot();
  delete incomplete.plan;
  inputInvalid(() => validateHistorySnapshot(incomplete));
});

test('history validates nested intake, answers, selected profile, classification, and plan strictly', () => {
  inputInvalid(() => validateHistorySnapshot({
    ...historySnapshot(),
    intake: { ...historySnapshot().intake, employeeName: '真实姓名' },
  }));
  inputInvalid(() => validateHistorySnapshot({
    ...historySnapshot(),
    answers: [{ question: '问题', answer: '答案', extra: true }],
  }));
  inputInvalid(() => validateHistorySnapshot({
    ...historySnapshot(),
    selectedProfileId: 'D2',
  }));
  inputInvalid(() => validateHistorySnapshot({
    ...historySnapshot(),
    classification: { ...historySnapshot().classification, strategy: '错误策略' },
  }));
  inputInvalid(() => validateHistorySnapshot({
    ...historySnapshot(),
    plan: { ...historySnapshot().plan, scripts: ['缺少完整 GROW'] },
  }));
});

test('feedback text and feedback are nullable together and non-empty feedback reuses SBI validation', () => {
  const complete = historySnapshot({
    feedbackText: '员工本周主动同步了风险。',
    feedback: feedbackResult(),
  });
  assert.deepEqual(validateHistorySnapshot(complete), complete);

  inputInvalid(() => validateHistorySnapshot({
    ...historySnapshot(),
    feedbackText: '已有反馈文本',
    feedback: null,
  }));
  inputInvalid(() => validateHistorySnapshot({
    ...historySnapshot(),
    feedbackText: null,
    feedback: feedbackResult(),
  }));
  inputInvalid(() => validateHistorySnapshot({
    ...complete,
    feedback: feedbackResult({ next_steps: ['继续复盘。', '观察变化。'] }),
  }));
});

test('stored snapshots reject unknown schema versions and damaged JSON without partial data', () => {
  assert.throws(
    () => decodeStoredSnapshot(stored(historySnapshot(), 2)),
    (error) => error.code === 'HISTORY_DATA_INVALID' && error.status === 500,
  );
  const damaged = stored(historySnapshot());
  damaged.planJson = '{damaged';
  assert.throws(
    () => decodeStoredSnapshot(damaged),
    (error) => error.code === 'HISTORY_DATA_INVALID'
      && error.status === 500
      && !error.message.includes('{damaged'),
  );
});

test('history cursors are canonical and limits default to 20 with a maximum of 50', () => {
  const value = {
    createdAt: '2026-07-21T08:00:00.000Z',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  };
  const encoded = encodeHistoryCursor(value);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeHistoryCursor(encoded), value);
  inputInvalid(() => decodeHistoryCursor(`${encoded}=`));
  inputInvalid(() => decodeHistoryCursor('not-json'));
  inputInvalid(() => encodeHistoryCursor({ ...value, extra: true }));
  inputInvalid(() => encodeHistoryCursor({ ...value, createdAt: 'yesterday' }));
  assert.equal(normalizeHistoryLimit(undefined), 20);
  assert.equal(normalizeHistoryLimit('12'), 12);
  assert.equal(normalizeHistoryLimit('999'), 50);
  inputInvalid(() => normalizeHistoryLimit('0'));
  inputInvalid(() => normalizeHistoryLimit('1.5'));
});
