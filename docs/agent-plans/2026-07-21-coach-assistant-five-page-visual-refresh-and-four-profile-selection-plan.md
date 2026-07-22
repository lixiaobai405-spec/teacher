# 教练助手五页视觉统一与四画像改选实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not parallelize tasks that modify `frontend/views.js`, `frontend/app.js`, `frontend/state.js`, or `tests/frontend.spec.js`.

**Goal:** 在不改动服务端模型契约、Prompt、DeepSeek 请求与安全 Markdown 渲染边界的前提下，将欢迎页、员工信息输入、类型判定、方案生成、辅导反馈五个页面统一为参考 HTML 的视觉与交互风格，并让用户从前台四种画像中改选且后续方案严格使用最终选择。

**Architecture:** 保留现有 Vanilla JavaScript、内存会话、四步 API、请求取消与 request epoch。新增一个纯前端画像适配模块，将服务端 `A/B/C/D1/D2` 映射为前台 `A/B/C/D`，并在调用步骤 3、4 前生成符合现有服务端校验的最终分类对象；原始 AI 分类继续保存在 `session.classification`，用户选择单独保存在 `session.selectedProfileId`。欢迎页只负责进入流程，第 1 步承载原员工输入和补充追问，步骤 2—4 继续复用现有 API 与状态。

**Tech Stack:** Node.js 20、Express、Vanilla JavaScript ES modules、CSS、Playwright、现有 fixture/fake API、`renderMarkdown` 安全渲染器。

---

## 1. 已确认的产品决策

- 采用增量视觉换皮方案，不重写服务端，不引入框架或依赖。
- 五个页面统一改造：欢迎页、员工信息输入、类型判定、方案生成、辅导反馈。
- 欢迎页采用参考 HTML 的标题、四步流程概览和“开始辅导”入口；点击后才进入员工信息输入。
- 前台固定展示四种画像：

| 前台 ID | 能力 × 意愿 | 前台名称 | 简述 | 服务端类型 |
| --- | --- | --- | --- | --- |
| `A` | 高能力 · 高意愿 | 核心明星型 | 能力强、意愿高，可授权与拔高 | `A` |
| `B` | 高能力 · 低意愿 | 熟手待激活型 | 能力够、干得动，但主动性与投入度不足 | `B` |
| `C` | 低能力 · 高意愿 | 潜力新兵型 | 意愿足但经验不足，需带教补能力 | `C` |
| `D` | 低能力 · 低意愿 | 待改进型 | 能力与意愿双低，需明确要求与边界 | `D1` 或 `D2` |

- AI 返回有效的“已判定”结果后，四张卡均可点击；首次选中 AI 推荐画像。
- 用户改选后，步骤 3 方案与步骤 4反馈必须使用用户最终选择，而不是 AI 原始类型。
- 前台始终不显示 `D1/D2`。选择 `D` 时：
  - AI 原类型是 `D1` 或 `D2`：保留该隐藏子类型；
  - 从 `A/B/C` 改选为 `D`，且入职时长为 `3 个月内（新人）`：内部使用 `D1`；
  - 其他从 `A/B/C` 改选为 `D` 的情况：内部使用 `D2`。
- “待补充”和“待人工确认”仍不得通过手动点卡绕过，不能进入方案生成。
- 改选本身不调用 API；改选后清除旧方案、反馈和方案提交缓存，防止继续查看与新画像不一致的下游结果。
- 返回上一步时保留本轮输入、AI 分类和用户选择；返回首页或刷新后全部清空。
- 不使用 `localStorage`、`sessionStorage`、数据库或跨会话记忆。

## 2. 范围边界

### 允许修改

- `frontend/index.html`
- `frontend/styles.css`
- `frontend/views.js`
- `frontend/app.js`
- `frontend/state.js`
- `frontend/labels.js`
- 新建 `frontend/profile-selection.js`
- `tests/frontend.spec.js`
- 必要时修改 `tests/fixtures/coach-responses.js`，仅增加测试数据构造器
- 本计划文档的任务复选框

### 禁止修改

- `server/`
- `prompts/system.md`
- `knowledge/`
- DeepSeek 模型与请求配置
- `frontend/api.js` 的 API 格式、请求取消与 request epoch 语义
- `frontend/markdown-renderer.js`、离线 Markdown 依赖及模型内容的安全渲染边界
- 数据库、认证、HR 系统、企业 IM、浏览器持久化
- 参考文件 `docs/管理自我和管理团队两个智能体/教练助手 .html`

## 3. 文件职责

- `frontend/profile-selection.js`：前台四画像常量、AI 类型到前台类型的映射、最终分类解析；不得访问 DOM 或发送请求。
- `frontend/state.js`：保存 `selectedProfileId`，在分类结果失效、返回首页或刷新初始化时清空。
- `frontend/app.js`：欢迎页入口、选择画像、下游失效，以及在步骤 3、4 请求前调用同一个最终分类解析函数。
- `frontend/views.js`：五页 DOM 结构、四画像卡片的可访问交互、AI 推荐/用户选择标识；模型自由文本仍交给 `renderMarkdown`。
- `frontend/index.html` 与 `frontend/styles.css`：参考 HTML 的色彩、间距、布局、按钮、卡片、响应式与焦点样式。
- `tests/frontend.spec.js`：欢迎页、五页视觉结构、四画像选择、最终请求负载、返回/刷新、移动端与安全回归。

---

## Task 1：建立欢迎页与独立的第 1 步员工输入页

**Files:**
- Modify: `tests/frontend.spec.js`
- Modify: `frontend/views.js`
- Modify: `frontend/app.js`

- [x] **Step 1：先写欢迎页与进入流程的失败测试**

在 `tests/frontend.spec.js` 增加辅助函数，并让所有需要填写员工资料的流程先点击“开始辅导”：

```js
async function openIntake(page) {
  await expect(page.getByRole('heading', { name: '因材施教，给每个人对的辅导方式' }))
    .toBeVisible();
  await page.getByRole('button', { name: '开始辅导' }).click();
  await expect(page.locator('.panel-h')).toHaveText('员工信息输入');
}

async function fillHome(page) {
  await openIntake(page);
  await page.getByLabel('岗位类别').selectOption({ label: '骨干/带教岗' });
  await page.getByLabel('在团队入职时长').selectOption({ label: '1 年以上' });
  await page.getByLabel('当前绩效状态').selectOption({ label: '持续达标' });
  await page.getByLabel('绩效目标 / 上层期望').fill('独立承接三个项目');
  await page.getByLabel('近期辅导困扰').fill('交代的事不追就停');
  await page.getByLabel('员工特征补充').fill('能够独立交付复杂任务，但近期主动性不足。');
}

test('欢迎页展示四步流程并在点击后进入员工信息输入', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '因材施教，给每个人对的辅导方式' }))
    .toBeVisible();
  await expect(page.locator('.hero-flow .flowchip')).toHaveText([
    '信息输入', '类型判定', '方案生成', '辅导反馈',
  ]);
  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveCount(0);

  await openIntake(page);
  await expect(page.getByLabel('绩效目标 / 上层期望')).toBeVisible();
});
```

同步更新刷新、返回首页、返回上一步测试的断言：返回 `home` 后先看到欢迎页；需要检查空白输入时再次点击“开始辅导”。

- [x] **Step 2：运行聚焦测试并确认按正确原因失败**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "欢迎页|刷新后回到空白首页|顶部返回首页|第 2、3、4 步"
```

Expected: FAIL；首页仍直接显示表单，页面不存在“开始辅导”按钮或 `.hero-flow`。

- [x] **Step 3：实现欢迎页和统一的第 1 步输入视图**

在 `frontend/app.js` 增加入口 handler，并把步骤 2 返回目标改为 `intake`：

```js
const PREVIOUS_SCREEN = Object.freeze({
  classification: ['intake', 1],
  plan: ['classification', 2],
  feedback: ['plan', 3],
});

function startCoaching() {
  cancelPendingRequests();
  setBusy(false);
  setError(null);
  setScreen('intake', 1);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 在现有 handlers 对象中新增这一项：
startCoaching,
```

在 `frontend/views.js`：

1. 将 `renderHome` 改成无输入字段的欢迎页；使用 `node()` 和事件监听，不复制参考 HTML 的 `innerHTML`。
2. 将原 `renderHome` 的基础表单移动到 `renderIntake`。
3. `state.intakeResult.questions` 存在时，在同一个第 1 步面板中追加追问输入和“再次审查”；否则显示“审查信息/继续类型判定”。
4. 保留原字段 ID 与 label，避免破坏可访问性及现有测试定位。

欢迎页核心结构：

```js
function renderHome(root, state, handlers) {
  const section = node('section', { className: 'welcome-page' });
  const flow = node('div', { className: 'hero-flow', id: 'welcome-flow' });
  ['信息输入', '类型判定', '方案生成', '辅导反馈'].forEach((label, index) => {
    flow.append(node('span', { className: 'flowchip', text: label }));
    if (index < 3) flow.append(node('span', { className: 'flowarr', text: '→' }));
  });
  const card = node('section', { className: 'hero-card welcome-card' });
  card.append(
    node('div', { className: 'home-eyebrow muted', text: '四步流程' }),
    flow,
    button('start-coaching', '开始辅导', handlers.startCoaching, { accent: true }),
  );
  section.append(
    node('div', { className: 'home-eyebrow', text: 'Management Compass · 管理团队' }),
    node('h1', { className: 'home-h1', text: '因材施教，给每个人对的辅导方式' }),
    node('p', {
      className: 'home-lead',
      text: '描述一位待辅导员工，AI 按“能力 × 意愿”匹配 4 类画像，并输出差异化的沟通与教练方案。',
    }),
    card,
  );
  root.replaceChildren(section);
}
```

- [x] **Step 4：运行聚焦测试确认通过**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "欢迎页|首页审查|刷新后回到空白首页|顶部返回首页|第 2、3、4 步"
```

Expected: PASS；API mock 仍被使用，不发出真实 DeepSeek 请求。

- [x] **Step 5：检查差异并提交本 Task**

```powershell
git diff -- frontend/app.js frontend/views.js tests/frontend.spec.js
git diff --check
git add frontend/app.js frontend/views.js tests/frontend.spec.js
git commit -m "feat: add dedicated coaching welcome flow"
```

不得使用 `git add .`。

---

## Task 2：统一五页视觉结构与响应式布局

**Files:**
- Modify: `tests/frontend.spec.js`
- Modify: `frontend/index.html`
- Modify: `frontend/styles.css`
- Modify: `frontend/views.js`

- [x] **Step 1：先写五页共享结构与移动端失败测试**

```js
test('完整流程五页使用统一的参考视觉结构', async ({ page }) => {
  const requests = await mockCoachApi(page);
  await page.goto('/');
  await expect(page.locator('.welcome-page .welcome-card')).toBeVisible();

  await fillHome(page);
  await expect(page.locator('.ws-grid .stepper')).toBeVisible();
  await page.getByRole('button', { name: '审查信息' }).click();
  await page.getByLabel('追问 1').fill('尚未做过。');
  await page.getByRole('button', { name: '再次审查' }).click();
  await page.getByRole('button', { name: '生成类型判定' }).click();
  await expect(page.locator('.panel[data-stage="classification"]')).toBeVisible();
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  await expect(page.locator('.panel[data-stage="plan"] .report')).toBeVisible();
  await page.getByRole('button', { name: '去反馈' }).click();
  await expect(page.locator('.panel[data-stage="feedback"]')).toBeVisible();
  expect(requests.map(({ method }) => method)).toEqual(['intake', 'intake', 'classify', 'plan']);
});

for (const width of [390, 768, 1440]) {
  test(`${width}px 下五页布局没有整页横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect.poll(() => page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
    await openIntake(page);
    await expect.poll(() => page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
  });
}
```

- [x] **Step 2：运行测试并确认失败**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "统一的参考视觉结构|五页布局"
```

Expected: FAIL；面板尚无 `data-stage`，欢迎页和阶段结构尚未全部使用新 class。

- [x] **Step 3：按参考 HTML 实现共享视觉骨架**

在 `frontend/views.js` 为 `createWorkspace` 增加阶段参数：

把函数签名改为：

```js
function createWorkspace(state, stage, kick, title, description) {
```

把现有 `panel` 与 `panelHead` 创建语句替换为：

```js
const panel = node('section', { className: 'panel' });
panel.dataset.stage = stage;
const panelHead = node('div', { className: 'panel-head' });
panelHead.append(
  node('div', { className: 'panel-kick', text: kick }),
  node('div', { className: 'panel-h', text: title }),
  node('div', { className: 'panel-desc', text: description }),
);
```

函数其余 stepper、body、grid 组装和 `{ fragment, body, panel }` 返回逻辑保持不变。

各页使用固定文案：

- `intake`：`节点 ① · 输入` / `员工信息输入`
- `classification`：`节点 ② · AI动作` / `类型判定`
- `plan`：`节点 ③ · 输出` / `教练方案生成`
- `feedback`：`节点 ④ · 会话内迭代` / `辅导反馈`

在 `frontend/index.html` 只调整全局设计 token、顶部品牌和页面标题；不加入业务脚本或模型内容。把参考 HTML 已采用、当前缺失的可复用样式补到 `frontend/styles.css`：

```css
.welcome-page { max-width: 860px; margin: 44px auto 0; }
.welcome-card { margin-top: 26px; }
.hero-flow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 16px 0 22px; }
.flowchip { padding: 7px 12px; border-radius: 999px; background: var(--purple-tint); color: var(--purple-700); font-weight: 700; font-size: 13px; }
.flowarr { color: var(--muted); }
.panel-kick { color: var(--orange-600); font-size: 12.5px; font-weight: 700; letter-spacing: 1px; }
.panel[data-stage] { overflow: hidden; }
.panel-foot .io-hint { margin-right: auto; color: var(--muted); font-size: 12px; }

@media (max-width: 820px) {
  .welcome-page { margin-top: 20px; }
  .hero-flow { align-items: stretch; }
  .flowarr { display: none; }
  .flowchip { flex: 1 1 calc(50% - 8px); text-align: center; }
  .panel-foot .io-hint { flex-basis: 100%; }
}
```

视觉验收重点：白色卡片、暖橙主操作、紫色判定强调、左侧步骤条、面板固定页脚、桌面双栏和移动端单栏。不得复制参考 HTML 中的 `innerHTML`、`onclick` 或模拟 AI 定时器。

- [x] **Step 4：运行聚焦视觉与现有移动端测试**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "统一的参考视觉结构|五页布局|窄屏"
```

Expected: PASS；390px、768px、1440px 无整页横向溢出，顶部返回首页持续可见。

- [x] **Step 5：检查并提交本 Task**

```powershell
git diff -- frontend/index.html frontend/styles.css frontend/views.js tests/frontend.spec.js
git diff --check
git add frontend/index.html frontend/styles.css frontend/views.js tests/frontend.spec.js
git commit -m "feat: unify coaching flow visual layout"
```

---

## Task 3：建立前台四画像模型与隐藏 D1/D2 映射

**Files:**
- Create: `frontend/profile-selection.js`
- Modify: `frontend/labels.js`
- Modify: `frontend/state.js`
- Modify: `tests/fixtures/coach-responses.js`
- Modify: `tests/frontend.spec.js`

- [x] **Step 1：先写纯画像映射和会话清理失败测试**

```js
test('纯画像模块把 D1 D2 收敛为前台 D 并按入职时长解析隐藏类型', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const module = await import('/profile-selection.js');
    const source = {
      ability: '高',
      will: '低',
      quadrant: 'B',
      type_id: 'B',
      status: '已判定',
      classification_confidence: '中',
      strategy: '激发意愿',
      coach_mode: '诱导式',
      reason: 'AI 原始依据。',
      evidence: ['能力高', '意愿低'],
      questions: [],
    };
    return {
      publicD1: module.publicProfileId('D1'),
      publicD2: module.publicProfileId('D2'),
      newHire: module.resolveFinalClassification(source, 'D', { tenure: '3 个月内（新人）' }),
      established: module.resolveFinalClassification(source, 'D', { tenure: '1 年以上' }),
    };
  });
  expect(result.publicD1).toBe('D');
  expect(result.publicD2).toBe('D');
  expect(result.newHire).toMatchObject({ type_id: 'D1', strategy: '手把手带', coach_mode: '教导式' });
  expect(result.established).toMatchObject({ type_id: 'D2', strategy: '绩效改进/优化', coach_mode: '绩效面谈' });
});

test('resetSession 清除本轮画像选择', async ({ page }) => {
  await page.goto('/');
  const selectedProfileId = await page.evaluate(async () => {
    const state = await import('/state.js');
    state.setSelectedProfileId('A');
    state.resetSession();
    return state.session.selectedProfileId;
  });
  expect(selectedProfileId).toBeNull();
});
```

为测试 D1/D2 增加 fixture 构造器，不复制真实 API 数据：

```js
function classifiedAs(typeId, overrides = {}) {
  const base = {
    D1: { strategy: '手把手带', coach_mode: '教导式' },
    D2: { strategy: '绩效改进/优化', coach_mode: '绩效面谈' },
  }[typeId];
  return envelope({
    ability: '低',
    will: '低',
    quadrant: 'D',
    type_id: typeId,
    status: '已判定',
    classification_confidence: '中',
    strategy: base.strategy,
    coach_mode: base.coach_mode,
    reason: '能力和意愿证据均偏低。',
    evidence: ['任务尚不能独立完成', '投入意愿不足'],
    questions: [],
    ...overrides,
  });
}

module.exports = {
  coachingPlan,
  classifiedAs,
  defaultFixtures,
  envelope,
  nextPlan,
};
```

同时在 `tests/frontend.spec.js` 顶部现有 fixture 解构中加入 `classifiedAs`：

```js
const {
  coachingPlan,
  classifiedAs,
  defaultFixtures,
  envelope,
  nextPlan,
} = require('./fixtures/coach-responses.js');
```

- [x] **Step 2：运行聚焦测试确认失败**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "纯画像模块|resetSession 清除本轮画像选择"
```

Expected: FAIL；`profile-selection.js` 尚不存在，state 也没有 `setSelectedProfileId`。

- [x] **Step 3：创建纯函数画像适配模块**

新建 `frontend/profile-selection.js`，定义不可变的公开画像和解析函数：

```js
export const PUBLIC_PROFILES = Object.freeze([
  Object.freeze({ id: 'B', ability: '高', will: '低', name: '熟手待激活型', description: '能力够、干得动，但主动性与投入度不足' }),
  Object.freeze({ id: 'A', ability: '高', will: '高', name: '核心明星型', description: '能力强、意愿高，可授权与拔高' }),
  Object.freeze({ id: 'C', ability: '低', will: '高', name: '潜力新兵型', description: '意愿足但经验不足，需带教补能力' }),
  Object.freeze({ id: 'D', ability: '低', will: '低', name: '待改进型', description: '能力与意愿双低，需明确要求与边界' }),
]);

const INTERNAL_COACHING = Object.freeze({
  A: Object.freeze({ quadrant: 'A', strategy: '委以重任', coach_mode: '授权式' }),
  B: Object.freeze({ quadrant: 'B', strategy: '激发意愿', coach_mode: '诱导式' }),
  C: Object.freeze({ quadrant: 'C', strategy: '长期培养', coach_mode: '引导式' }),
  D1: Object.freeze({ quadrant: 'D', strategy: '手把手带', coach_mode: '教导式' }),
  D2: Object.freeze({ quadrant: 'D', strategy: '绩效改进/优化', coach_mode: '绩效面谈' }),
});

export function publicProfileId(typeId) {
  if (typeId === 'D1' || typeId === 'D2') return 'D';
  return ['A', 'B', 'C'].includes(typeId) ? typeId : null;
}

function resolveInternalType(source, selectedProfileId, intake) {
  if (selectedProfileId !== 'D') return selectedProfileId;
  if (source.type_id === 'D1' || source.type_id === 'D2') return source.type_id;
  return intake.tenure === '3 个月内（新人）' ? 'D1' : 'D2';
}

export function resolveFinalClassification(source, selectedProfileId, intake = {}) {
  if (!source || source.status !== '已判定') return source;
  const selected = PUBLIC_PROFILES.find(({ id }) => id === selectedProfileId);
  if (!selected) return source;
  const internalType = resolveInternalType(source, selectedProfileId, intake);
  const coaching = INTERNAL_COACHING[internalType];
  const aiProfileId = publicProfileId(source.type_id);
  const reasonPrefix = aiProfileId === selectedProfileId
    ? ''
    : `用户最终选择“${selected.name}”，AI 原推荐为“${PUBLIC_PROFILES.find(({ id }) => id === aiProfileId)?.name || '未判定'}”。`;
  return {
    ...source,
    ability: selected.ability,
    will: selected.will,
    quadrant: coaching.quadrant,
    type_id: internalType,
    strategy: coaching.strategy,
    coach_mode: coaching.coach_mode,
    reason: `${reasonPrefix}${source.reason}`.slice(0, 500),
  };
}
```

此模块只复刻现有服务端 `contracts.js` 的固定映射，不修改服务端契约。第二阶段若甲方确认前后端彻底四类，应删除这层兼容映射并单独制定服务端迁移计划。

- [x] **Step 4：扩展内存状态并更新前台标签**

在 `frontend/state.js`：

```js
const SESSION_KEYS = new Set([
  'screen', 'step', 'busy', 'intake', 'answers', 'intakeResult',
  'classification', 'plan', 'feedback', 'feedbackText', 'blocked', 'error',
  'submissionKeys',
  'selectedProfileId',
]);

export function createInitialState() {
  return {
    screen: 'home',
    step: 1,
    busy: false,
    requestEpoch: 0,
    intake: {},
    answers: [],
    intakeResult: null,
    classification: null,
    plan: null,
    feedback: null,
    feedbackText: '',
    blocked: null,
    error: null,
    submissionKeys: { intake: null, classification: null, plan: null },
    selectedProfileId: null,
  };
}

export function setSelectedProfileId(selectedProfileId) {
  updateSession({ selectedProfileId: selectedProfileId || null });
}
```

并在 `clearDownstream('intake')` 与 `resetSession()` 路径清空选择；`clearDownstream('classification')` 不清空刚刚由用户设置的选择。

在 `frontend/labels.js` 将公开名称改为：

```js
export const TYPE_LABELS = Object.freeze({
  A: '核心明星型',
  B: '熟手待激活型',
  C: '潜力新兵型',
  D: '待改进型',
  D1: '待改进型',
  D2: '待改进型',
});
```

- [x] **Step 5：运行聚焦测试并确认通过**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "纯画像模块|resetSession 清除本轮画像选择"
```

Expected: PASS；纯函数映射符合约定，`resetSession()` 不保留选择。

- [x] **Step 6：检查并提交本 Task**

```powershell
git diff -- frontend/profile-selection.js frontend/labels.js frontend/state.js tests/fixtures/coach-responses.js tests/frontend.spec.js
git diff --check
git add frontend/profile-selection.js frontend/labels.js frontend/state.js tests/fixtures/coach-responses.js tests/frontend.spec.js
git commit -m "feat: add four-profile frontend model"
```

---

## Task 4：实现四画像卡片改选与最终分类展示

**Files:**
- Modify: `tests/frontend.spec.js`
- Modify: `frontend/views.js`
- Modify: `frontend/app.js`
- Modify: `frontend/styles.css`

- [x] **Step 1：先写可访问改选与无 API 失败测试**

```js
test('AI 推荐默认选中且用户可无 API 改选画像', async ({ page }) => {
  const requests = await advanceToClassification(page);
  const requestCount = requests.length;
  const cards = page.locator('[data-profile-id]');

  await expect(cards).toHaveCount(4);
  await expect(cards.locator('.tcard-name')).toHaveText([
    '熟手待激活型',
    '核心明星型',
    '潜力新兵型',
    '待改进型',
  ]);
  await expect(page.getByText(/D1|D2/)).toHaveCount(0);
  await expect(page.locator('[data-profile-id="B"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-profile-id="B"]')).toContainText('最匹配');

  await page.locator('[data-profile-id="A"]').click();
  await expect(page.locator('[data-profile-id="A"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-profile-id="A"]')).toContainText('已选');
  await expect(page.locator('[data-profile-id="B"]')).toContainText('AI推荐');
  expect(requests).toHaveLength(requestCount);
});

test('画像卡支持键盘改选并保持单选语义', async ({ page }) => {
  await advanceToClassification(page);
  const group = page.getByRole('radiogroup', { name: '员工画像选择' });
  await expect(group.getByRole('radio')).toHaveCount(4);
  await group.getByRole('radio', { name: /核心明星型/ }).focus();
  await page.keyboard.press('Space');
  await expect(group.getByRole('radio', { name: /核心明星型/ })).toHaveAttribute('aria-checked', 'true');
});
```

- [x] **Step 2：运行聚焦测试并确认失败**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "无 API 改选画像|键盘改选"
```

Expected: FAIL；卡片尚未渲染为四项可操作的 radio group。

- [x] **Step 3：在 app 层实现选择 handler 与下游失效**

在 `frontend/app.js` 导入 `setSelectedProfileId`、`publicProfileId` 和 `resolveFinalClassification`：

```js
function selectProfile(profileId) {
  if (!session.classification || session.classification.status !== '已判定') return;
  if (session.selectedProfileId === profileId) return;
  setSelectedProfileId(profileId);
  clearDownstream('classification');
  setError(null);
  render();
}
```

`generateClassification()` 成功后默认选择 AI 推荐：

```js
setClassification(data);
setSelectedProfileId(data.status === '已判定' ? publicProfileId(data.type_id) : null);
```

将 `selectProfile` 加入 handlers；`continueSupplement()` 在执行 `setClassification(null)` 时同时执行 `setSelectedProfileId(null)`，保证补充资料期间不遗留旧选择。

- [x] **Step 4：渲染四张可访问画像卡及最终分类详情**

在 `frontend/views.js` 使用 `PUBLIC_PROFILES` 和 `resolveFinalClassification`。只在 `classification.status === '已判定'` 时渲染可操作卡片：

```js
const typeGrid = node('div', { className: 'typegrid' });
typeGrid.setAttribute('role', 'radiogroup');
typeGrid.setAttribute('aria-label', '员工画像选择');

const aiProfileId = publicProfileId(classification.type_id);
const selectedProfileId = state.selectedProfileId || aiProfileId;
for (const profile of PUBLIC_PROFILES) {
  const card = button(`type-card-${profile.id}`, '', () => handlers.selectProfile(profile.id), { secondary: true });
  card.className = `tcard ${profile.id === selectedProfileId ? 'selected' : ''}`;
  card.dataset.profileId = profile.id;
  card.setAttribute('role', 'radio');
  card.setAttribute('aria-checked', String(profile.id === selectedProfileId));
  card.setAttribute('aria-label', `${profile.ability}能力${profile.will}意愿，${profile.name}`);
  card.append(
    node('div', { className: 'qbadge', text: `${profile.ability}能力 · ${profile.will}意愿` }),
    node('div', { className: 'tcard-name', text: profile.name }),
    node('div', { className: 'tcard-kw', text: profile.description }),
  );
  if (profile.id === aiProfileId) card.append(node('span', { className: 'ai-matchflag', text: profile.id === selectedProfileId ? '最匹配' : 'AI推荐' }));
  if (profile.id === selectedProfileId && profile.id !== aiProfileId) card.append(node('span', { className: 'selected-flag', text: '已选' }));
  typeGrid.append(card);
}
```

详情区使用：

```js
const finalClassification = resolveFinalClassification(
  classification,
  selectedProfileId,
  state.intake,
);
```

由 `finalClassification` 显示能力、意愿、策略、教练模式和判定说明；`classification_confidence` 继续来自现有字段并通过 `textContent` 展示。

在 `frontend/styles.css` 增加 hover、focus-visible、selected、flag 样式，避免只靠颜色表达状态：

```css
.tcard { position: relative; cursor: pointer; background: var(--surface); }
.tcard:hover { border-color: var(--orange); }
.tcard:focus-visible { outline: 3px solid var(--orange-tint); outline-offset: 2px; }
.tcard.selected { border-color: var(--purple); background: var(--purple-tint); }
.ai-matchflag, .selected-flag { position: absolute; top: 12px; right: 12px; padding: 3px 8px; border-radius: 7px; font-size: 11px; font-weight: 700; }
.ai-matchflag { background: var(--orange); color: #fff; }
.selected-flag { background: var(--purple); color: #fff; }
```

- [x] **Step 5：运行聚焦测试确认通过**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "四种前台画像|无 API 改选画像|键盘改选|类型判定显示"
```

Expected: PASS；四卡可鼠标和键盘单选，改选不调用 API，详情随最终选择更新。

- [x] **Step 6：检查并提交本 Task**

```powershell
git diff -- frontend/app.js frontend/views.js frontend/styles.css tests/frontend.spec.js
git diff --check
git add frontend/app.js frontend/views.js frontend/styles.css tests/frontend.spec.js
git commit -m "feat: allow accessible profile selection"
```

---

## Task 5：让方案与反馈严格使用最终画像

**Files:**
- Modify: `tests/frontend.spec.js`
- Modify: `frontend/app.js`

- [x] **Step 1：先写最终请求负载和 D1/D2 映射失败测试**

```js
test('生成方案使用用户最终选择的画像契约', async ({ page }) => {
  const requests = await advanceToClassification(page);
  await page.locator('[data-profile-id="A"]').click();
  await page.getByRole('button', { name: '生成辅导方案' }).click();

  const planRequest = requests.find(({ method }) => method === 'plan');
  expect(planRequest.body.classification).toMatchObject({
    type_id: 'A',
    quadrant: 'A',
    ability: '高',
    will: '高',
    strategy: '委以重任',
    coach_mode: '授权式',
  });
});

test('非新人从其他画像改选待改进型时隐藏映射为 D2', async ({ page }) => {
  const requests = await advanceToClassification(page);
  await page.locator('[data-profile-id="D"]').click();
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  expect(requests.find(({ method }) => method === 'plan').body.classification).toMatchObject({
    type_id: 'D2',
    quadrant: 'D',
    strategy: '绩效改进/优化',
    coach_mode: '绩效面谈',
  });
});

test('新人从其他画像改选待改进型时隐藏映射为 D1', async ({ page }) => {
  const requests = await mockCoachApi(page);
  await page.goto('/');
  await openIntake(page);
  await page.getByLabel('岗位类别').selectOption({ label: '骨干/带教岗' });
  await page.getByLabel('在团队入职时长').selectOption({ label: '3 个月内（新人）' });
  await page.getByLabel('当前绩效状态').selectOption({ label: '持续达标' });
  await page.getByLabel('绩效目标 / 上层期望').fill('独立承接三个项目');
  await page.getByLabel('近期辅导困扰').fill('交代的事不追就停');
  await page.getByLabel('员工特征补充').fill('能够独立交付复杂任务，但近期主动性不足。');
  await page.getByRole('button', { name: '审查信息' }).click();
  await page.getByLabel('追问 1').fill('尚未做过。');
  await page.getByRole('button', { name: '再次审查' }).click();
  await page.getByRole('button', { name: '生成类型判定' }).click();
  await page.locator('[data-profile-id="D"]').click();
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  expect(requests.find(({ method }) => method === 'plan').body.classification.type_id).toBe('D1');
});

test('AI 原为 D1 或 D2 时选择待改进型保留原隐藏子类型', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.classify = [classifiedAs('D1')];
  const requests = await advanceToClassification(page, fixtures);
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  expect(requests.find(({ method }) => method === 'plan').body.classification.type_id).toBe('D1');
});

test('反馈请求继续使用与方案相同的最终画像', async ({ page }) => {
  const requests = await advanceToClassification(page);
  await page.locator('[data-profile-id="A"]').click();
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill('已完成首次沟通。');
  await page.getByRole('button', { name: '生成下一步建议' }).click();
  expect(requests.find(({ method }) => method === 'feedback').body.classification.type_id).toBe('A');
});
```

- [x] **Step 2：运行聚焦测试确认失败**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "最终选择的画像契约|隐藏映射|相同的最终画像"
```

Expected: FAIL；步骤 3、4 目前仍直接发送 `session.classification`。

- [x] **Step 3：在步骤 3、4 共用最终分类解析**

在 `frontend/app.js` 增加唯一入口：

```js
function finalClassification() {
  return resolveFinalClassification(
    session.classification,
    session.selectedProfileId || publicProfileId(session.classification?.type_id),
    session.intake,
  );
}
```

修改 `requestPlan()`：

```js
const planInput = {
  classification: finalClassification(),
  normalizedProfile: session.intakeResult && session.intakeResult.normalized_profile,
  pain: session.intake.pain || '',
};
```

修改 `generateFeedback()`：

```js
const result = await submitFeedback({
  classification: finalClassification(),
  planSummary: planSummary(),
  feedbackText,
});
```

必须保证“换个角度”仍通过同一个 `planInput` 使用同一最终画像。

- [x] **Step 4：增加改选后旧下游结果失效测试**

```js
test('返回类型页改选画像后清除旧方案和反馈并重新请求方案', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.plan = [coachingPlan(), nextPlan()];
  const requests = await advanceToPlan(page, fixtures);
  await page.getByRole('button', { name: '返回上一步' }).click();
  await page.locator('[data-profile-id="A"]').click();
  await expect(page.getByRole('button', { name: '生成辅导方案' })).toBeVisible();
  await page.getByRole('button', { name: '生成辅导方案' }).click();

  expect(requests.filter(({ method }) => method === 'plan')).toHaveLength(2);
  expect(requests.filter(({ method }) => method === 'plan')[1].body.classification.type_id).toBe('A');
});
```

- [x] **Step 5：运行聚焦测试确认通过**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "最终选择的画像契约|隐藏映射|相同的最终画像|改选画像后"
```

Expected: PASS；改选不发请求，点击生成后 plan/feedback 使用最终分类，D 规则准确。

- [x] **Step 6：检查并提交本 Task**

```powershell
git diff -- frontend/app.js tests/frontend.spec.js
git diff --check
git add frontend/app.js tests/frontend.spec.js
git commit -m "feat: apply final profile to coaching requests"
```

---

## Task 6：状态边界、安全渲染与全量回归

**Files:**
- Modify: `tests/frontend.spec.js`
- Modify only if a failing test proves necessary: `frontend/app.js`
- Modify only if a failing test proves necessary: `frontend/state.js`
- Modify only if a failing test proves necessary: `frontend/views.js`
- Modify only if a failing test proves necessary: `frontend/styles.css`
- Modify after verification: `docs/agent-plans/2026-07-21-coach-assistant-five-page-visual-refresh-and-four-profile-selection-plan.md`

- [x] **Step 1：补齐不允许回归的测试**

测试必须覆盖：

```js
for (const classification of [
    {
      ability: '低', will: '低', quadrant: null, type_id: null,
      status: '待补充', classification_confidence: '低',
      strategy: null, coach_mode: null, reason: '低能力低意愿证据仍不完整。',
      evidence: [], questions: ['请补充入职时长和既往辅导记录。'],
    },
    {
      ability: '高', will: '低', quadrant: 'B', type_id: null,
      status: '待人工确认', classification_confidence: '低',
      strategy: null, coach_mode: null, reason: '能力较高，但意愿证据相互冲突。',
      evidence: ['能独立交付', '主动性证据冲突'], questions: ['请由管理者人工确认。'],
    },
]) {
  test(`${classification.status}不能靠画像卡进入方案生成`, async ({ page }) => {
    const fixtures = defaultFixtures();
    fixtures.classify = [envelope(classification)];
    const requests = await advanceToClassification(page, fixtures);
    await expect(page.getByRole('radiogroup', { name: '员工画像选择' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '生成辅导方案' })).toHaveCount(0);
    expect(requests.filter(({ method }) => method === 'plan')).toHaveLength(0);
  });
}

test('返回上一步保留画像选择且不调用 API', async ({ page }) => {
  const requests = await advanceToClassification(page);
  await page.locator('[data-profile-id="A"]').click();
  const before = requests.length;
  await page.getByRole('button', { name: '返回上一步' }).click();
  await page.getByRole('button', { name: '继续类型判定' }).click();
  await expect(page.locator('[data-profile-id="A"]')).toHaveClass(/selected/);
  expect(requests).toHaveLength(before);
});

test('刷新后回到欢迎页且不保留画像和员工数据', async ({ page }) => {
  await advanceToClassification(page);
  await page.locator('[data-profile-id="A"]').click();
  await page.reload();
  await expect(page.getByRole('button', { name: '开始辅导' })).toBeVisible();
  await expect(page.locator('[data-profile-id]')).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })))
    .toEqual({ local: 0, session: 0 });
});
```

保留并运行既有验证：请求取消、迟到响应、返回首页、反馈文本保留、GROW/SBI 分段、Markdown HTML 转义、危险链接拦截、高风险 HR 固定提示、复制方案与移动端溢出。

- [x] **Step 2：运行完整前端测试**

```powershell
npx.cmd playwright test tests/frontend.spec.js
```

Expected: 所有 Playwright 测试通过；请求均由 fixture/fake API 拦截，无真实 DeepSeek 费用。

- [x] **Step 3：运行项目全量测试**

```powershell
npm.cmd test
```

Expected: server tests 与 Playwright tests 全部通过。

- [x] **Step 4：运行静态差异检查**

```powershell
git diff --check
git status --short
git diff -- frontend/index.html frontend/styles.css frontend/views.js frontend/app.js frontend/state.js frontend/labels.js frontend/profile-selection.js tests/frontend.spec.js tests/fixtures/coach-responses.js
```

Expected: `git diff --check` exit code 0；无 `.env`、密钥、缓存、测试报告或无关用户文件进入差异。

- [x] **Step 5：进行人工验收**

- 欢迎页与参考 HTML 的品牌、标题、四步流程卡和主按钮方向一致。
- 五页均使用同一顶部、步骤条、内容面板、页脚和按钮体系。
- 桌面端左右分栏，移动端步骤条横向可滚动且页面本身不横向溢出。
- 类型判定固定显示四卡，名称与描述准确；不显示 `D1/D2`。
- AI 推荐默认选中，鼠标与键盘均能改选，推荐标记和最终选择可辨识。
- 改选不调用 API；生成方案、换个角度和反馈都使用最终选择。
- 从 B 改选 A 时，plan 请求的策略为“委以重任/授权式”。
- 从 B 改选 D：新人使用隐藏 `D1`，其他使用隐藏 `D2`；页面都只显示“待改进型”。
- 待补充/待人工确认不能进入方案生成。
- 返回上一步保留会话，返回首页与刷新清空会话。
- GROW/SBI 标签继续独立换行，模型 Markdown 仍安全渲染。
- 高风险人事请求仍只显示固定 HR 提示。

- [x] **Step 6：验证通过后更新本计划复选框并提交**

只勾选已经有测试证据的步骤，然后执行：

```powershell
git add docs/agent-plans/2026-07-21-coach-assistant-five-page-visual-refresh-and-four-profile-selection-plan.md
git commit -m "docs: complete five-page visual refresh plan"
```

不得暂存 `docs/agent-plans/` 整个目录，不得提交用户原有未跟踪文档。

---

## 4. 最终验证命令

```powershell
npx.cmd playwright test tests/frontend.spec.js
npm.cmd test
git diff --check
git status --short
```

## 5. 完成标准

- 五个页面的结构和视觉语言统一，达到增量换皮方案的预期，而不是静态复制参考原型。
- 真实 API 流程、请求取消、返回上一步、返回首页、刷新清空和反馈保留行为不回退。
- 前台只有四种画像；最终方案和反馈严格服从用户最后选择。
- D1/D2 仅作为第一阶段的后台兼容细节，映射规则有自动化测试且从不暴露到 UI。
- 未修改服务端契约、Prompt、知识库、模型配置或 Markdown 安全边界。
- 全量测试通过，工作区中的用户原有未跟踪文档保持未修改、未暂存、未提交。

## 6. 后续第二阶段（不在本计划实施）

甲方确认前后端彻底只保留四类后，另行制定迁移计划，统一修改 `server/contracts.js`、`server/coach-service.js`、`prompts/system.md`、知识库与测试，把 `D1/D2` 合并为服务端 `D`。本计划不得提前实施该迁移。
