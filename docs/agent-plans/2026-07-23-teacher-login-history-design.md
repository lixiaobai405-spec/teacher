# Teacher 登录与历史记录设计

## 状态

- [x] 用户批准数据库、认证、历史记录、导航、安全、测试与部署方向
- [x] 开发基线确认为服务器当前版本对应的提交
- [ ] 用户审阅本文档
- [ ] 审阅通过后编写实现计划

## 1. 开发基线与交付边界

- GitHub 仓库：`lixiaobai405-spec/teacher`
- 开发分支：`codex/login-history`
- 开发 worktree：`D:\codex-pj\teacher-login-history`
- 基线提交：`544d3554e792fd71b1dc652a37fbd490ad6067d3`
- 基线来源：服务器当前 `server-preboundary-fd-frontend` 所对应的代码版本
- 服务器回退分支：`server-preboundary-fd-frontend`
- 服务器回退提交：`544d3554e792fd71b1dc652a37fbd490ad6067d3`

开发不得基于 `main`，不得直接改写或强推当前服务器分支。功能先在隔离 worktree 中开发和测试，再推送新分支；服务器使用候选 worktree 验证，获得单独部署批准后才能切换 `teacher` systemd 服务。

## 2. 目标

本期新增：

1. 开放注册。
2. 用户登录与退出。
3. 当前用户身份恢复。
4. 恢复码找回密码。
5. SQLite 持久化用户、Session 和教练历史。
6. 历史列表、详情和删除。
7. 严格的用户数据隔离。
8. 登录后才允许调用教练 API。
9. 四步工作流的“上一步”和顶部“返回首页”一致行为。

现有四步教练流程、模型契约、提示词、事实边界和高风险人事拦截逻辑必须保持不变。

## 3. 非目标

本期不实现：

- PostgreSQL 或多实例数据库。
- 第三方 OAuth、企业单点登录或管理员后台。
- 邮箱、短信或人工客服找回密码。
- “记住登录”复选框。
- 历史记录自动过期。
- 历史记录文件导出。
- 草稿工作流跨刷新恢复。
- 员工姓名、工号、手机号、邮箱等身份字段。
- React、Vue 或其他新前端框架。
- HTTPS 改造。

## 4. 已确认的产品决策

### 4.1 账号规则

沿用 `D:\codex-pj\time` 的当前规则：

- 用户名去除首尾空格后不能为空。
- 用户名只允许中文、ASCII 英文字母、数字和下划线。
- 用户名区分大小写。
- 不设置应用级用户名长度上限。
- 密码至少包含 6 个 Unicode 字符。
- 密码不能与用户名相同。

注册成功后生成一次性展示的恢复码。用户确认已保存后返回登录页。密码找回成功后生成新恢复码，并撤销该账号的全部旧 Session。

### 4.2 Session

- 不提供“记住登录”复选框。
- 所有登录 Session 固定保留 7 天。
- 退出、密码重置或到期后 Session 失效。
- 登录成功时重新生成 Session ID，防止 Session Fixation（会话固定攻击）。

### 4.3 历史记录

- 历史不自动过期，由记录所属用户主动删除。
- 第一版不提供文件导出。
- 第 3 步方案首次生成成功后自动创建历史。
- 重新生成方案和第 4 步反馈成功后更新同一条历史。
- 保存失败不隐藏当前结果，但必须提示“结果已生成，历史保存失败”。
- 历史详情只读，删除前二次确认。

### 4.4 隐私

- 不新增员工姓名、工号、手机号或邮箱字段。
- 页面提示用户不要在自由文本中输入真实身份信息。
- 历史标题由岗位类别和创建时间生成，不使用员工姓名。
- 不自动识别人名，避免误删正常业务文本。
- 不保存 API Key、Cookie、Session Secret、系统提示词或模型调试日志。

## 5. 推荐架构

选择性移植 `time` 项目中经过测试的认证基础设施，并按 Teacher 的命名、接口和数据契约独立实现。两个项目之间不得形成运行时文件引用。

新增依赖：

- `sqlite3`
- `express-session`
- `express-rate-limit`

继续使用 Node.js 内置 `crypto.scrypt` 完成密码慢哈希，不额外引入密码库。

建议新增或拆分的服务端边界：

- `server/config.js`：校验数据库和 Session 环境变量。
- `server/runtime.js`：组装数据库、仓储、Session Store 和路由。
- `server/database/`：SQLite 连接和版本化迁移。
- `server/auth/`：账号规则、认证服务、路由、middleware 和限流。
- `server/security/`：密码、恢复码、Token 哈希、CSRF 和同源校验。
- `server/session/`：SQLite Session Store。
- `server/history/`：历史契约、路由和分页游标。
- `server/repositories/`：用户、Session 和历史数据访问。

`server/app.js` 保持 Express 路由组合职责，`server/coach-service.js`、模型客户端、提示词加载和业务契约不因认证功能而改变。

## 6. 数据模型

### 6.1 `users`

字段：

- `id`
- `username`
- `normalized_username`
- `password_hash`
- `recovery_code_hash`
- `recovery_code_version`
- `created_at`
- `updated_at`

用户名保持大小写，因此 `normalized_username` 与校验后的展示用户名一致，并设置唯一索引。

### 6.2 `sessions`

字段：

- `id`
- `user_id`
- `token_hash`
- `csrf_token_hash`
- `created_at`
- `expires_at`
- `last_seen_at`

数据库不得保存原始 Session ID 或原始 CSRF Token。`user_id` 使用外键并启用级联删除。

### 6.3 `coaching_records`

字段：

- `id`
- `user_id`
- `client_record_id`
- `title`
- `intake_json`
- `answers_json`
- `selected_profile_id`
- `classification_json`
- `plan_json`
- `feedback_text`
- `feedback_json`
- `schema_version`
- `created_at`
- `updated_at`

对 `(user_id, client_record_id)` 设置唯一约束。前端对同一工作流重复保存时执行所有权限定的更新，避免网络重试生成重复记录。

历史数据必须在写入前通过严格数据契约校验。存储结构带 `schema_version`，以支持未来迁移。

### 6.4 `schema_migrations`

记录已执行的迁移版本和执行时间。迁移必须按事务运行，失败时不得留下部分结构。

## 7. API 设计

### 7.1 认证接口

- `GET /api/auth/csrf`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/password/reset-with-recovery`
- `POST /api/auth/recovery-code/rotate`

注册、登录和找回密码使用登录前 CSRF Token。登录后的退出和恢复码轮换使用 Session CSRF Token。

### 7.2 历史接口

- `GET /api/history`
- `POST /api/history`
- `GET /api/history/:id`
- `DELETE /api/history/:id`

`POST /api/history` 以 `(user_id, client_record_id)` 为幂等边界：首次保存返回 `201`，同一用户同一工作流的后续同步返回 `200` 并更新允许变更的字段。

列表使用游标分页，只返回 ID、标题和时间戳。详情接口返回通过历史契约解码的完整只读快照。

### 7.3 教练接口保护

以下接口全部要求有效登录：

- `POST /api/coach/intake`
- `POST /api/coach/classify`
- `POST /api/coach/plan`
- `POST /api/coach/feedback`

所有写接口还必须通过同源检查和 Session CSRF 校验。`GET /api/health` 保持匿名可访问。

## 8. 前端页面与状态

新增页面状态：

- 启动检查
- 登录
- 注册
- 恢复码展示
- 恢复码找回密码
- 登录后首页
- 四步教练工作流
- 历史列表
- 历史详情

启动时调用 `GET /api/auth/me`：

- Session 有效时进入登录后首页。
- Session 无效或不存在时进入登录页。
- 网络或服务异常时显示可重试的安全错误，不误报为密码错误。

登录后首页提供：

- 开始辅导
- 历史记录
- 当前用户名
- 退出登录

历史详情只读，支持复制方案和删除记录，不提供文件导出。

## 9. 历史同步流程

1. 开始新工作流时创建 `clientRecordId`。
2. 第 3 步方案生成成功后提交完整历史快照。
3. 保存成功后记录服务端历史 ID，并把页面标记为已同步。
4. 重新生成方案后使用同一 `clientRecordId` 更新原记录。
5. 第 4 步反馈生成成功后再次更新原记录。
6. 保存失败时保留当前结果并显示重试提示。
7. 刷新后不恢复草稿工作流，但登录状态和已保存历史可以恢复。

历史保存请求不得包含模型请求头、系统提示词、原始模型调试响应或任何服务器配置。

## 10. 导航设计

现有基线已具备步骤 2–4 的“上一步”以及顶部和工作区“返回首页”。本期在认证与首页状态引入后统一语义：

- 第 1 步“上一步”返回登录后首页。
- 第 2 步返回第 1 步。
- 第 3 步返回第 2 步。
- 第 4 步返回第 3 步。
- 顶部“返回首页”从任何工作流步骤返回登录后首页。
- 历史列表和详情使用页面内返回导航。

离开工作流前：

- 取消进行中的请求并使迟到响应失效。
- 如果第 3 步方案尚未生成，或历史同步失败导致当前结果未保存，弹出二次确认。
- 已成功同步历史时直接返回。

## 11. 安全设计

- 密码使用 `time` 当前的 `scrypt` 参数、随机盐和并发限制。
- 未知用户名仍执行一次虚拟密码哈希校验，降低账号枚举风险。
- 登录失败统一返回“用户名或密码不正确”。
- Cookie 名称使用 `teacher.sid`。
- Cookie 设置 `HttpOnly`、`SameSite=Strict`、`Path=/`。
- 服务器继续使用 HTTP，因此 `SESSION_COOKIE_SECURE=false`。
- HTTP 无法防止用户名、密码和 Cookie 在传输途中被截获；这是已知且被接受的部署风险，未来开放到不可信网络时应升级 HTTPS。
- 注册、登录、找回密码和恢复码操作设置限流。
- 登录前变更使用签名 CSRF Token，登录后变更使用与 Session 绑定的 CSRF Token。
- 所有历史 SQL 的查询、更新和删除条件必须包含当前 `user_id`。
- 访问他人记录与记录不存在统一返回 404，避免记录枚举。
- SQLite 错误响应不得包含 SQL、数据库路径、密码、Session 或员工内容。
- API 响应继续设置 `Cache-Control: no-store`，并增加必要的安全响应头。
- 认证、教练和历史请求体使用分别适配的大小限制。

## 12. 错误响应

统一使用安全错误结构：

```json
{
  "ok": false,
  "code": "ERROR_CODE",
  "message": "面向用户的安全提示"
}
```

主要状态码：

- `400`：请求结构或字段无效。
- `401`：未登录或凭据无效。
- `403`：CSRF 或同源校验失败。
- `404`：接口或所属历史不存在。
- `409`：用户名已存在。
- `413`：请求体过大。
- `429`：请求过于频繁。
- `500`：不可公开的内部错误。
- `503`：数据库或外部服务暂不可用。

## 13. 测试策略

采用 TDD（测试驱动开发）：先添加失败测试，再写最小实现，通过后运行全部回归。

服务端至少覆盖：

- 注册成功、用户名冲突和账号字段校验。
- 正确登录、错误密码和未知用户统一响应。
- 登录时 Session ID 轮换。
- 退出后 Session 失效。
- Session 固定 7 天并可跨页面刷新恢复。
- 恢复码仅保存哈希。
- 密码找回撤销全部旧 Session 并生成新恢复码。
- 未登录访问四个教练接口返回 401。
- 登录前和登录后 CSRF、防跨来源请求。
- 登录限流和安全错误。
- 历史首次创建、同一 `clientRecordId` 更新和分页。
- 两个用户之间无法读取、更新或删除对方记录。
- 无效历史数据拒绝写入。
- SQLite 异常不泄露内部信息。
- 数据库中不出现原始密码、恢复码、Session ID 或 CSRF Token。

Playwright 至少覆盖：

- 启动时恢复登录状态。
- 注册、恢复码展示、登录、退出和找回密码。
- 登录后首页与历史入口。
- 未登录不能进入教练工作区。
- 方案生成后自动保存历史。
- 重新生成方案和反馈更新同一历史。
- 历史列表、详情和删除。
- 第 1–4 步“上一步”和顶部“返回首页”。
- 未保存离开确认、请求取消和迟到响应隔离。
- 320px、375px 和桌面尺寸下无横向溢出。
- 原有四步流程、模型契约渲染和安全拦截回归保持通过。

自动化测试不得发送真实 DeepSeek 请求。运行本地真实模型 API 验证前必须再次获得用户批准。

## 14. 本地开发流程

1. 在 `codex/login-history` 隔离 worktree 中工作。
2. 每个功能按测试先行的小步提交推进。
3. 不覆盖其他 worktree 或用户已有修改。
4. 依赖变化同步更新 `package.json` 和 `package-lock.json`。
5. 新环境变量只向 `.env.example` 添加占位说明。
6. 数据库文件、备份、日志、Cookie 和密钥全部排除在 Git 之外。
7. 运行后端依赖安装、服务或测试前，按用户全局约束先确认使用 Docker 还是 Anaconda。
8. 完成后检查 `git status`、`git diff`、hooks 和全部自动化测试。
9. 推送 `codex/login-history`，不修改 `main`。

## 15. 服务器部署与回退

服务器继续使用：

- systemd 服务：`teacher`
- Node 直连端口：`4173`
- Nginx 对外端口：`4175`
- HTTP

候选部署流程：

1. 检查服务器磁盘资源、npm registry 和现有服务状态。
2. 从新开发分支创建服务器候选 worktree。
3. 新增依赖前先验证 `registry.npmjs.org`；如果仍不可用，再按批准方案使用 `https://registry.npmmirror.com`。
4. 在候选环境运行迁移和不产生模型费用的自动化测试。
5. 获得用户部署批准后，更新 systemd 工作目录并重启 `teacher`。
6. 验证 `/api/health`、登录、用户隔离、历史记录、端口、日志和 `NRestarts`。
7. 生产真实模型验证必须再次单独获得用户批准。

### 15.1 部署前必须提醒用户的 `.env` 变更

部署前必须明确提醒用户更新服务器 `.env`，至少包含：

```dotenv
DATABASE_PATH=/opt/apps/teacher-data/teacher.sqlite
SESSION_SECRET=<服务器独立生成的高强度随机值>
SESSION_COOKIE_SECURE=false
SESSION_MAX_AGE_MS=604800000
```

不得把本地数据库路径、测试 Session Secret 或占位值带到服务器。

服务器数据库必须使用独立持久目录，例如：

```text
/opt/apps/teacher-data/teacher.sqlite
```

该路径不得位于候选代码 worktree 内，避免切换版本时丢失数据。目录和数据库文件只授予运行 `teacher` 服务所需的最小权限。

### 15.2 回退

- 保留 `server-preboundary-fd-frontend` 和提交 `544d3554...`。
- 新迁移只新增独立数据库文件和表，不修改旧版教练业务数据。
- 如果候选版本异常，将 systemd 工作目录切回旧代码并重启服务。
- 回退旧代码时保留 SQLite 数据文件，不删除、不覆盖；旧版不会读取该数据库。

## 16. 验收标准

- [ ] 未登录无法调用任何教练或历史接口。
- [ ] 注册、登录、退出、身份恢复和恢复码找回完整可用。
- [ ] Session 跨刷新恢复，固定 7 天，无“记住登录”复选框。
- [ ] 历史在方案阶段创建，在重新生成和反馈阶段更新同一记录。
- [ ] 用户只能访问和删除自己的历史。
- [ ] 历史不自动过期，不提供文件导出。
- [ ] 四步“上一步”和顶部“返回首页”符合已批准语义。
- [ ] 未保存离开有二次确认，进行中请求会取消。
- [ ] 不保存或泄露密钥、Cookie、原始 Session、系统提示词和不必要身份信息。
- [ ] 原有自动化测试及新增测试全部通过。
- [ ] 本地真实 API 与生产真实 API 均只在单独批准后执行。
- [ ] 部署前已提醒用户更新服务器 `.env` 和独立 `DATABASE_PATH`。
- [ ] 服务器候选验证通过后才切换 systemd，并保留可验证回退点。
