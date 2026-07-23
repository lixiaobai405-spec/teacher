const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { openDatabase } = require('../server/database/sqlite.js');

const projectRoot = path.resolve(__dirname, '..');
const migrateScript = path.join(projectRoot, 'scripts', 'migrate.js');
const validSecret = 'operations-test-session-secret-48-bytes-minimum-000000000000';

function migrationEnvironment(databasePath, overrides = {}) {
  return {
    DATABASE_PATH: databasePath,
    SESSION_SECRET: validSecret,
    SESSION_COOKIE_SECURE: 'false',
    SESSION_MAX_AGE_MS: '604800000',
    ...overrides,
  };
}

function runMigration(environment) {
  return spawnSync(process.execPath, [migrateScript], {
    cwd: projectRoot,
    env: environment,
    encoding: 'utf8',
  });
}

test('迁移命令创建认证与历史结构且输出不泄露配置', async (t) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'teacher-operations-'));
  let database;
  t.after(async () => {
    if (database) await database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });
  const databasePath = path.join(tempDir, 'teacher.sqlite');

  const result = runMigration(migrationEnvironment(databasePath));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Database migrations completed\.\s*$/);
  assert.doesNotMatch(result.stdout, /teacher\.sqlite|operations-test-session-secret/);
  assert.equal(result.stderr, '');

  database = await openDatabase({ filename: databasePath });
  const tables = await database.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  );
  const names = tables.map(({ name }) => name);
  for (const table of ['coaching_records', 'schema_migrations', 'sessions', 'users']) {
    assert.ok(names.includes(table), `missing table: ${table}`);
  }
});

test('迁移命令遇到坏配置时安全失败且不创建数据库', (t) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'teacher-operations-invalid-'));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));
  const databasePath = path.join(tempDir, 'teacher.sqlite');
  const marker = 'short-sensitive-marker';

  const result = runMigration(migrationEnvironment(databasePath, {
    SESSION_SECRET: marker,
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^Migration failed: invalid configuration\.\s*$/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(marker));
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /teacher\.sqlite/);
});

test('运维文档包含认证历史、Anaconda、HTTP 与服务器数据库提醒', () => {
  const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const readme = readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
  const envExample = readFileSync(path.join(projectRoot, '.env.example'), 'utf8');
  const gitignore = readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');

  assert.equal(packageJson.scripts.migrate, 'node scripts/migrate.js');
  assert.match(readme, /POST \/api\/auth\/login/);
  assert.match(readme, /POST \/api\/auth\/register/);
  assert.match(readme, /GET \/api\/history/);
  assert.match(readme, /\.conda/);
  assert.match(readme, /HTTP 无法加密凭据和 Cookie/);
  assert.match(readme, /DATABASE_PATH/);
  assert.match(readme, /SESSION_SECRET/);
  assert.match(readme, /SESSION_COOKIE_SECURE=false/);
  assert.match(readme, /\/opt\/apps\/teacher-data\/teacher\.sqlite/);
  assert.match(readme, /48 字节/);
  assert.match(readme, /部署前.*\.env/);
  assert.match(envExample, /^DATABASE_PATH=/m);
  assert.match(envExample, /^SESSION_SECRET=/m);
  assert.match(envExample, /^SESSION_COOKIE_SECURE=false$/m);
  for (const ignored of ['*.sqlite', '*.sqlite-wal', '*.sqlite-shm', '*.sqlite-journal']) {
    assert.match(gitignore, new RegExp(ignored.replaceAll('*', '\\*').replaceAll('.', '\\.')));
  }
});
