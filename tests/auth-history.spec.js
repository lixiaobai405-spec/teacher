const { expect, test } = require('@playwright/test');

const PASSWORD = 'Ui-History-Horse-2026';
const NEW_PASSWORD = 'Ui-New-History-Horse-2026';

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
