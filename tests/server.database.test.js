const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const sqlite3 = require('sqlite3');

const { loadConfig } = require('../server/config.js');
const { openDatabase } = require('../server/database/sqlite.js');
const { createTestDatabase } = require('./helpers/test-database.js');

const VALID_ENVIRONMENT = Object.freeze({
  DATABASE_PATH: ':memory:',
  SESSION_SECRET: 'test-session-secret-with-at-least-forty-eight-bytes-000',
  SESSION_COOKIE_SECURE: 'false',
  SESSION_MAX_AGE_MS: '604800000',
});

function rawGet(filename, sql) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filename, (openError) => {
      if (openError) return reject(openError);
      database.get(sql, (queryError, row) => {
        database.close((closeError) => {
          if (queryError) return reject(queryError);
          if (closeError) return reject(closeError);
          resolve(row);
        });
      });
    });
  });
}

test('loadConfig accepts the fixed seven-day HTTP session configuration', () => {
  const config = loadConfig(VALID_ENVIRONMENT);

  assert.equal(config.databasePath, ':memory:');
  assert.equal(config.sessionCookieSecure, false);
  assert.equal(config.sessionMaxAgeMs, 604_800_000);
  assert.equal(config.sessionSecret, VALID_ENVIRONMENT.SESSION_SECRET);
  assert.equal(Object.isFrozen(config), true);
});

test('loadConfig rejects missing, unsafe, or malformed authentication configuration', () => {
  const invalidEnvironments = [
    { ...VALID_ENVIRONMENT, DATABASE_PATH: ' ' },
    { ...VALID_ENVIRONMENT, SESSION_SECRET: 'too-short' },
    { ...VALID_ENVIRONMENT, SESSION_COOKIE_SECURE: 'sometimes' },
    { ...VALID_ENVIRONMENT, SESSION_MAX_AGE_MS: '3600000' },
    { ...VALID_ENVIRONMENT, SESSION_MAX_AGE_MS: 'not-a-number' },
  ];

  for (const environment of invalidEnvironments) {
    assert.throws(
      () => loadConfig(environment),
      (error) => error && error.code === 'CONFIG_INVALID',
    );
  }
});

test('openDatabase enables required pragmas and applies the Teacher migration once', async (t) => {
  const fixture = await createTestDatabase(t);

  assert.equal(Object.isFrozen(fixture.database), true);
  assert.equal((await fixture.database.get('PRAGMA journal_mode')).journal_mode, 'wal');
  assert.equal((await fixture.database.get('PRAGMA foreign_keys')).foreign_keys, 1);
  assert.equal((await fixture.database.get('PRAGMA busy_timeout')).timeout, 5000);
  assert.deepEqual(
    (await fixture.database.all('SELECT version FROM schema_migrations ORDER BY version'))
      .map((row) => row.version),
    [1],
  );

  for (const table of ['users', 'sessions', 'coaching_records']) {
    const row = await fixture.database.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table],
    );
    assert.equal(row.name, table);
  }

  assert.deepEqual(
    (await fixture.database.all('PRAGMA table_info(coaching_records)')).map((row) => row.name),
    [
      'id',
      'user_id',
      'client_record_id',
      'title',
      'intake_json',
      'answers_json',
      'selected_profile_id',
      'classification_json',
      'plan_json',
      'feedback_text',
      'feedback_json',
      'schema_version',
      'created_at',
      'updated_at',
    ],
  );
  assert.deepEqual(
    (await fixture.database.all('PRAGMA foreign_key_list(coaching_records)'))
      .map((row) => [row.table, row.from, row.to, row.on_delete]),
    [['users', 'user_id', 'id', 'CASCADE']],
  );

  await fixture.close();
  const reopened = await openDatabase({ filename: fixture.filename });
  assert.equal(
    (await reopened.get('SELECT COUNT(*) AS count FROM schema_migrations')).count,
    1,
  );
  await reopened.close();
});

test('all public database operations share one serial queue', async (t) => {
  const { database } = await createTestDatabase(t);
  await database.exec('CREATE TABLE queue_probe (value TEXT NOT NULL)');

  let releaseTransaction;
  const transactionGate = new Promise((resolve) => {
    releaseTransaction = resolve;
  });
  let outsideFinished = false;

  const transaction = database.transaction(async (client) => {
    await client.run('INSERT INTO queue_probe (value) VALUES (?)', ['inside']);
    await transactionGate;
  });
  const outsideWrite = database
    .run('INSERT INTO queue_probe (value) VALUES (?)', ['outside'])
    .then(() => {
      outsideFinished = true;
    });

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(outsideFinished, false);

  releaseTransaction();
  await Promise.all([transaction, outsideWrite]);
  assert.deepEqual(
    (await database.all('SELECT value FROM queue_probe ORDER BY rowid')).map((row) => row.value),
    ['inside', 'outside'],
  );
});

test('transaction rolls back all writes and preserves the original work error', async (t) => {
  const { database } = await createTestDatabase(t);
  const operationError = new Error('rollback marker');

  await assert.rejects(
    database.transaction(async (transaction) => {
      await transaction.run(
        `INSERT INTO users (
          id, username, normalized_username, password_hash, recovery_code_hash,
          recovery_code_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'user-1',
          'Manager',
          'Manager',
          'password-hash',
          'recovery-hash',
          1,
          '2026-07-23T00:00:00.000Z',
          '2026-07-23T00:00:00.000Z',
        ],
      );
      throw operationError;
    }),
    (error) => error === operationError,
  );

  assert.equal((await database.get('SELECT COUNT(*) AS count FROM users')).count, 0);
});

test('a broken migration rolls back its schema changes and migration record', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teacher-broken-migration-'));
  const filename = path.join(directory, 'broken.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  await assert.rejects(
    openDatabase({
      filename,
      migrations: [{
        version: 1,
        name: 'broken migration',
        async up(transaction) {
          await transaction.exec('CREATE TABLE should_rollback (id TEXT PRIMARY KEY)');
          await transaction.exec('THIS IS NOT VALID SQL');
        },
      }],
    }),
    /SQLITE_ERROR/,
  );

  assert.equal(
    await rawGet(
      filename,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'",
    ),
    undefined,
  );
  assert.equal(
    await rawGet(
      filename,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    ),
    undefined,
  );
});
