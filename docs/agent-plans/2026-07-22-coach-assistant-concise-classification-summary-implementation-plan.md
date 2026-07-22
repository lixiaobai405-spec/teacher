# 教练助手简短画像判定摘要实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把步骤 2 当前冗长且重复的“判定说明 / 判定依据 / 判定证据”收敛为一条随用户最终画像选择实时更新的固定简短摘要，同时保留完整分类数据供后续方案生成使用。

**Architecture:** 仅在前端公开画像配置中增加固定 `summary` 文案，由 `renderClassification` 根据当前 `selectedProfileId` 渲染一条“判定依据”。不修改模型输出、服务端契约、API 请求、分类状态或方案生成逻辑；`reason`、`evidence` 仍保留在浏览器内存状态中，只是不在“已判定”页面重复展示。待补充和待人工确认状态继续展示原始原因、证据与问题，避免隐藏用户需要处理的信息。

**Tech Stack:** Vanilla JavaScript、Playwright、Node.js、现有前端内存状态与 fake API fixture

---

## 已确认产品口径

1. 采用前端固定摘要模板，不要求 DeepSeek 生成新的摘要字段。
2. “已判定”页面只显示一条简短“判定依据”，不显示“判定说明”标题和“判定证据”段落。
3. 摘要以用户当前最终选择的公开画像为准；用户无 API 改选画像时，摘要立即同步更新。
4. AI 原始 `reason`、`evidence`、分类结果和最终画像映射仍保留，不改变步骤 3 的请求内容与业务逻辑。
5. 待补充、待人工确认没有可确认画像，继续显示原始原因、证据、澄清问题和业务状态。
6. 不修改 `server/`、`prompts/`、知识库、依赖、DeepSeek 配置、重试逻辑、持久化和会话生命周期。

## 文件职责与范围

- Modify: `frontend/profile-selection.js`：为 B、A、C、D 四种公开画像增加固定简短摘要。
- Modify: `frontend/views.js`：已判定时按当前公开画像渲染单段摘要；等待态保留现有详细说明。
- Modify: `tests/frontend.spec.js`：覆盖四种固定摘要、默认摘要、改选实时更新、详细依据隐藏及等待态不回归。
- Modify: `docs/agent-plans/2026-07-22-coach-assistant-concise-classification-summary-implementation-plan.md`：验证后更新复选框。

明确不修改：

- `frontend/app.js`、`frontend/state.js`、`frontend/styles.css`；
- `server/`、`prompts/`、`knowledge/`、API 请求格式和模型契约；
- 画像映射、D1/D2 隐藏解析、用户最终画像优先、返回上一步、返回首页和反馈保留逻辑。

## 开始前保护要求

当前工作区可能已有主任务或用户的未提交服务端改动。执行前必须运行：

```powershell
git status --short
git diff -- server/deepseek-client.js server/fact-boundary.js server/index.js tests/server.fact-boundary.test.js tests/server.routes.test.js
git log --oneline -12
```

这些服务端差异及现有未跟踪文档、`.playwright-cli/`、`output/`、`playwright.reuse-existing.config.js` 均不属于本计划，不得修改、删除、回滚、暂存或提交。禁止使用 `git add .` 和 `git add -A`。

---

### Task 1: 为四种公开画像建立固定简短摘要

**Files:**
- Modify: `tests/frontend.spec.js`
- Modify: `frontend/profile-selection.js:1-6`

- [x] **Step 1: 先增加四种摘要的失败测试**

在 `tests/frontend.spec.js` 的“纯画像模块把 D1 D2 收敛为前台 D”测试前增加：

```js
test('四种公开画像提供固定简短判定摘要', async ({ page }) => {
  await page.goto('/');
  const summaries = await page.evaluate(async () => {
    const { PUBLIC_PROFILES } = await import('/profile-selection.js');
    return Object.fromEntries(PUBLIC_PROFILES.map(({ id, summary }) => [id, summary]));
  });

  expect(summaries).toEqual({
    B: '员工能力较高，但近期主动性和投入度不足，归入熟手待激活型。辅导重点是激发意愿。',
    A: '员工能力与意愿都较高，归入核心明星型。辅导重点是充分授权并提供更高挑战。',
    C: '员工意愿较高，但当前能力或经验仍需提升，归入潜力新兵型。辅导重点是结构化带教。',
    D: '员工当前能力与意愿都需要改善，归入待改进型。辅导重点是明确要求、边界与改进节奏。',
  });
});
```

- [x] **Step 2: 运行测试并确认红灯**

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "四种公开画像提供固定简短判定摘要"
```

Expected: FAIL；四个 `summary` 当前均为 `undefined`。失败原因必须是摘要配置尚未实现，而不是服务未启动、端口冲突或 fixture 调用了真实 API。

- [x] **Step 3: 在公开画像配置中增加固定摘要**

把 `frontend/profile-selection.js` 顶部的 `PUBLIC_PROFILES` 改为：

```js
export const PUBLIC_PROFILES = Object.freeze([
  Object.freeze({
    id: 'B',
    ability: '高',
    will: '低',
    name: '熟手待激活型',
    description: '能力够、干得动，但主动性与投入度不足',
    summary: '员工能力较高，但近期主动性和投入度不足，归入熟手待激活型。辅导重点是激发意愿。',
  }),
  Object.freeze({
    id: 'A',
    ability: '高',
    will: '高',
    name: '核心明星型',
    description: '能力强、意愿高，可授权与拔高',
    summary: '员工能力与意愿都较高，归入核心明星型。辅导重点是充分授权并提供更高挑战。',
  }),
  Object.freeze({
    id: 'C',
    ability: '低',
    will: '高',
    name: '潜力新兵型',
    description: '意愿足但经验不足，需带教补能力',
    summary: '员工意愿较高，但当前能力或经验仍需提升，归入潜力新兵型。辅导重点是结构化带教。',
  }),
  Object.freeze({
    id: 'D',
    ability: '低',
    will: '低',
    name: '待改进型',
    description: '能力与意愿双低，需明确要求与边界',
    summary: '员工当前能力与意愿都需要改善，归入待改进型。辅导重点是明确要求、边界与改进节奏。',
  }),
]);
```

摘要属于公开展示配置，不得写入 `INTERNAL_COACHING`，也不得增加 D1、D2 前台摘要。

- [x] **Step 4: 运行画像聚焦测试并确认绿灯**

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "四种公开画像提供固定简短判定摘要"
npx.cmd playwright test tests/frontend.spec.js --grep "纯画像模块把 D1 D2 收敛为前台 D"
```

Expected: 两条命令均 exit code `0`；固定摘要存在，D1/D2 到公开 D 的映射不变。

- [x] **Step 5: 检查并提交 Task 1**

```powershell
git diff --check -- frontend/profile-selection.js tests/frontend.spec.js
git diff -- frontend/profile-selection.js tests/frontend.spec.js
git add -- frontend/profile-selection.js tests/frontend.spec.js
git diff --cached --check
git commit -m "feat: add concise profile summaries"
```

提交前确认暂存区只有上述两个文件，不得带入已有服务端改动或未跟踪文件。

---

### Task 2: 已判定页面只展示随最终画像更新的简短摘要

**Files:**
- Modify: `tests/frontend.spec.js`
- Modify: `frontend/views.js:609-712`

- [x] **Step 1: 把桌面类型页断言改为简短摘要失败测试**

在 `tests/frontend.spec.js` 的“桌面类型判定页对齐参考提示、四画像、依据和操作栏”测试中，把原始长依据断言替换为：

```js
const reasoning = page.locator('.classification-reasoning');
await expect(reasoning.locator('.classification-reason-title')).toHaveCount(0);
await expect(reasoning.locator('.classification-evidence')).toHaveCount(0);
await expect(reasoning.locator('p')).toHaveCount(1);
await expect(reasoning).toHaveText(
  '判定依据：员工能力较高，但近期主动性和投入度不足，归入熟手待激活型。辅导重点是激发意愿。',
);
await expect(reasoning).not.toContainText('员工已能独立交付复杂任务');
```

同时把“类型判定隐藏内部判定行但保留画像选择和具体依据”中的长依据断言替换为同一条固定摘要，并增加：

```js
await expect(page.locator('.classification-reason-title')).toHaveCount(0);
await expect(page.locator('.classification-evidence')).toHaveCount(0);
```

- [x] **Step 2: 扩展改选测试，要求摘要无 API 实时更新**

在“AI 推荐默认选中且用户可无 API 改选画像”测试中，点击 A 前后增加：

```js
const summary = page.locator('.classification-summary');
await expect(summary).toHaveText(
  '判定依据：员工能力较高，但近期主动性和投入度不足，归入熟手待激活型。辅导重点是激发意愿。',
);

await page.locator('[data-profile-id="A"]').click();

await expect(summary).toHaveText(
  '判定依据：员工能力与意愿都较高，归入核心明星型。辅导重点是充分授权并提供更高挑战。',
);
expect(requests).toHaveLength(requestCount);
```

如果原测试已经包含点击 A 的语句，只增加点击前后的摘要断言，不得重复点击。

- [x] **Step 3: 增加等待态详细原因保留测试**

在现有 `for (const status of ['待补充', '待人工确认'])` 测试中，状态断言后增加：

```js
await expect(page.locator('.classification-summary')).toHaveCount(0);
await expect(page.locator('.classification-reason-title')).toHaveCount(1);
await expect(page.locator('.classification-reasoning')).toContainText(pending.reason);
await expect(page.locator('.classification-questions')).toBeVisible();
```

该断言确保方案一只压缩“已判定”页面，不会隐藏用户处理等待态所需的信息。

- [x] **Step 4: 运行三组测试并确认红灯**

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "桌面类型判定页"
npx.cmd playwright test tests/frontend.spec.js --grep "AI 推荐默认选中且用户可无 API 改选画像"
npx.cmd playwright test tests/frontend.spec.js --grep "类型判定为"
```

Expected: 前两条因当前仍展示长 `reason/evidence` 且没有 `.classification-summary` 而 FAIL；等待态测试继续 PASS。不得通过删除等待态内容让测试变绿。

- [x] **Step 5: 最小实现已判定摘要分支**

在 `renderClassification` 中：

1. 将 `let finalClassification = classification;` 改为：

```js
let selectedProfile = null;
```

2. 在已判定分支确定 `selectedProfileId` 后增加：

```js
selectedProfile = PUBLIC_PROFILES.find(({ id }) => id === selectedProfileId) || null;
```

3. 删除 `renderClassification` 中仅为展示长原因调用的：

```js
finalClassification = resolveFinalClassification(
  classification,
  selectedProfileId,
  state.intake,
);
```

4. 将详情卡渲染改为两个明确分支：

```js
const details = node('section', { className: 'rcard classification-details' });
const reasoning = node('div', { className: 'reasoning classification-reasoning' });

if (classification.status === '已判定' && selectedProfile) {
  const summary = node('p', { className: 'classification-summary' });
  summary.append(
    node('strong', { text: '判定依据：' }),
    document.createTextNode(selectedProfile.summary),
  );
  reasoning.append(summary);
} else {
  reasoning.append(
    node('h3', {
      className: 'rcard-h classification-reason-title',
      text: CLASSIFICATION_LABELS.reason,
    }),
    (() => {
      const reason = node('p');
      reason.append(
        node('strong', { text: '判定依据：' }),
        document.createTextNode(classification.reason || '未提供'),
      );
      return reason;
    })(),
  );

  if (Array.isArray(classification.evidence) && classification.evidence.length > 0) {
    const evidence = node('p', { className: 'classification-evidence' });
    evidence.append(
      node('strong', { text: '判定证据：' }),
      document.createTextNode(classification.evidence.join('；')),
    );
    reasoning.append(evidence);
  }

  if (classification.questions.length > 0) {
    const questions = node('div', { className: 'classification-questions' });
    questions.append(node('h3', { className: 'rcard-h', text: '仍需确认' }));
    appendQuestions(questions, classification.questions);
    reasoning.append(questions);
  }
}

details.append(reasoning);
body.append(details);
```

5. 如果 `resolveFinalClassification` 在 `frontend/views.js` 中已无其他用途，从文件顶部 import 中删除它。不得修改 `frontend/profile-selection.js` 内的导出，因为 `frontend/app.js` 仍需要该函数构造最终方案请求。

模型文本不得通过 `innerHTML` 渲染。本任务的固定摘要仍使用 `textContent` / `createTextNode`。

- [x] **Step 6: 运行步骤 2 聚焦回归并确认绿灯**

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "桌面类型判定页"
npx.cmd playwright test tests/frontend.spec.js --grep "AI 推荐默认选中且用户可无 API 改选画像"
npx.cmd playwright test tests/frontend.spec.js --grep "类型判定隐藏内部判定行"
npx.cmd playwright test tests/frontend.spec.js --grep "类型判定为"
npx.cmd playwright test tests/frontend.spec.js --grep "生成方案使用用户最终选择的画像契约"
```

Expected:

- B 默认摘要简短且只有一个段落；
- 改选 A 后摘要同步变化且请求数量不增加；
- 已判定页面没有标题和证据段落；
- 待补充与待人工确认仍显示原因和问题，且不能生成方案；
- 方案请求继续以用户最终画像为准。

- [x] **Step 7: 检查并提交 Task 2**

```powershell
git diff --check -- frontend/views.js tests/frontend.spec.js
git diff -- frontend/views.js tests/frontend.spec.js
git add -- frontend/views.js tests/frontend.spec.js
git diff --cached --check
git commit -m "feat: show concise classification summary"
```

提交前确认暂存区不包含 `server/`、`prompts/`、用户文档或输出目录。

---

### Task 3: 全量回归、人工验收与计划收尾

**Files:**
- Modify: `docs/agent-plans/2026-07-22-coach-assistant-concise-classification-summary-implementation-plan.md`

- [x] **Step 1: 运行前端全量测试**

```powershell
npx.cmd playwright test tests/frontend.spec.js
```

Expected: 全部通过；不得调用真实 DeepSeek API，所有接口响应使用现有 fixture / fake API。

- [x] **Step 2: 运行项目全量测试**

```powershell
npm.cmd test
```

Expected: 服务端和前端全部通过；本计划没有改变模型契约、事实边界或重试逻辑。

- [x] **Step 3: 完成人工验收**

使用现有 fake API 或用户自行启动的本地页面检查：

1. AI 默认推荐 B 时，只显示：

   ```text
   判定依据：员工能力较高，但近期主动性和投入度不足，归入熟手待激活型。辅导重点是激发意愿。
   ```

2. 页面不再出现“判定说明”标题、原始长原因和“判定证据”段落。
3. 点击 A、C、D 时，摘要立即对应变更，改选本身不调用 API。
4. 点击“生成方案”后，方案请求仍采用用户最终选择的画像。
5. 待补充或待人工确认时，原始原因、证据、问题和操作按钮仍可见，且不能生成方案。
6. 返回上一步、返回首页、刷新、移动端布局和 Markdown 安全边界不受影响。

- [x] **Step 4: 审计范围和遗留改动**

```powershell
git diff --check
git status --short
git diff HEAD -- frontend/profile-selection.js frontend/views.js tests/frontend.spec.js
git log --oneline -12
```

Expected:

- 本计划业务代码和测试均已提交；
- 原有服务端未提交改动仍被完整保留，没有进入本计划提交；
- `.playwright-cli/`、`output/`、`playwright.reuse-existing.config.js` 和其他用户未跟踪文档仍被保留；
- 没有新增依赖、服务端字段、数据库、持久化或真实 API 测试。

- [x] **Step 5: 验证后更新计划复选框并单独提交**

仅把有实际验证证据的步骤改为 `- [x]`，然后执行：

```powershell
git add -- docs/agent-plans/2026-07-22-coach-assistant-concise-classification-summary-implementation-plan.md
git diff --cached --check
git commit -m "docs: record concise classification summary implementation"
git status --short
```

不得暂存整个 `docs/agent-plans/` 目录。

---

## 完成标准

- 已判定页面只显示一条固定简短摘要，不显示重复标题、长原因和证据段落。
- 四种公开画像都有确定、可测试的摘要文案。
- 摘要随用户最终选择实时更新，改选不触发 API。
- 完整 `reason`、`evidence`、内部 D1/D2 和最终分类逻辑保持不变。
- 等待态继续展示用户需要处理的详细原因和问题。
- 不修改模型、提示词、服务端契约、重试逻辑和依赖。
- 聚焦测试、前端全量测试、`npm.cmd test` 与 `git diff --check` 全部通过。
