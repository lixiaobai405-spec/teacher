const { expect, test } = require('@playwright/test');
const { defaultFixtures } = require('./fixtures/coach-responses.js');

const PASSWORD = 'Ui-History-Horse-2026';
const NEW_PASSWORD = 'Ui-New-History-Horse-2026';

async function mockCoachApi(page, fixtures = defaultFixtures()) {
  const requests = [];
  await page.route('**/api/coach/**', async (route) => {
    const request = route.request();
    const method = new URL(request.url()).pathname.split('/').pop();
    const body = request.postDataJSON();
    requests.push({ method, body });
    const queue = fixtures[method];
    const candidate = queue.length > 1 ? queue.shift() : queue[0];
    const response = typeof candidate === 'function'
      ? await candidate({ route, request })
      : candidate;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
  return requests;
}

async function registerThroughApi(page, username, password = PASSWORD) {
  await page.evaluate(async ({ name, secret }) => {
    const csrfResponse = await fetch('/api/auth/csrf');
    const { csrfToken } = await csrfResponse.json();
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ username: name, password: secret }),
    });
    if (!response.ok) throw new Error(`registration failed: ${response.status}`);
  }, { name: username, secret: password });
}

async function loginExisting(page, username, password = PASSWORD) {
  await page.goto('/');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('button', { name: '开始辅导' })).toBeVisible();
}

async function registerAndLogin(page, username, password = PASSWORD) {
  await page.goto('/');
  await page.getByRole('button', { name: '注册账号' }).click();
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码').fill(password);
  await page.getByRole('button', { name: '创建账号' }).click();
  const recoveryCode = await page.locator('#recovery-code').innerText();
  await page.getByRole('button', { name: '我已保存恢复码' }).click();
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('button', { name: '开始辅导' })).toBeVisible();
  return recoveryCode;
}

async function advanceToPlan(page) {
  await mockCoachApi(page);
  await page.getByRole('button', { name: '开始辅导' }).click();
  await page.getByLabel('岗位类别').selectOption({ label: '骨干/带教岗' });
  await page.getByLabel('在团队入职时长').selectOption({ label: '1 年以上' });
  await page.getByLabel('当前绩效状态').selectOption({ label: '持续达标' });
  await page.getByLabel('绩效目标 / 上层期望').fill('独立承接三个项目');
  await page.getByLabel('近期辅导困扰').fill('交代的事不追就停');
  await page.getByLabel('员工特征补充').fill('能够独立交付复杂任务，但近期主动性不足。');
  await page.getByRole('button', { name: '判定类型' }).click();
  await page.getByLabel('追问 1').fill('尚未做过。');
  await page.getByRole('button', { name: '再次审查' }).click();
  await page.getByRole('button', { name: '生成类型判定' }).click();
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  await expect(page.locator('.panel-h')).toHaveText('教练方案生成');
}

async function openHistory(page) {
  await page.getByRole('button', { name: '历史记录' }).click();
  await expect(page.getByRole('heading', { name: '历史记录' })).toBeVisible();
}

test('未登录显示登录页且没有记住登录复选框或工作区入口', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '登录教练助手' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始辅导' })).toHaveCount(0);
  await expect(page.locator('.workspace, .ws-grid')).toHaveCount(0);
});

test('开放注册提示规则且恢复码只显示一次并不进入浏览器存储', async ({ page, context }) => {
  const username = '界面注册A';
  const password = '六位密码通过';
  await page.goto('/');
  await page.getByRole('button', { name: '注册账号' }).click();

  await expect(page.getByRole('heading', { name: '创建账号' })).toBeVisible();
  await expect(page.getByText('用户名支持中文并区分大小写')).toBeVisible();
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码').fill('两次输入不一样');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.locator('.auth-error')).toContainText('两次输入的密码不一致');

  await page.getByLabel('确认密码').fill(password);
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.getByRole('heading', { name: '请立即保存恢复码' })).toBeVisible();
  const recoveryCode = await page.locator('#recovery-code').innerText();
  expect(recoveryCode).toMatch(/^(?:[0-9A-F]{4}-){11}[0-9A-F]{4}$/);
  await expect(page.getByText('恢复码只显示这一次')).toBeVisible();

  await page.getByRole('button', { name: '我已保存恢复码' }).click();
  await expect(page.locator('#recovery-code')).toHaveCount(0);
  const persisted = await page.evaluate(async () => ({
    url: location.href,
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    visibleCookie: document.cookie,
    indexedDatabases: typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map((database) => database.name)
      : [],
    hiddenValues: [...document.querySelectorAll('input[type="hidden"]')]
      .map((input) => input.value),
  }));
  const serialized = JSON.stringify(persisted);
  expect(serialized).not.toContain(password);
  expect(serialized).not.toContain(recoveryCode);
  expect(persisted.indexedDatabases).toEqual([]);

  const cookie = (await context.cookies()).find(({ name }) => name === 'teacher.sid');
  expect(cookie).toBeUndefined();
});

test('登录后刷新恢复身份但不恢复草稿，退出后 Session 失效', async ({ page }) => {
  const username = 'Ui_Login_Refresh_01';
  await page.goto('/');
  await registerThroughApi(page, username);
  await page.reload();

  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByText(`当前用户：${username}`)).toBeVisible();
  await expect(page.getByRole('button', { name: '历史记录' })).toBeVisible();

  await page.getByRole('button', { name: '开始辅导' }).click();
  await page.getByLabel('绩效目标 / 上层期望').fill('不应跨刷新恢复的草稿');
  await page.reload();
  await expect(page.getByText(`当前用户：${username}`)).toBeVisible();
  await expect(page.getByRole('button', { name: '开始辅导' })).toBeVisible();
  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveCount(0);

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '登录教练助手' })).toBeVisible();
  const status = await page.evaluate(() => fetch('/api/auth/me').then((response) => response.status));
  expect(status).toBe(401);
});

test('工作区返回首页只清空流程并保留真实登录 Session', async ({ page }) => {
  await registerAndLogin(page, 'Ui_Return_Home_Session_01');
  await page.getByRole('button', { name: '开始辅导' }).click();
  await page.getByLabel('绩效目标 / 上层期望').fill('尚未生成方案的目标');
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('当前内容尚未保存，离开后将丢失。是否继续？');
    await dialog.accept();
  });

  await page.locator('#workspace-return-home').click();
  await expect(page.getByRole('heading', { name: '因材施教，给每个人对的辅导方式' }))
    .toBeVisible();
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '因材施教，给每个人对的辅导方式' }))
    .toBeVisible();
  await expect(page.locator('#auth-user')).toContainText('Ui_Return_Home_Session_01');
});

test('恢复码找回密码会撤销旧登录并只展示一次新恢复码', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const username = 'Ui_Recovery_01';
  const oldRecoveryCode = await registerAndLogin(page, username);
  const oldContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
  const oldSession = await oldContext.newPage();

  try {
    await loginExisting(oldSession, username);
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.getByRole('button', { name: '忘记密码' }).click();
    await page.getByLabel('用户名').fill(username);
    await page.getByLabel('恢复码').fill(oldRecoveryCode);
    await page.getByLabel('新密码', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('确认新密码').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: '重置密码' }).click();

    await expect(page.getByRole('heading', { name: '请立即保存恢复码' })).toBeVisible();
    const nextRecoveryCode = await page.locator('#recovery-code').innerText();
    expect(nextRecoveryCode).not.toBe(oldRecoveryCode);
    expect(await oldSession.evaluate(
      () => fetch('/api/auth/me').then((response) => response.status),
    )).toBe(401);

    await page.getByRole('button', { name: '我已保存恢复码' }).click();
    await expect(page.locator('#recovery-code')).toHaveCount(0);
    await page.getByLabel('用户名').fill(username);
    await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.locator('.auth-error')).toContainText('用户名或密码不正确');
    await page.getByLabel('密码', { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByText(`当前用户：${username}`)).toBeVisible();
  } finally {
    await oldContext.close();
  }
});

test('方案立即展示后自动保存，并可从历史列表查看只读详情', async ({ page }) => {
  test.setTimeout(60_000);
  await registerAndLogin(page, 'Ui_History_Auto_Save_01');

  let releaseSave;
  let markSaveStarted;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  const saveStarted = new Promise((resolve) => { markSaveStarted = resolve; });
  await page.route('**/api/history', async (route) => {
    if (route.request().method() === 'POST') {
      markSaveStarted();
      await saveGate;
    }
    await route.continue();
  });

  await advanceToPlan(page);
  await saveStarted;
  await expect(page.locator('#coach-plan')).toContainText('沟通切入点');
  await expect(page.locator('.history-sync-status')).toContainText('正在保存历史');
  releaseSave();
  await expect(page.locator('.history-sync-status')).toContainText('历史已保存');

  await openHistory(page);
  await expect(page.locator('.history-item')).toHaveCount(1);
  await page.getByRole('button', { name: '查看详情' }).click();
  await expect(page.locator('.history-detail')).toContainText('骨干/带教岗');
  await expect(page.locator('.history-detail')).toContainText('每周一次 1v1');
  await expect(page.getByRole('button', { name: /编辑|继续辅导/ })).toHaveCount(0);
});

test('换个角度与反馈自动保存会更新同一条历史记录', async ({ page }) => {
  test.setTimeout(60_000);
  await registerAndLogin(page, 'Ui_History_Update_01');
  const saves = [];
  await page.route('**/api/history', async (route) => {
    if (route.request().method() === 'POST') saves.push(route.request().postDataJSON());
    await route.continue();
  });
  await advanceToPlan(page);
  await expect(page.locator('.history-sync-status')).toContainText('历史已保存');

  await page.getByRole('button', { name: '换个角度' }).click();
  await expect.poll(() => saves.length).toBe(2);
  await expect(page.locator('.history-sync-status')).toContainText('历史已保存');
  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill('员工本周主动同步了项目风险。');
  await page.getByRole('button', { name: '生成下一步建议' }).click();
  await expect.poll(() => saves.length).toBe(3);
  await expect(page.locator('.history-sync-status')).toContainText('历史已保存');

  expect(new Set(saves.map(({ clientRecordId }) => clientRecordId)).size).toBe(1);
  expect(saves[0].feedback).toBeNull();
  expect(saves[2].feedback).not.toBeNull();
  await openHistory(page);
  await expect(page.locator('.history-item')).toHaveCount(1);
  await page.getByRole('button', { name: '查看详情' }).click();
  await expect(page.locator('.history-detail')).toContainText('员工本周主动同步了项目风险');
});

test('历史自动保存失败保留方案并用同一 clientRecordId 重试', async ({ page }) => {
  test.setTimeout(60_000);
  await registerAndLogin(page, 'Ui_History_Retry_01');
  const attempts = [];
  await page.route('**/api/history', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) return route.abort('failed');
    return route.continue();
  });

  await advanceToPlan(page);
  await expect(page.locator('#coach-plan')).toContainText('沟通切入点');
  await expect(page.locator('.history-sync-status'))
    .toContainText('结果已生成，历史保存失败');
  await page.getByRole('button', { name: '重试保存' }).click();
  await expect(page.locator('.history-sync-status')).toContainText('历史已保存');
  expect(attempts).toHaveLength(2);
  expect(attempts[1].clientRecordId).toBe(attempts[0].clientRecordId);
});

test('两个用户历史隔离且删除历史需要二次确认', async ({ browser }) => {
  test.setTimeout(90_000);
  const firstContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
  const secondContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await registerAndLogin(first, 'Ui_Isolation_A');
    await registerAndLogin(second, 'Ui_Isolation_B');
    await advanceToPlan(first);
    await advanceToPlan(second);
    await expect(first.locator('.history-sync-status')).toContainText('历史已保存');
    await expect(second.locator('.history-sync-status')).toContainText('历史已保存');
    await openHistory(first);
    await openHistory(second);
    await expect(first.locator('.history-item')).toHaveCount(1);
    await expect(second.locator('.history-item')).toHaveCount(1);

    await first.evaluate(() => {
      window.__deleteConfirmations = [];
      window.confirm = (message) => {
        window.__deleteConfirmations.push(message);
        return false;
      };
    });
    await first.getByRole('button', { name: '删除历史' }).click();
    await expect(first.locator('.history-item')).toHaveCount(1);
    await first.evaluate(() => {
      window.confirm = (message) => {
        window.__deleteConfirmations.push(message);
        return true;
      };
    });
    await first.getByRole('button', { name: '删除历史' }).click();
    await expect(first.locator('.history-item')).toHaveCount(0);
    await expect(second.locator('.history-item')).toHaveCount(1);
    expect(await first.evaluate(() => window.__deleteConfirmations)).toEqual([
      '确定删除这条历史记录吗？',
      '确定删除这条历史记录吗？',
    ]);
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});
