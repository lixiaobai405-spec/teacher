function button(text, action, className = 'btn btn-ghost') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.dataset.action = action;
  element.textContent = text;
  return element;
}

function authShell(title, description) {
  const section = document.createElement('section');
  section.className = 'auth-card';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'home-eyebrow';
  eyebrow.textContent = '账户安全';
  const heading = document.createElement('h1');
  heading.className = 'auth-title';
  heading.textContent = title;
  const lead = document.createElement('p');
  lead.className = 'auth-lead';
  lead.textContent = description;
  section.append(eyebrow, heading, lead);
  return section;
}

function field(labelText, name, type, autocomplete) {
  const wrapper = document.createElement('label');
  wrapper.className = 'auth-field';
  const label = document.createElement('span');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.name = name;
  input.type = type;
  input.autocomplete = autocomplete;
  input.required = true;
  if (name === 'username') input.placeholder = '请输入你的用户名';
  if (name === 'recoveryCode') input.placeholder = '请输入仅展示一次的恢复码';
  if (type === 'password') {
    input.placeholder = '请输入至少6位密码';
    input.minLength = 6;
  }
  wrapper.append(label, input);
  return wrapper;
}

function formError() {
  const error = document.createElement('div');
  error.className = 'auth-error';
  error.setAttribute('role', 'alert');
  error.setAttribute('aria-live', 'polite');
  return error;
}

export function renderBoot() {
  const section = authShell('正在检查登录状态', '请稍候，正在安全恢复当前会话。');
  const spinner = document.createElement('div');
  spinner.className = 'auth-spinner';
  spinner.setAttribute('aria-label', '加载中');
  section.appendChild(spinner);
  return section;
}

export function renderLogin() {
  const section = authShell('登录教练助手', '登录后才能使用四步教练流程并查看自己的历史记录。');
  const form = document.createElement('form');
  form.className = 'auth-form';
  form.dataset.authForm = 'login';
  form.append(
    field('用户名', 'username', 'text', 'username'),
    field('密码', 'password', 'password', 'current-password'),
    formError(),
  );
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary auth-submit';
  submit.textContent = '登录';
  form.appendChild(submit);
  const links = document.createElement('div');
  links.className = 'auth-links';
  links.append(button('注册账号', 'show-register'), button('忘记密码', 'show-recovery'));
  section.append(form, links);
  return section;
}

export function renderRegister() {
  const section = authShell(
    '创建账号',
    '开放注册，无需邮箱。用户名支持中文并区分大小写；用户名无应用级长度限制，密码至少6位。请妥善保存注册后仅展示一次的恢复码。',
  );
  const form = document.createElement('form');
  form.className = 'auth-form';
  form.dataset.authForm = 'register';
  form.append(
    field('用户名', 'username', 'text', 'username'),
    field('密码', 'password', 'password', 'new-password'),
    field('确认密码', 'passwordConfirm', 'password', 'new-password'),
    formError(),
  );
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary auth-submit';
  submit.textContent = '创建账号';
  form.appendChild(submit);
  section.append(form, button('返回登录', 'show-login'));
  return section;
}

export function renderRecovery() {
  const section = authShell('使用恢复码重置密码', '恢复成功会撤销该账号的全部旧登录会话，并生成新的恢复码。');
  const form = document.createElement('form');
  form.className = 'auth-form';
  form.dataset.authForm = 'recovery';
  form.append(
    field('用户名', 'username', 'text', 'username'),
    field('恢复码', 'recoveryCode', 'text', 'off'),
    field('新密码', 'newPassword', 'password', 'new-password'),
    field('确认新密码', 'newPasswordConfirm', 'password', 'new-password'),
    formError(),
  );
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary auth-submit';
  submit.textContent = '重置密码';
  form.appendChild(submit);
  section.append(form, button('返回登录', 'show-login'));
  return section;
}

export function renderRecoveryCode(recoveryCode) {
  const section = authShell('请立即保存恢复码', '恢复码是忘记密码后唯一的自助找回方式。');
  const warning = document.createElement('p');
  warning.className = 'recovery-warning';
  warning.textContent = '恢复码只显示这一次。请复制到安全位置，不要截图分享。';
  const code = document.createElement('code');
  code.id = 'recovery-code';
  code.className = 'recovery-code';
  code.textContent = recoveryCode;
  const confirm = button('我已保存恢复码', 'confirm-recovery-code', 'btn btn-primary');
  section.append(warning, code, confirm);
  return section;
}
