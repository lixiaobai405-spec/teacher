# Teacher Login and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute tasks sequentially because later authentication, history, and frontend tasks depend on earlier database and security boundaries.

**Goal:** 为 Teacher 增加开放注册、恢复码找回、SQLite 持久化 Session、按用户隔离的教练历史和完整导航，并消除第 3 步重复的 SBI 展示，同时保持现有四步教练业务与模型契约不变。

**Architecture:** 选择性移植 `D:\codex-pj\time` 中经过测试的 SQLite、`express-session`、`scrypt`、CSRF 和限流边界，但在 Teacher 内独立实现并使用自己的表名、Cookie 和 API 信封。Express 继续作为单进程 HTTP 服务；原生前端启动时恢复身份，方案生成后以稳定 `clientRecordId` 幂等同步历史。

**Tech Stack:** Node.js 20（项目专用 Anaconda 环境）、CommonJS 服务端、Express 5.2.1、Ajv 8.20.0、`express-session` 1.19.0、`sqlite3` 6.0.1、`express-rate-limit` 8.6.0、原生 HTML/CSS/JavaScript、Node test runner、Playwright 1.60.0

---

## 0. 执行边界

- 工作区固定为 `D:\codex-pj\teacher-login-history`。
- 分支固定为 `codex/login-history`，基线为 `544d3554e792fd71b1dc652a37fbd490ad6067d3`。
- 不读取真实 `.env`；测试只使用假密钥、假 Session Secret、`:memory:` 或临时 SQLite。
- 不修改 `prompts/system.md`、知识库、模型事实边界或四步业务契约。
- 自动化测试不得请求真实 DeepSeek API。
- 本地真实 API 验证、服务器部署和生产真实 API 验证分别需要用户单独批准。
- 不直接改写服务器 `server-preboundary-fd-frontend`；它保持为回退点。
- 不使用 `git add .`、`git add -A`、`git reset --hard`、`git clean`、`--no-verify` 或强制推送。
- 每次文件修改前说明范围；每次提交只显式暂存当前 Task 的文件。
- 全局 Git hooks 位于 `C:\Users\32159\.githooks`，所有提交必须正常触发并通过。

每个新 PowerShell 进程使用：

```powershell
$projectNodeBin = (Resolve-Path '.conda').Path
$env:PATH = "$projectNodeBin;$env:PATH"
& "$projectNodeBin\node.exe" --version
& "$projectNodeBin\npm.cmd" --version
```

每次提交前执行：

```powershell
git status --short
git --no-pager diff
git --no-pager diff --cached
git diff --cached --check
```

---

### Task 1: 建立项目专用 Anaconda Node 环境并锁定依赖

**Files:**

- Modify: `.gitignore`
- Create: `tests/server.dependency-compatibility.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [x] **Step 1: 先忽略项目环境和数据库产物**

向 `.gitignore` 追加：

```gitignore
.conda/
.conda-pkgs/
data/
*.sqlite
*.sqlite-wal
*.sqlite-shm
*.sqlite-journal
```

运行：

```powershell
git check-ignore .conda\placeholder data\teacher.sqlite
```

Expected: 两个路径都被 `.gitignore` 命中。

- [x] **Step 2: 创建项目专用 Anaconda 环境**

该步骤会联网下载 Node.js；执行前向用户说明影响。运行：

```powershell
conda create --prefix .\.conda -c conda-forge nodejs=20 -y
$projectNodeBin = (Resolve-Path '.conda').Path
$env:PATH = "$projectNodeBin;$env:PATH"
& "$projectNodeBin\node.exe" --version
& "$projectNodeBin\npm.cmd" --version
& "$projectNodeBin\npm.cmd" ci
```

Expected: Node 主版本为 20；依赖只安装到当前 worktree 的 `node_modules`。

- [x] **Step 3: 写依赖 RED 测试**

创建 `tests/server.dependency-compatibility.test.js`：

```js
const assert = require('node:assert/strict');
const test = require('node:test');

test('认证与 SQLite 依赖支持 Node 20 CommonJS', () => {
  assert.equal(Number(process.versions.node.split('.')[0]), 20);
  assert.equal(typeof require('express-session'), 'function');
  assert.equal(typeof require('express-rate-limit').rateLimit, 'function');
  assert.equal(typeof require('sqlite3').Database, 'function');
});
```

运行：

```powershell
& "$projectNodeBin\node.exe" --test tests/server.dependency-compatibility.test.js
```

Expected: RED，`MODULE_NOT_FOUND` 指向尚未安装的认证依赖。

- [x] **Step 4: 安装与参考项目一致的精确版本**

```powershell
& "$projectNodeBin\npm.cmd" install --save-exact express-session@1.19.0 sqlite3@6.0.1 express-rate-limit@8.6.0
& "$projectNodeBin\node.exe" --test tests/server.dependency-compatibility.test.js
```

Expected: GREEN；`package.json` 与 `package-lock.json` 同步更新。

- [x] **Step 5: 运行基线并提交**

```powershell
& "$projectNodeBin\npm.cmd" test
git add -- .gitignore package.json package-lock.json tests/server.dependency-compatibility.test.js docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "build: add authentication database dependencies"
```

Expected: 基线服务端和 Playwright 全部通过；不产生真实模型费用。

---

### Task 2: 配置校验、SQLite 连接与事务迁移

**Files:**

- Create: `server/config.js`
- Create: `server/database/sqlite.js`
- Create: `server/database/migrations.js`
- Create: `server/database/migrations/001-auth-history.js`
- Create: `tests/helpers/test-database.js`
- Create: `tests/server.database.test.js`
- Modify: `.env.example`
- Modify: `tests/start-script.test.js`
- Modify: `scripts/start.ps1`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [x] **Step 1: 写数据库与配置 RED**

测试必须覆盖 `WAL`、外键、5000ms busy timeout、迁移幂等、坏迁移事务回滚，以及以下配置：

```js
const config = loadConfig({
  DATABASE_PATH: ':memory:',
  SESSION_SECRET: 'test-session-secret-with-at-least-forty-eight-bytes-000',
  SESSION_COOKIE_SECURE: 'false',
  SESSION_MAX_AGE_MS: '604800000',
});
assert.equal(config.databasePath, ':memory:');
assert.equal(config.sessionCookieSecure, false);
assert.equal(config.sessionMaxAgeMs, 604_800_000);
```

运行：

```powershell
& "$projectNodeBin\node.exe" --test tests/server.database.test.js tests/start-script.test.js
```

Expected: RED，数据库和配置模块不存在。

- [x] **Step 2: 实现串行 SQLite 适配器**

`openDatabase({ filename, migrations })` 返回冻结对象：

```js
{
  run(sql, params),
  get(sql, params),
  all(sql, params),
  exec(sql),
  transaction(work),
  close(),
}
```

连接后执行：

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

所有公共操作进入同一 Promise 队列；事务使用 `BEGIN IMMEDIATE`，失败时 `ROLLBACK` 并原样抛出操作错误。

- [x] **Step 3: 创建迁移**

迁移 1 创建：

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  normalized_username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  recovery_code_hash TEXT NOT NULL,
  recovery_code_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX users_normalized_username_unique ON users(normalized_username);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  csrf_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX sessions_token_hash_unique ON sessions(token_hash);
CREATE INDEX sessions_user_id_index ON sessions(user_id);
CREATE INDEX sessions_expires_at_index ON sessions(expires_at);

CREATE TABLE coaching_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_record_id TEXT NOT NULL,
  title TEXT NOT NULL,
  intake_json TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  selected_profile_id TEXT NOT NULL,
  classification_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  feedback_text TEXT,
  feedback_json TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX coaching_records_user_client_unique
  ON coaching_records(user_id, client_record_id);
CREATE INDEX coaching_records_user_created_index
  ON coaching_records(user_id, created_at DESC);
```

`schema_migrations` 在迁移运行器中创建并按版本记录。

- [x] **Step 4: 更新环境模板和启动检查**

`.env.example` 只添加占位值：

```dotenv
DATABASE_PATH=./data/teacher.sqlite
SESSION_SECRET=fake-session-secret-change-me-48-bytes-minimum-000000
SESSION_COOKIE_SECURE=false
SESSION_MAX_AGE_MS=604800000
```

`start.ps1` 只检查变量是否存在和格式是否合理，不显示真实值。测试 fixture 使用假值。

- [x] **Step 5: 运行 GREEN 并提交**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.database.test.js tests/start-script.test.js
git add -- server/config.js server/database/sqlite.js server/database/migrations.js server/database/migrations/001-auth-history.js tests/helpers/test-database.js tests/server.database.test.js .env.example tests/start-script.test.js scripts/start.ps1 docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add SQLite migrations"
```

---

### Task 3: 用户名规则与用户 Repository

**Files:**

- Create: `server/auth/username.js`
- Create: `server/repositories/user-repository.js`
- Create: `tests/server.user-repository.test.js`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [x] **Step 1: 写规则 RED**

沿用 `time` 当前规则：

```js
assert.equal(validateUsername('  管理者_A1  '), '管理者_A1');
assert.equal(normalizeUsername('Alice'), 'Alice');
assert.notEqual(normalizeUsername('Alice'), normalizeUsername('alice'));
assert.throws(() => validateUsername('user-name'), error => error.code === 'INPUT_INVALID');
assert.throws(() => validateUsername('   '), error => error.code === 'INPUT_INVALID');
```

Repository 覆盖创建、大小写区分的唯一性、按用户名/ID 查询、凭据更新。

- [x] **Step 2: 运行 RED**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.user-repository.test.js
```

Expected: RED，模块不存在。

- [x] **Step 3: 实现规则与参数化 Repository**

核心规则：

```js
function validateUsername(value) {
  if (typeof value !== 'string') throw inputError();
  const display = value.trim();
  if (!/^[\p{Script=Han}A-Za-z0-9_]+$/u.test(display)) throw inputError();
  return display;
}
function normalizeUsername(value) {
  return validateUsername(value);
}
```

唯一索引冲突转换为 `AUTH_USERNAME_TAKEN`，不得暴露 SQL。

- [x] **Step 4: 运行 GREEN**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.user-repository.test.js
```

- [x] **Step 5: 提交**

```powershell
git add -- server/auth/username.js server/repositories/user-repository.js tests/server.user-repository.test.js docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add user repository"
```

---

### Task 4: scrypt 密码与恢复码原语

**Files:**

- Create: `server/security/semaphore.js`
- Create: `server/security/password.js`
- Create: `server/security/recovery-code.js`
- Create: `tests/server.password.test.js`
- Create: `tests/server.recovery-code.test.js`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [x] **Step 1: 写密码与恢复码 RED**

密码断言：

```js
assert.equal(validatePassword('六位密码ab', 'User'), '六位密码ab');
assert.throws(() => validatePassword('12345', 'User'), error => error.code === 'INPUT_INVALID');
assert.throws(() => validatePassword('User', 'User'), error => error.code === 'INPUT_INVALID');
assert.equal(await verifyPassword('正确密码1', await hashPassword('正确密码1')), true);
assert.equal(await verifyPassword('错误密码1', await hashPassword('正确密码1')), false);
```

恢复码断言：

```js
const code = generateRecoveryCode();
assert.match(code, /^(?:[0-9A-F]{4}-){11}[0-9A-F]{4}$/);
const stored = hashRecoveryCode(code);
assert.equal(verifyRecoveryCode(code, stored), true);
assert.equal(verifyRecoveryCode(code.replace(/[0-9A-F]/, '0'), stored), false);
```

- [x] **Step 2: 运行 RED**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.password.test.js tests/server.recovery-code.test.js
```

- [x] **Step 3: 实现固定密码格式与并发限制**

```js
const SCRYPT_OPTIONS = Object.freeze({
  N: 32768, r: 8, p: 3, maxmem: 128 * 1024 * 1024,
});
const SALT_BYTES = 16;
const KEY_BYTES = 64;
```

编码格式固定为：

```text
scrypt$v=1$N=32768$r=8$p=3$<salt-base64url>$<hash-base64url>
```

最多同时执行 2 个 scrypt；比较使用相同长度 Buffer 的 `timingSafeEqual()`。

- [x] **Step 4: 实现恢复码**

恢复码使用 24 个随机字节；明文只在注册、重置或轮换成功响应的局部变量中存在。数据库只保存 SHA-256 base64url 哈希。

- [x] **Step 5: 运行 GREEN 并提交**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.password.test.js tests/server.recovery-code.test.js
git add -- server/security/semaphore.js server/security/password.js server/security/recovery-code.js tests/server.password.test.js tests/server.recovery-code.test.js docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add password recovery primitives"
```

---

### Task 5: SQLite Session Repository 与 Store

**Files:**

- Create: `server/security/token-hash.js`
- Create: `server/repositories/session-repository.js`
- Create: `server/session/sqlite-session-store.js`
- Create: `tests/server.session-store.test.js`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [x] **Step 1: 写 Session RED**

覆盖 32 字节随机 Session ID、数据库只存哈希、`set/get/touch/destroy`、固定 7 天到期、过期读取删除和按用户撤销全部 Session：

```js
const rawSessionId = generateSessionId();
await invoke(store, 'set', rawSessionId, { userId, cookie: {} });
const row = await database.get(
  'SELECT token_hash, csrf_token_hash FROM sessions WHERE user_id = ?',
  [userId],
);
assert.notEqual(row.token_hash, rawSessionId);
assert.equal(row.token_hash, hashToken(rawSessionId));
```

- [x] **Step 2: 运行 RED**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.session-store.test.js
```

- [x] **Step 3: 实现 Repository**

固定接口：

```js
repository.upsert({ rawSessionId, userId, csrfTokenHash, sessionMaxAgeMs });
repository.findByToken(rawSessionId);
repository.touch(rawSessionId);
repository.destroyCurrent(rawSessionId);
repository.destroyAllForUser(transaction, userId);
repository.pruneExpired();
```

`touch()` 只更新 `last_seen_at`，不延长 `expires_at`。

- [x] **Step 4: 实现 `express-session` Store**

Store 继承 `session.Store`，只实现 `get`、`set`、`touch`、`destroy`。`get` 仅重建 `{ userId, cookie }`，不把数据库哈希返回浏览器。

- [x] **Step 5: 运行 GREEN 并提交**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.session-store.test.js
git add -- server/security/token-hash.js server/repositories/session-repository.js server/session/sqlite-session-store.js tests/server.session-store.test.js docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add SQLite session store"
```

---

### Task 6: Origin、CSRF 与认证限流

**Files:**

- Create: `server/http/problem.js`
- Create: `server/security/origin.js`
- Create: `server/security/csrf.js`
- Create: `server/auth/rate-limiters.js`
- Create: `tests/server.auth-security.test.js`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [x] **Step 1: 写安全 RED**

覆盖预登录 Token 的 HMAC、10 分钟到期、篡改拒绝；登录后 Token 与 Session ID 绑定；缺少/错误 `Origin` 或 `X-CSRF-Token` 返回 403；注册 5 次、登录 10 次、重置 5 次后返回 429。

统一错误对象：

```js
function httpProblem(code, message, status) {
  return Object.assign(new Error(message), { code, message, status, expose: true });
}
```

- [x] **Step 2: 运行 RED**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.auth-security.test.js
```

- [x] **Step 3: 实现同源与 CSRF**

预登录 Token：

```text
<issuedAt-base36>.<16-byte-nonce-base64url>.<HMAC-SHA256-base64url>
```

Session Token：

```js
createHmac('sha256', secret).update(`csrf:${sessionId}`, 'utf8').digest('base64url');
```

数据库只保存 Session CSRF Token 的 SHA-256 哈希。

- [x] **Step 4: 实现限流**

15 分钟窗口，键为规范化 IP 与区分大小写的用户名组合；响应：

```json
{"ok":false,"code":"AUTH_RATE_LIMITED","message":"尝试过于频繁，请稍后再试。"}
```

- [x] **Step 5: 运行 GREEN 并提交**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.auth-security.test.js
git add -- server/http/problem.js server/security/origin.js server/security/csrf.js server/auth/rate-limiters.js tests/server.auth-security.test.js docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: enforce authentication security"
```

---

### Task 7: 注册、登录、退出和当前用户 API

**Files:**

- Create: `server/auth/auth-service.js`
- Create: `server/auth/middleware.js`
- Create: `server/auth/router.js`
- Create: `server/runtime.js`
- Create: `tests/helpers/auth-client.js`
- Create: `tests/helpers/test-app.js`
- Create: `tests/helpers/test-auth-boundary.js`
- Create: `tests/server.auth-api.test.js`
- Modify: `server/app.js`
- Modify: `server/index.js`
- Modify: `tests/server.routes.test.js`
- Modify: `playwright.config.js`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [x] **Step 1: 写认证 API RED**

覆盖：

```text
GET  /api/auth/csrf
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

关键断言：

```js
assert.equal(register.status, 201);
assert.match(registerBody.recoveryCode, /-/);
assert.equal((await client.me()).status, 401);
assert.equal(login.status, 200);
assert.match(login.headers.get('set-cookie'), /teacher\.sid=/);
assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
assert.match(login.headers.get('set-cookie'), /SameSite=Strict/i);
assert.match(login.headers.get('set-cookie'), /Max-Age=604800/i);
assert.doesNotMatch(login.headers.get('set-cookie'), /Secure/i);
```

- [x] **Step 2: 运行 RED**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.auth-api.test.js tests/server.routes.test.js
```

- [x] **Step 3: 实现认证服务**

固定接口：

```js
authService.register({ username, password });
authService.login({ username, password });
```

未知用户名仍校验固定虚拟 scrypt 哈希。错误密码与未知用户统一返回：

```json
{"ok":false,"code":"AUTH_INVALID_CREDENTIALS","message":"用户名或密码不正确。"}
```

- [x] **Step 4: 组装运行时与路由**

Session 配置：

```js
{
  name: 'teacher.sid',
  secret: config.sessionSecret,
  genid: () => generateSessionId(),
  resave: false,
  saveUninitialized: false,
  rolling: false,
  store,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    path: '/',
    maxAge: 604_800_000,
  },
}
```

`GET /api/health` 保持公开。生产入口必须完整创建 `runtime`；测试通过显式 `createTestAuthBoundary()` 注入，不增加生产绕过开关。

- [x] **Step 5: 运行 GREEN 并提交**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.auth-api.test.js tests/server.routes.test.js
git add -- server/auth/auth-service.js server/auth/middleware.js server/auth/router.js server/runtime.js server/app.js server/index.js tests/helpers/auth-client.js tests/helpers/test-app.js tests/helpers/test-auth-boundary.js tests/server.auth-api.test.js tests/server.routes.test.js playwright.config.js docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add account authentication APIs"
```

---

### Task 8: 恢复码重置密码与轮换

**Files:**

- Modify: `server/auth/auth-service.js`
- Modify: `server/auth/router.js`
- Modify: `server/repositories/user-repository.js`
- Modify: `server/runtime.js`
- Create: `tests/server.recovery-api.test.js`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [x] **Step 1: 写恢复 API RED**

覆盖：

```text
POST /api/auth/password/reset-with-recovery
POST /api/auth/recovery-code/rotate
```

重置必须在同一事务中更新密码、轮换恢复码和版本，并删除该用户全部 Session；事务失败全部回滚。轮换接口要求有效 Session、CSRF 和当前密码，不撤销其他有效 Session。

- [x] **Step 2: 运行 RED**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.recovery-api.test.js tests/server.auth-api.test.js
```

- [x] **Step 3: 实现事务服务**

```js
authService.resetWithRecovery({ username, recoveryCode, newPassword });
authService.rotateRecoveryCode({ userId, password });
```

事务提交后才返回新明文恢复码。旧恢复码、旧密码和所有旧 Session 必须失效。

- [x] **Step 4: 运行 GREEN**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.recovery-api.test.js tests/server.auth-api.test.js
```

- [x] **Step 5: 提交**

```powershell
git add -- server/auth/auth-service.js server/auth/router.js server/repositories/user-repository.js server/runtime.js tests/server.recovery-api.test.js docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add recovery password reset"
```

---

### Task 9: 登录保护四步教练 API

**Files:**

- Modify: `server/app.js`
- Modify: `frontend/api.js`
- Verify unchanged: `tests/helpers/test-auth-boundary.js`
- Create: `tests/server.workflow-auth.test.js`
- Verify unchanged: `tests/server.routes.test.js`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [x] **Step 1: 写保护 RED**

未登录调用四条接口均返回 401 且不调用教练服务；登录后缺少/错误同源或 CSRF 返回 403；有效请求的业务请求体与成功响应不增删字段：

```js
for (const method of ['intake', 'classify', 'plan', 'feedback']) {
  const response = await anonymous.request(`/api/coach/${method}`, {
    method: 'POST',
    body: {},
  });
  assert.equal(response.status, 401);
}
assert.equal(coachCalls.length, 0);
```

- [x] **Step 2: 运行 RED**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.workflow-auth.test.js tests/server.routes.test.js
```

- [x] **Step 3: 统一路由顺序**

顺序固定为：

```text
安全响应头/请求 ID → 分路径 JSON 限制 → 公开 health → Session
→ 公开 auth → /api/coach requireAuth → unsafe-method 同源与 CSRF
→ 四步路由 → API 404 → 静态前端 → 安全错误处理
```

`frontend/api.js` 的所有教练 POST 自动携带内存中的 Session CSRF Token，不保存 Cookie 或 Token 到 Web Storage。

- [x] **Step 4: 运行 GREEN 与原业务回归**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.workflow-auth.test.js tests/server.routes.test.js tests/server.contracts.test.js tests/server.guardrails.test.js tests/server.coaching-methods.test.js
```

- [x] **Step 5: 提交**

```powershell
git add -- server/app.js frontend/api.js tests/server.workflow-auth.test.js docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: protect coaching APIs"
```

---

### Task 10: Teacher 历史契约与隔离 Repository

**Files:**

- Create: `server/history/contracts.js`
- Create: `server/history/cursor.js`
- Create: `server/repositories/history-repository.js`
- Create: `tests/helpers/history-fixture.js`
- Create: `tests/server.history-contracts.test.js`
- Create: `tests/server.history-repository.test.js`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [x] **Step 1: 写历史契约 RED**

请求快照固定为：

```js
{
  clientRecordId,
  intake: { role, tenure, performance, goal, pain, traits },
  answers: [{ question, answer }],
  selectedProfileId: 'A|B|C|D',
  classification,
  plan,
  feedbackText: null,
  feedback: null,
}
```

`classification`、`plan`、非空 `feedback` 必须复用 `server/contracts.js` 的验证函数；拒绝额外的 `userId`、`user_id`、标题、Cookie、Prompt 和调试字段。

- [x] **Step 2: 写 Repository RED**

覆盖首次保存、同一 `(userId, clientRecordId)` 更新原记录、游标分页、详情、删除、A/B 用户隔离和损坏 JSON 安全失败。标题由服务端生成，并固定使用服务器约定的上海时区：

```js
const date = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
}).format(new Date(timestamp));
const title = `${snapshot.intake.role} · ${date}`;
```

- [x] **Step 3: 运行 RED**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.history-contracts.test.js tests/server.history-repository.test.js
```

- [x] **Step 4: 实现严格验证、游标和所有权 SQL**

所有操作必须先验证 `userId`。更新 SQL 必须同时限定：

```sql
WHERE user_id = ? AND client_record_id = ?
```

列表默认 20、最大 50，排序为 `created_at DESC, id DESC`，游标编码 `{createdAt,id}`。`POST` 重试允许更新方案和反馈，但不得更改所有者、创建时间或记录 ID。

- [x] **Step 5: 运行 GREEN 并提交**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.history-contracts.test.js tests/server.history-repository.test.js
git add -- server/history/contracts.js server/history/cursor.js server/repositories/history-repository.js tests/helpers/history-fixture.js tests/server.history-contracts.test.js tests/server.history-repository.test.js docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add isolated coaching history"
```

---

### Task 11: 历史保存、列表、详情与删除 API

**Files:**

- Create: `server/history/router.js`
- Modify: `server/runtime.js`
- Modify: `server/app.js`
- Modify: `tests/helpers/test-auth-boundary.js`
- Create: `tests/server.history-api.test.js`
- Create: `tests/server.security.test.js`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [x] **Step 1: 写 API RED**

覆盖：

```text
POST   /api/history
GET    /api/history?cursor=&limit=
GET    /api/history/:id
DELETE /api/history/:id
```

断言首次保存 201，更新同一记录 200 且 ID 相同；列表不返回正文；详情只读；A 访问 B 与不存在记录都返回相同 404；删除要求同源和 CSRF。

- [x] **Step 2: 写安全错误 RED**

向 Repository 注入包含 `SQLITE_PRIVATE_MARKER`、数据库路径和员工正文的错误，断言响应不包含标记：

```js
assert.equal(response.status, 503);
assert.deepEqual(await response.json(), {
  ok: false,
  code: 'DATABASE_UNAVAILABLE',
  message: '历史数据库暂时不可用，请稍后重试。',
});
```

- [x] **Step 3: 运行 RED**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.history-api.test.js tests/server.security.test.js
```

- [x] **Step 4: 实现 Router**

Router 只从 `request.auth.userId` 获取用户，成功响应使用 Teacher 信封：

```js
response.status(created ? 201 : 200).json({ ok: true, data: item });
response.json({ ok: true, data: { items, nextCursor } });
response.status(204).end();
```

数据库异常只映射为稳定错误码，不把原错误传给客户端。

- [x] **Step 5: 运行 GREEN 并提交**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.history-api.test.js tests/server.security.test.js
git add -- server/history/router.js server/runtime.js server/app.js tests/helpers/test-auth-boundary.js tests/server.history-api.test.js tests/server.security.test.js docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add coaching history APIs"
```

---

### Task 12: 前端身份恢复、注册、登录与找回页面

**Files:**

- Create: `frontend/auth-ui.js`
- Modify: `frontend/api.js`
- Modify: `frontend/state.js`
- Modify: `frontend/app.js`
- Modify: `frontend/index.html`
- Modify: `frontend/styles.css`
- Create: `tests/auth-history.spec.js`
- Modify: `tests/frontend.spec.js`
- Modify: `playwright.config.js`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [x] **Step 1: 写 Playwright 认证 RED**

覆盖启动检查、注册、一次性恢复码、登录、刷新恢复、退出和恢复码重置。断言密码、恢复码和 CSRF 不进入 URL、`localStorage`、`sessionStorage` 或隐藏字段。

Playwright 测试服务器使用：

```js
testMatch: ['frontend.spec.js', 'auth-history.spec.js'],
env: {
  PORT: '4173',
  DEEPSEEK_API_KEY: 'test-only',
  DATABASE_PATH: ':memory:',
  SESSION_SECRET: 'playwright-session-secret-with-at-least-forty-eight-bytes',
  SESSION_COOKIE_SECURE: 'false',
  SESSION_MAX_AGE_MS: '604800000',
}
```

- [x] **Step 2: 运行 RED**

```powershell
& "$projectNodeBin\npx.cmd" playwright test tests/auth-history.spec.js --grep "注册|登录|刷新|退出|找回"
```

- [x] **Step 3: 实现 API 与状态**

状态增加：

```js
authReady: false,
screen: 'boot',
user: null,
csrfToken: null,
preAuthCsrfToken: null,
recoveryCode: null,
clientRecordId: null,
```

启动调用 `/api/auth/me`；401 时获取 `/api/auth/csrf` 并显示登录页。Token 只保存在内存对象中。

`tests/frontend.spec.js` 的既有 77 项场景通过统一 helper 显式 mock 已登录的 `/api/auth/me` 与 CSRF，不在生产代码增加绕过开关；`tests/auth-history.spec.js` 使用真实认证 API 和 `:memory:` SQLite。

- [x] **Step 4: 实现纯 DOM 认证页面**

`auth-ui.js` 导出：

```js
renderBoot();
renderLogin();
renderRegister();
renderRecovery();
renderRecoveryCode(recoveryCode);
```

所有用户和错误文本使用 `textContent`。登录后首页显示当前用户名、“开始辅导”“历史记录”“退出登录”，并提示自由文本不得填写真实姓名、工号或联系方式。

- [x] **Step 5: 运行 GREEN 并提交**

```powershell
& "$projectNodeBin\npx.cmd" playwright test tests/auth-history.spec.js --grep "注册|登录|刷新|退出|找回"
git add -- frontend/auth-ui.js frontend/api.js frontend/state.js frontend/app.js frontend/index.html frontend/styles.css tests/auth-history.spec.js tests/frontend.spec.js playwright.config.js docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add authentication user interface"
```

---

### Task 13: 前端历史自动同步、列表、详情和删除

**Files:**

- Create: `frontend/history-ui.js`
- Modify: `frontend/api.js`
- Modify: `frontend/state.js`
- Modify: `frontend/app.js`
- Modify: `frontend/views.js`
- Modify: `frontend/styles.css`
- Modify: `tests/auth-history.spec.js`
- Modify: `tests/frontend.spec.js`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [x] **Step 1: 写历史 Playwright RED**

覆盖：

```text
注册并登录 → 完成到方案 → 页面立即展示方案 → 自动保存
→ 历史列表 → 详情 → 换个角度更新同一记录 → 反馈更新同一记录
→ 两用户隔离 → 删除二次确认
```

保存失败时方案仍显示，并出现“结果已生成，历史保存失败”的可重试提示。

- [x] **Step 2: 运行 RED**

```powershell
& "$projectNodeBin\npx.cmd" playwright test tests/auth-history.spec.js --grep "历史|自动保存|用户隔离|删除"
```

- [x] **Step 3: 实现历史状态与快照**

状态固定为：

```js
historySync: { status: 'idle', id: null, message: '' },
historyItems: [],
historyCursor: null,
historyDetail: null,
workflowDirty: false,
```

开始新流程时设置 `clientRecordId = crypto.randomUUID()`。方案和反馈成功后先更新页面，再异步调用：

```js
await saveHistory({
  clientRecordId: session.clientRecordId,
  intake: session.intake,
  answers: session.answers,
  selectedProfileId: session.selectedProfileId,
  classification: finalClassification(),
  plan: session.plan,
  feedbackText: session.feedbackText || null,
  feedback: session.feedback,
});
```

开始填写员工信息、修改画像、修改反馈草稿或下游结果被清除时，将 `workflowDirty` 设为 `true`；历史同步成功后设为 `false`。同步失败保持 `true`。

- [x] **Step 4: 实现历史 UI**

`history-ui.js` 导出列表和详情渲染。列表只显示标题和时间；详情使用现有安全 Markdown renderer 渲染方案/反馈，原子字段使用 `textContent`。复制只复制方案正文；删除调用 `window.confirm()` 后发送 DELETE。

- [x] **Step 5: 运行 GREEN 并提交**

```powershell
& "$projectNodeBin\npx.cmd" playwright test tests/auth-history.spec.js --grep "历史|自动保存|用户隔离|删除"
git add -- frontend/history-ui.js frontend/api.js frontend/state.js frontend/app.js frontend/views.js frontend/styles.css tests/auth-history.spec.js tests/frontend.spec.js docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add coaching history interface"
```

---

### Task 14: 统一“上一步”、返回首页和未保存确认

**Files:**

- Modify: `frontend/app.js`
- Modify: `frontend/views.js`
- Modify: `frontend/state.js`
- Modify: `frontend/index.html`
- Modify: `frontend/styles.css`
- Modify: `tests/frontend.spec.js`
- Modify: `tests/auth-history.spec.js`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [x] **Step 1: 写导航 RED**

覆盖：

- 第 1 步“上一步”返回登录后首页。
- 第 2–4 步依次返回上一业务步骤。
- 顶部“返回首页”回登录后首页，不退出登录。
- 正在请求时先取消并隔离迟到响应。
- 方案尚未生成或历史同步失败时，“上一步”和“返回首页”都二次确认。
- 历史已同步时直接导航。
- 320px、375px 和桌面宽度无横向溢出。

- [x] **Step 2: 运行 RED**

```powershell
& "$projectNodeBin\npx.cmd" playwright test tests/frontend.spec.js tests/auth-history.spec.js --grep "上一步|返回首页|未保存|迟到响应|横向溢出"
```

- [x] **Step 3: 实现统一导航门卫**

```js
function hasUnsavedWorkflow() {
  return session.workflowDirty
    || session.historySync.status === 'saving'
    || session.historySync.status === 'failed';
}

function confirmUnsavedNavigation() {
  return !hasUnsavedWorkflow()
    || window.confirm('当前内容尚未保存，离开后将丢失。是否继续？');
}
```

`goPrevious()` 与 `returnHome()` 先执行门卫，再取消请求。第 1 步的 previous target 为登录后首页；返回首页重置工作流但保留 `user` 和 Session CSRF Token。

- [x] **Step 4: 更新文案与可访问性**

工作区顶部按钮保留 `aria-label="返回首页"`；每一步底部按钮使用 `aria-label="返回上一步"`。认证页隐藏工作区返回按钮；历史页提供明确的“返回首页/返回历史列表”。

- [x] **Step 5: 运行 GREEN 并提交**

```powershell
& "$projectNodeBin\npx.cmd" playwright test tests/frontend.spec.js tests/auth-history.spec.js --grep "上一步|返回首页|未保存|迟到响应|横向溢出"
git add -- frontend/app.js frontend/views.js frontend/state.js frontend/index.html frontend/styles.css tests/frontend.spec.js tests/auth-history.spec.js docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: unify authenticated navigation"
```

---

### Task 14A: 隐藏“话术示例”中重复的 SBI 展示

**Files:**

- Modify: `frontend/views.js`
- Modify: `tests/frontend.spec.js`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [x] **Step 1: 写展示去重 RED**

构造同时包含 GROW 和 SBI 阶段的 `plan.scripts` fixture，并断言：

- `#plan-scripts` 仍显示 Goal、Reality、Options、Will。
- `#plan-scripts` 不显示 Situation、Behavior、Impact 及其对应正文。
- `#plan-gap-fix` 仍完整显示 Situation、Behavior、Impact。
- 页面仍无横向溢出，底部操作栏保持可见。

测试只检查两个模块各自的内容，不再使用 `#coach-plan` 的全局文本断言，以免重复展示被误判为正确。

- [x] **Step 2: 运行 RED**

```powershell
& "$projectNodeBin\npx.cmd" playwright test tests/frontend.spec.js --grep "话术示例隐藏重复 SBI"
```

Expected: FAIL，`#plan-scripts` 当前仍包含 Situation、Behavior、Impact。

- [x] **Step 3: 实现仅限展示层的阶段过滤**

在 `frontend/views.js` 增加标签感知的展示过滤，仅在渲染 `#plan-scripts` 前移除完整的 SBI 阶段及其正文，然后继续使用现有 Markdown 安全渲染和阶段分段逻辑。不得用模糊的全文替换误删普通话术，也不得修改：

- `prompts/system.md`
- `server/contracts.js`
- `server/coach-service.js`
- 教练 API 响应
- `state.plan` 原始数据
- 写入历史记录的方案快照

`#plan-gap-fix` 不经过该过滤，继续展示完整 SBI。

- [x] **Step 4: 运行 GREEN 与相关回归**

```powershell
& "$projectNodeBin\npx.cmd" playwright test tests/frontend.spec.js --grep "话术示例隐藏重复 SBI|GROW 和 SBI|桌面完整 GROW SBI"
```

Expected: GREEN。若既有测试假设 `#plan-scripts` 展示 SBI，只把断言收窄到正确模块，不降低 `#plan-gap-fix` 的 SBI 覆盖。

- [x] **Step 5: 提交**

```powershell
git add -- frontend/views.js tests/frontend.spec.js docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "fix: hide duplicate SBI in plan scripts"
```

---

### Task 15: 运维脚本、环境说明和交付文档

**Files:**

- Create: `scripts/migrate.js`
- Create: `tests/server.operations.test.js`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `docs/adversarial-review.md`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [ ] **Step 1: 写运维与文档 RED**

测试 `npm run migrate` 成功创建结构、坏配置返回非零；文档必须包含认证接口、历史接口、Anaconda 环境、HTTP 风险、数据库位置和部署提醒：

```js
assert.match(readme, /DATABASE_PATH/);
assert.match(readme, /SESSION_SECRET/);
assert.match(readme, /SESSION_COOKIE_SECURE=false/);
assert.match(readme, /\/opt\/apps\/teacher-data\/teacher\.sqlite/);
```

- [ ] **Step 2: 运行 RED**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.operations.test.js
```

- [ ] **Step 3: 实现迁移命令**

`scripts/migrate.js` 只加载配置、打开数据库触发迁移、关闭数据库并输出不含路径或密钥的成功标记。新增：

```json
"migrate": "node scripts/migrate.js"
```

- [ ] **Step 4: 更新文档**

README 明确：

- 本地使用 `.conda` Node 环境。
- 服务器继续 HTTP，因此 `SESSION_COOKIE_SECURE=false`。
- HTTP 无法加密凭据和 Cookie。
- 部署前必须修改服务器 `.env`。
- `DATABASE_PATH=/opt/apps/teacher-data/teacher.sqlite`，不得指向代码 worktree。
- `SESSION_SECRET` 必须为服务器独立生成的 48 字节以上随机值。
- 数据库、WAL/SHM、日志和密钥不得提交。

- [ ] **Step 5: 运行 GREEN 并提交**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.operations.test.js tests/start-script.test.js
git add -- scripts/migrate.js tests/server.operations.test.js package.json .env.example .gitignore README.md docs/adversarial-review.md docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "docs: add authenticated SQLite operations"
```

---

### Task 16: 完整安全审计与本地交付验证

**Files:**

- Modify: `tests/server.security.test.js`
- Modify: `tests/auth-history.spec.js`
- Modify: `docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md`

- [ ] **Step 1: 补齐最终安全 RED**

使用不同标记注入用户名、密码、恢复码、原始 Session、CSRF、员工正文和 SQLite 错误。断言 API 响应、日志和前端存储不包含敏感标记；直接查询临时数据库，确认只存在预期哈希和所属用户历史。

- [ ] **Step 2: 运行定向安全测试**

```powershell
& "$projectNodeBin\node.exe" --test tests/server.password.test.js tests/server.recovery-code.test.js tests/server.session-store.test.js tests/server.auth-security.test.js tests/server.auth-api.test.js tests/server.recovery-api.test.js tests/server.workflow-auth.test.js tests/server.history-contracts.test.js tests/server.history-repository.test.js tests/server.history-api.test.js tests/server.security.test.js
& "$projectNodeBin\npx.cmd" playwright test tests/auth-history.spec.js
```

Expected: 全部 GREEN；若有失败，只做对应安全边界的最小修复。

- [ ] **Step 3: 运行全部正式测试**

```powershell
& "$projectNodeBin\npm.cmd" run test:server
& "$projectNodeBin\npm.cmd" run test:e2e
& "$projectNodeBin\npm.cmd" test
git diff --check
git status --short --branch
```

Expected: 原有 154 项回归和全部新增测试通过；无真实模型请求。

- [ ] **Step 4: 检查 Git 范围与 hooks**

```powershell
git config --get core.hooksPath
git status --short
git --no-pager diff
git log --oneline --decorate -25
Get-ChildItem -Recurse -Force -File |
  Where-Object { $_.Name -match '\.sqlite($|-wal$|-shm$|-journal$)' } |
  Select-Object FullName
```

Expected: 只存在被忽略的测试临时产物或无结果；没有 `.env`、数据库、日志或密钥进入 Git。

- [ ] **Step 5: 更新勾选状态并提交最终证据**

```powershell
git add -- tests/server.security.test.js tests/auth-history.spec.js docs/agent-plans/2026-07-23-teacher-login-history-implementation-plan.md
git diff --cached --check
git commit -m "test: verify authenticated history workflow"
```

如果 Step 2 产生最小实现修复，必须根据 `git status --short` 把实际文件逐个加入上面的显式 `git add --`，不得使用目录通配。

- [ ] **Step 6: 推送前审计**

```powershell
git status --short --branch
git log --oneline --decorate -25
git diff 544d3554e792fd71b1dc652a37fbd490ad6067d3...HEAD --check
```

本地全部验证通过后，汇报精确测试数量和风险，获得用户同意后再推送 `codex/login-history`。不得在此 Task 中部署服务器或调用真实模型。

---

## 后续独立部署阶段

本实现计划只交付本地验证通过、可推送的开发分支。服务器部署必须在推送后重新只读检查实时的 systemd unit、Node/NVM 路径、磁盘、npm registry、端口和当前提交，再生成或更新精确部署步骤。

部署开始前必须再次提醒用户：

```dotenv
DATABASE_PATH=/opt/apps/teacher-data/teacher.sqlite
SESSION_SECRET=<服务器独立生成并仅保存在服务器的高强度随机值>
SESSION_COOKIE_SECURE=false
SESSION_MAX_AGE_MS=604800000
```

其中 `DATABASE_PATH` 必须使用代码 worktree 之外的持久目录。候选 worktree 测试通过后，仍需用户单独批准 systemd 切换；生产真实 DeepSeek 验证需再单独批准。

---

## Self-review

- [x] **Spec coverage:** Task 1–11 覆盖 Anaconda 环境、依赖、SQLite、迁移、用户、密码、恢复码、Session、CSRF、限流、认证 API、教练 API 保护、历史契约/API和严格用户隔离。
- [x] **Frontend coverage:** Task 12–14A 覆盖身份恢复、开放注册、恢复码找回、登录后首页、历史自动同步、列表、详情、删除、四步上一步、顶部返回首页、未保存确认、移动端，以及第 3 步“话术示例”隐藏重复 SBI、`绩效差距修正方法`保留 SBI。
- [x] **Privacy coverage:** 历史不包含姓名等新增身份字段；标题由服务端生成；凭据和 Token 只保存哈希；不使用 Web Storage；错误和日志不泄露正文。
- [x] **Operations coverage:** Task 15–16 覆盖环境变量、迁移、HTTP 已知风险、服务器独立数据库路径、完整回归、hooks、Git 范围和推送前审计。
- [x] **Interface consistency:** JavaScript 使用 `clientRecordId`/`userId`，SQLite 使用 `client_record_id`/`user_id`；Cookie 始终为 `teacher.sid`；Session 固定 7 天；用户名区分大小写。
- [x] **Placeholder scan:** 实现任务中的文件、接口、命令、错误码、Cookie、数据库列、测试入口和提交信息均已明确；服务器 Secret 示例是安全部署占位符，不是实现遗漏，也不得写入仓库或响应。
