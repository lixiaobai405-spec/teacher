# 教练助手（teacher）

面向管理者的团队辅导智能体。它先收集员工的能力与意愿证据，再按知识库完成类型判定，随后用 GROW/SBI 组织辅导方案，并把方案与反馈保存到当前登录用户的历史记录。

## 当前状态

- 前端由 Node 服务提供，并通过同源 `/api` 调用教练流程接口。
- 支持开放注册、登录、退出、当前身份查询，以及一次性展示的恢复码找回密码。
- 认证使用服务端持久化 Session（会话）与 HttpOnly Cookie；Session 固定 7 天，没有“记住登录”选项。
- SQLite 持久化用户、Session 和教练历史；历史不自动过期，由所属用户主动删除。
- Markdown 解析器已固定版本并随项目离线打包，预览时不请求 CDN。
- `prompts/system.md` 与 `knowledge/ability-willingness-grid.md` 是当前 v2 运行真源。
- `tests/prompt-cases.md` 是提示词行为验收集；服务端单元测试与 Playwright 端到端测试分别覆盖接口边界和前端流程。

## 目录

```text
teacher/
├─ frontend/                               # 前端页面、样式与 Markdown 渲染
├─ frontend/markdown-renderer.js          # 模型自由文本的安全渲染边界
├─ frontend/vendor/markdown-it.min.js     # 固定版本的离线解析器
├─ server/                                 # Express API 与教练服务
├─ server/database/                        # SQLite 连接、版本化 migration（迁移）
├─ scripts/migrate.js                      # 独立数据库迁移命令
├─ scripts/start.ps1                       # PowerShell 一键启动脚本
├─ prompts/system.md                      # v2 全流程提示词
├─ knowledge/ability-willingness-grid.md  # 能力×意愿知识库（单一事实源）
├─ tests/                                 # 服务端与前端自动化测试
└─ docs/legacy-combined.md                # 旧版合并稿，仅供追溯
```

`docs/legacy-combined.md` 缺少 v2 新增的 D1/D2 区分、GROW/SBI 与合并知识库规则，不得用于生产配置。

## 本地启动

本项目后端也是 Node.js/Express，不是 Python 后端。为避免污染系统环境，本地使用项目专用 Anaconda 环境 `.conda` 提供 Node.js 20：

```powershell
conda create --prefix .\.conda -c conda-forge nodejs=20 -y
$projectNodeBin = (Resolve-Path '.conda').Path
$env:PATH = "$projectNodeBin;$env:PATH"
```

首次使用时，在本目录执行：

```powershell
Copy-Item .env.example .env
# 修改 .env 中的本机 API 密钥和 SESSION_SECRET 占位值
& "$projectNodeBin\npm.cmd" install
& "$projectNodeBin\npm.cmd" run migrate
./scripts/start.ps1
```

完成首次配置后，也可以直接双击项目根目录的 `start.bat`。该入口会复用同一份 PowerShell 启动逻辑，并自动处理当前进程的执行策略。

`./scripts/start.ps1` 会检查 Node.js、`.env`、`node_modules` 和配置端口。启动成功后，Node 服务在当前终端前台运行并持续显示日志；请保持终端打开。关闭该终端或按 `Ctrl+C` 会停止本次启动的服务并释放端口。

如果 `.env` 配置的端口已经被其他程序占用，脚本会安全退出并保留原进程，不会复用或强制终止端口占用者。请先关闭原程序，或修改 `.env` 中的 `PORT` 后重试。

只在本机的 `.env` 中填写 `DEEPSEEK_API_KEY` 和随机生成的 `SESSION_SECRET`；该文件已被 Git 忽略，不要提交或在文档中粘贴真实密钥。`SESSION_SECRET` 至少 48 字节。服务启动后访问 `http://127.0.0.1:4173/`。

不希望自动打开浏览器时：

```powershell
./scripts/start.ps1 -NoBrowser
```

只检查启动前置条件、但不启动服务时：

```powershell
./scripts/start.ps1 -CheckOnly
```

## 教练 API 流程

页面按以下四步调用同源 API；全部接口都要求已登录，并校验当前 Session、同源请求和 CSRF Token。每一步只传递所需的结构化字段，并校验返回数据：

1. `POST /api/coach/intake`：审查员工资料是否足以进入评估，并生成需要补充的问题。
2. `POST /api/coach/classify`：按能力 × 意愿证据完成类型判定，或返回待补充/待人工确认状态。
3. `POST /api/coach/plan`：根据判定生成 GROW/SBI 辅导方案；重新生成会携带上一次方案。
4. `POST /api/coach/feedback`：基于辅导反馈给出下一步建议。

运行状态可通过 `GET /api/health` 检查。

## 认证与历史 API

认证接口：

- `GET /api/auth/csrf`：获取登录、注册和找回密码所需的预认证 CSRF Token。
- `POST /api/auth/register`：开放注册；成功后只展示一次恢复码，不自动登录。
- `POST /api/auth/login`：登录并创建固定 7 天的持久 Session。
- `POST /api/auth/logout`：撤销当前 Session。
- `GET /api/auth/me`：查询当前用户身份并返回 Session CSRF Token。
- `POST /api/auth/recover`：使用用户名、恢复码和新密码重置凭据，同时撤销该用户全部旧 Session。

历史接口均按当前用户 ID 过滤，不能读取或删除其他用户的数据：

- `GET /api/history`：按游标分页列出标题和时间。
- `POST /api/history`：按 `clientRecordId` 新建或更新当前辅导记录。
- `GET /api/history/:id`：读取自己的只读历史详情。
- `DELETE /api/history/:id`：主动删除自己的记录。

历史只保存必要的员工输入、最终画像、判定摘要、方案和反馈；不保存 API Key、Cookie、Session Secret、恢复码、系统提示词或完整模型调试日志。用户名和恢复码用于账号恢复，不应当填写员工姓名等额外身份信息。

### 步骤 2 字段语义

DeepSeek 原始分类响应使用 `confidence`；服务端校验后会显式转换为应用/API 字段 `classification_confidence`，页面将其显示为“判断可信度”。该字段只表示类型判定的可靠程度，不是员工本人完成任务的信心。员工信心当前只在步骤 4 的 `progress_read` 叙述中描述，本期不新增 `employee_confidence` 字段。

已判定结果还会返回严格映射的 `strategy`、`coach_mode` 以及引用具体输入证据的 `reason`。当状态为“待补充”或“待人工确认”时，`type_id`、`strategy` 和 `coach_mode` 均不会生成，并且接口不允许进入方案生成。

## 测试

```powershell
& "$projectNodeBin\npm.cmd" install
& "$projectNodeBin\npx.cmd" playwright install chromium
& "$projectNodeBin\npm.cmd" test
```

只运行浏览器端到端测试时使用：

```powershell
& "$projectNodeBin\npx.cmd" playwright test
```

Playwright 会自动启动本项目的 Node 服务，并路由拦截 `/api/coach/*` 请求，因此测试不会发送真实模型请求或产生模型费用。

完整审查结论见 `docs/adversarial-review.md`。

## Markdown 渲染约定

模型返回的叙述性字段必须传入 `renderMarkdown(element, text)`，不得直接拼接到 `innerHTML`。当前覆盖标题、粗体/斜体、删除线、有序/无序列表、引用、表格、链接、行内代码和围栏代码块；原始 HTML 始终按文字显示。链接只允许 `http`、`https`、`mailto`，远程图片只显示替代文字，不发起图片请求。

生产接入仍须先校验提示词约定的 JSON Schema，再逐字段渲染；类型、状态、置信度等原子字段继续使用 `textContent`，不能把模型整段响应直接当 Markdown。

## 数据与集成边界

员工资料属于敏感职场数据。未生成方案的页面草稿只保存在内存中，刷新后不恢复；生成成功的方案和反馈会写入当前账号的 SQLite 历史。历史不自动过期，用户可以主动删除。所有查询、更新和删除都必须包含当前用户 ID 条件。

当前不集成 HRIS、绩效系统、企业消息或日历；也不把辅导建议用于自动化的人事决策。涉及晋升、淘汰、调薪、处分等高风险人事决策时，接口会转交 HR 处理。

## HTTP 部署与 SQLite 运维

当前服务器继续使用 HTTP，必须设置 `SESSION_COOKIE_SECURE=false` 才能让 Cookie 在该环境工作。HTTP 无法加密凭据和 Cookie，链路上的攻击者可能窃听或篡改数据；这是一项已接受但仍存在的风险，后续应优先迁移到 HTTPS。

部署前必须修改服务器自己的 `.env`，不要复制本地数据库路径或 Session Secret：

```dotenv
DATABASE_PATH=/opt/apps/teacher-data/teacher.sqlite
SESSION_SECRET=<在服务器独立生成的至少 48 字节高强度随机值>
SESSION_COOKIE_SECURE=false
SESSION_MAX_AGE_MS=604800000
```

`DATABASE_PATH` 必须位于代码 worktree 之外的持久目录，例如 `/opt/apps/teacher-data/teacher.sqlite`。部署或启动前先创建目录、设置最小必要权限，再运行 `npm run migrate`。数据库文件及其 `-wal`、`-shm`、`-journal` 辅助文件、日志、`.env` 和任何密钥都不得提交到 Git。

本仓库文档只说明候选部署配置，不代表服务器已经切换。候选测试通过后仍须单独批准 systemd 服务切换；真实 DeepSeek 工作流验证也须单独批准。
