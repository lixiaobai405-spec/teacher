import {
  clearDownstream,
  isCurrentEpoch,
  markSubmission,
  matchesSubmission,
  resetSession,
  session,
  setAnswers,
  setBlocked,
  setBusy,
  setClassification,
  setError,
  setFeedback,
  setFeedbackText,
  setIntake,
  setIntakeResult,
  setPlan,
  setScreen,
  setSelectedProfileId,
  setSelectedTraits,
  setTraitNote,
  updateSession,
} from './state.js';
import {
  cancelPendingRequests,
  classify,
  generatePlan,
  getCurrentUser,
  getPreAuthCsrf,
  intake,
  loginAccount,
  logoutAccount,
  registerAccount,
  resetApiState,
  resetPasswordWithRecovery,
  setSessionCsrfToken,
  submitFeedback,
} from './api.js';
import {
  renderBoot,
  renderLogin,
  renderRecovery,
  renderRecoveryCode,
  renderRegister,
} from './auth-ui.js';
import { renderApp } from './views.js';
import { publicProfileId, resolveFinalClassification } from './profile-selection.js';
import { BUSY_ACTIONS, waitForMinimumLoading } from './loading.js';

const root = document.getElementById('app');
const toastElement = document.getElementById('toast');

function toast(message) {
  toastElement.textContent = message;
  toastElement.classList.add('show');
  clearTimeout(toastElement._timeout);
  toastElement._timeout = setTimeout(() => toastElement.classList.remove('show'), 1800);
}

function returnHome() {
  if (!session.user) {
    if (session.authReady) setScreen('login');
    render();
    return;
  }
  resetApiState();
  resetSession();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const PREVIOUS_SCREEN = Object.freeze({
  classification: ['intake', 1],
  plan: ['classification', 2],
  feedback: ['plan', 3],
});

function startCoaching() {
  if (!session.user) return;
  cancelPendingRequests();
  setBusy(false);
  setError(null);
  setScreen('intake', 1);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goPrevious() {
  const target = PREVIOUS_SCREEN[session.screen];
  if (!target) return;
  cancelPendingRequests();
  if (session.screen === 'feedback') {
    const feedbackInput = document.getElementById('feedback-text');
    if (feedbackInput) setFeedbackText(feedbackInput.value);
  }
  setBusy(false);
  setError(null);
  setScreen(target[0], target[1]);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function planSummary() {
  if (!session.plan) return '';
  return [
    ...(session.plan.entry || []),
    ...(session.plan.cautions || []),
    session.plan.frequency || '',
    ...(session.plan.gap_fix || []),
    ...(session.plan.scripts || []),
  ].join('\n');
}

async function requestWithLoading(action, request) {
  const startedAt = performance.now();
  setBusy(true, action);
  render();
  const result = await request();
  await waitForMinimumLoading(startedAt);
  return result;
}

function consume(result) {
  if (result.stale || !isCurrentEpoch(result.requestEpoch)) return null;
  setBusy(false);
  if (result.blocked) {
    setBlocked({ code: result.code || 'HR_REVIEW_REQUIRED' });
    setScreen('blocked');
    render();
    return null;
  }
  if (!result.ok || !result.data || typeof result.data !== 'object') {
    setError(result.message || '请求未完成，请稍后重试。');
    render();
    return null;
  }
  return result.data;
}

async function reviewIntake(values, answers = session.answers) {
  const payload = {
    intake: values,
    answers: Object.fromEntries(
      answers.map(({ question, answer }) => [question, answer]),
    ),
  };
  setIntake(values);
  setAnswers(answers);
  if (matchesSubmission('intake', payload) && session.intakeResult) {
    setError(null);
    setScreen(
      session.intakeResult.sufficient ? 'classification' : 'intake',
      session.intakeResult.sufficient ? 2 : 1,
    );
    render();
    return;
  }
  clearDownstream('intake');
  setError(null);
  const result = await requestWithLoading(
    BUSY_ACTIONS.INTAKE_REVIEW,
    () => intake(payload),
  );
  const data = consume(result);
  if (!data) return;
  if (data.high_risk_personnel_action || data.status === '高风险停止') {
    setBlocked({ code: 'HR_REVIEW_REQUIRED' });
    setScreen('blocked');
  } else {
    markSubmission('intake', payload);
    setIntakeResult(data);
    setScreen(data.sufficient ? 'classification' : 'intake', data.sufficient ? 2 : 1);
  }
  render();
}

async function reviewAgain(answers) {
  await reviewIntake(session.intake, answers);
}

async function generateClassification() {
  const normalizedProfile = session.intakeResult && session.intakeResult.normalized_profile;
  if (!normalizedProfile) {
    setError('缺少可用于判定的结构化信息，请重新审查。');
    render();
    return;
  }
  const payload = { normalizedProfile };
  if (!matchesSubmission('classification', payload)) {
    clearDownstream('classification');
  }
  setError(null);
  const result = await requestWithLoading(
    BUSY_ACTIONS.CLASSIFICATION_GENERATE,
    () => classify(payload),
  );
  const data = consume(result);
  if (!data) return;
  markSubmission('classification', payload);
  setClassification(data);
  setSelectedProfileId(data.status === '已判定' ? publicProfileId(data.type_id) : null);
  setScreen('classification', 2);
  render();
}

function selectProfile(profileId) {
  if (!session.classification || session.classification.status !== '已判定') return;
  if (session.selectedProfileId === profileId) return;
  setSelectedProfileId(profileId);
  clearDownstream('classification');
  setError(null);
  render();
}

function toggleTrait(trait) {
  const selected = session.selectedTraits.includes(trait)
    ? session.selectedTraits.filter((item) => item !== trait)
    : [...session.selectedTraits, trait];
  setSelectedTraits(selected);
  return session.selectedTraits.includes(trait);
}

function updateTraitNote(value) {
  setTraitNote(value);
}

function finalClassification() {
  return resolveFinalClassification(
    session.classification,
    session.selectedProfileId || publicProfileId(session.classification?.type_id),
    session.intake,
  );
}

async function requestPlan(regenerate) {
  if (!session.classification || session.classification.status !== '已判定') return;
  const planInput = {
    classification: finalClassification(),
    normalizedProfile: session.intakeResult && session.intakeResult.normalized_profile,
    pain: session.intake.pain || '',
  };
  if (!regenerate && session.plan && matchesSubmission('plan', planInput)) {
    setError(null);
    setScreen('plan', 3);
    render();
    return;
  }
  setError(null);
  const result = await requestWithLoading(
    regenerate ? BUSY_ACTIONS.PLAN_REGENERATE : BUSY_ACTIONS.PLAN_GENERATE,
    () => generatePlan({
      ...planInput,
      regenerate,
      previousPlan: regenerate ? session.plan : null,
    }),
  );
  const data = consume(result);
  if (!data) return;
  clearDownstream('plan');
  setPlan(data);
  markSubmission('plan', planInput);
  setScreen('plan', 3);
  render();
}

async function generateFeedback(feedbackText) {
  setFeedbackText(feedbackText);
  setError(null);
  const result = await requestWithLoading(
    BUSY_ACTIONS.FEEDBACK_GENERATE,
    () => submitFeedback({
      classification: finalClassification(),
      planSummary: planSummary(),
      feedbackText,
    }),
  );
  const data = consume(result);
  if (!data) return;
  setFeedback(data);
  setScreen('feedback', 4);
  render();
}

async function copyPlan() {
  const target = document.getElementById('coach-plan');
  if (!target) {
    toast('没有可复制内容');
    return;
  }
  const text = target.innerText.trim();
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    toast('已复制方案');
  } catch {
    let input;
    try {
      input = document.createElement('textarea');
      input.value = text;
      input.readOnly = true;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
      toast(copied ? '已复制方案' : '复制失败，请手动选择内容');
    } catch {
      toast('复制失败，请手动选择内容');
    } finally {
      input?.remove();
    }
  }
}

function continueSupplement() {
  const questions = session.classification && session.classification.questions;
  setIntakeResult({ ...session.intakeResult, questions: Array.isArray(questions) ? questions : [] });
  setClassification(null);
  setSelectedProfileId(null);
  setScreen('intake', 1);
  render();
}

function authErrorMessage(result) {
  return result?.message || '请求未完成，请稍后重试。';
}

function setFormPending(form, pending) {
  for (const control of form.elements) control.disabled = pending;
}

async function ensurePreAuthCsrf() {
  if (session.preAuthCsrfToken) return session.preAuthCsrfToken;
  const result = await getPreAuthCsrf();
  if (!result.ok || typeof result.data?.csrfToken !== 'string') return null;
  updateSession({ preAuthCsrfToken: result.data.csrfToken });
  return result.data.csrfToken;
}

function showAuthScreen(screen) {
  updateSession({
    screen,
    authError: null,
    recoveryCode: screen === 'recovery-code' ? session.recoveryCode : null,
  });
  render();
}

async function submitLogin(form) {
  const error = form.querySelector('.auth-error');
  const values = new FormData(form);
  error.textContent = '';
  setFormPending(form, true);
  const csrfToken = await ensurePreAuthCsrf();
  const result = csrfToken
    ? await loginAccount(values.get('username'), values.get('password'), csrfToken)
    : { ok: false, message: '无法建立安全登录会话，请刷新后重试。' };
  if (!result.ok) {
    error.textContent = authErrorMessage(result);
    setFormPending(form, false);
    return;
  }

  const me = await getCurrentUser();
  if (!me.ok || !me.data?.user || typeof me.data?.csrfToken !== 'string') {
    error.textContent = authErrorMessage(me);
    setFormPending(form, false);
    return;
  }
  updateSession({
    authReady: true,
    user: me.data.user,
    csrfToken: me.data.csrfToken,
    authError: null,
  });
  setSessionCsrfToken(me.data.csrfToken);
  resetSession();
  render();
}

async function submitRegistration(form) {
  const error = form.querySelector('.auth-error');
  const values = new FormData(form);
  if (values.get('password') !== values.get('passwordConfirm')) {
    error.textContent = '两次输入的密码不一致。';
    return;
  }
  error.textContent = '';
  setFormPending(form, true);
  const csrfToken = await ensurePreAuthCsrf();
  const result = csrfToken
    ? await registerAccount(values.get('username'), values.get('password'), csrfToken)
    : { ok: false, message: '无法建立安全注册会话，请刷新后重试。' };
  if (!result.ok || typeof result.data?.recoveryCode !== 'string') {
    error.textContent = authErrorMessage(result);
    setFormPending(form, false);
    return;
  }
  updateSession({
    recoveryCode: result.data.recoveryCode,
    screen: 'recovery-code',
    authError: null,
  });
  render();
}

async function submitRecovery(form) {
  const error = form.querySelector('.auth-error');
  const values = new FormData(form);
  if (values.get('newPassword') !== values.get('newPasswordConfirm')) {
    error.textContent = '两次输入的密码不一致。';
    return;
  }
  error.textContent = '';
  setFormPending(form, true);
  const csrfToken = await ensurePreAuthCsrf();
  const result = csrfToken
    ? await resetPasswordWithRecovery(
      values.get('username'),
      values.get('recoveryCode'),
      values.get('newPassword'),
      csrfToken,
    )
    : { ok: false, message: '无法建立安全找回会话，请刷新后重试。' };
  if (!result.ok || typeof result.data?.recoveryCode !== 'string') {
    error.textContent = authErrorMessage(result);
    setFormPending(form, false);
    return;
  }
  updateSession({
    recoveryCode: result.data.recoveryCode,
    screen: 'recovery-code',
    authError: null,
  });
  render();
}

function bindAuthUi() {
  root.querySelector('[data-action="show-register"]')
    ?.addEventListener('click', () => showAuthScreen('register'));
  root.querySelector('[data-action="show-recovery"]')
    ?.addEventListener('click', () => showAuthScreen('recovery'));
  root.querySelector('[data-action="show-login"]')
    ?.addEventListener('click', () => showAuthScreen('login'));
  root.querySelector('[data-action="confirm-recovery-code"]')
    ?.addEventListener('click', () => {
      updateSession({ recoveryCode: null, screen: 'login' });
      render();
    });

  const form = root.querySelector('[data-auth-form]');
  if (!form) return;
  form.querySelector('.auth-error').textContent = session.authError || '';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (form.dataset.authForm === 'login') submitLogin(form);
    else if (form.dataset.authForm === 'register') submitRegistration(form);
    else if (form.dataset.authForm === 'recovery') submitRecovery(form);
  });
}

async function bootstrapAuthentication() {
  const me = await getCurrentUser();
  if (me.ok && me.data?.user && typeof me.data?.csrfToken === 'string') {
    updateSession({
      authReady: true,
      user: me.data.user,
      csrfToken: me.data.csrfToken,
      preAuthCsrfToken: null,
      screen: 'home',
      authError: null,
    });
    setSessionCsrfToken(me.data.csrfToken);
    render();
    return;
  }

  setSessionCsrfToken(null);
  const csrf = await getPreAuthCsrf();
  updateSession({
    authReady: true,
    user: null,
    csrfToken: null,
    preAuthCsrfToken: csrf.ok ? csrf.data?.csrfToken || null : null,
    screen: 'login',
    authError: csrf.ok ? null : authErrorMessage(csrf),
  });
  render();
}

async function logout() {
  const result = await logoutAccount(session.csrfToken);
  if (!result.ok && result.status !== 401) {
    toast(authErrorMessage(result));
    return;
  }
  setSessionCsrfToken(null);
  updateSession({
    authReady: false,
    user: null,
    csrfToken: null,
    preAuthCsrfToken: null,
    screen: 'boot',
  });
  resetSession();
  render();
  await bootstrapAuthentication();
}

const handlers = {
  startCoaching,
  reviewIntake,
  reviewAgain,
  generateClassification,
  selectProfile,
  toggleTrait,
  updateTraitNote,
  generatePlan: () => requestPlan(false),
  regeneratePlan: () => requestPlan(true),
  generateFeedback,
  copyPlan,
  goFeedback: () => {
    cancelPendingRequests();
    setBusy(false);
    setError(null);
    setScreen('feedback', 4);
    render();
  },
  continueSupplement,
  goPrevious,
  goHome: returnHome,
};

function render() {
  const workflowScreens = new Set(['intake', 'classification', 'plan', 'feedback', 'blocked']);
  const topReturn = document.getElementById('top-return-home');
  const authActions = document.getElementById('auth-actions');
  const authUser = document.getElementById('auth-user');
  const badge = document.querySelector('.badge-top');
  topReturn.hidden = !session.user || !workflowScreens.has(session.screen);
  authActions.hidden = !session.user;
  authUser.textContent = session.user ? `当前用户：${session.user.username}` : '';
  badge.hidden = Boolean(session.user);

  const authRenderers = {
    boot: renderBoot,
    login: renderLogin,
    register: renderRegister,
    recovery: renderRecovery,
  };
  if (authRenderers[session.screen]) {
    root.replaceChildren(authRenderers[session.screen]());
    bindAuthUi();
    return;
  }
  if (session.screen === 'recovery-code') {
    root.replaceChildren(renderRecoveryCode(session.recoveryCode || ''));
    bindAuthUi();
    return;
  }
  renderApp(root, session, handlers);
}

document.getElementById('home-brand').addEventListener('click', returnHome);
document.getElementById('top-return-home').addEventListener('click', returnHome);
document.getElementById('auth-history').addEventListener('click', () => {
  toast('历史记录入口已就绪，页面将在下一阶段接入。');
});
document.getElementById('auth-logout').addEventListener('click', logout);
window.addEventListener('beforeunload', cancelPendingRequests);
render();
bootstrapAuthentication();
