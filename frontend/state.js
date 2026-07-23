const SESSION_KEYS = new Set([
  'authReady', 'user', 'csrfToken', 'preAuthCsrfToken', 'recoveryCode', 'authError',
  'clientRecordId', 'historySync', 'historyItems', 'historyCursor', 'historyDetail',
  'workflowDirty',
  'screen', 'step', 'busy', 'busyAction', 'intake', 'answers', 'intakeResult',
  'classification', 'plan', 'feedback', 'feedbackText', 'blocked', 'error',
  'submissionKeys', 'selectedProfileId', 'selectedTraits', 'traitNote',
]);

export function createUuid() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('当前浏览器不支持安全随机数生成。');
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createInitialState({
  authReady = false,
  user = null,
  csrfToken = null,
  preAuthCsrfToken = null,
} = {}) {
  return {
    authReady,
    user,
    csrfToken,
    preAuthCsrfToken,
    recoveryCode: null,
    authError: null,
    screen: authReady ? (user ? 'home' : 'login') : 'boot',
    clientRecordId: createUuid(),
    historySync: { status: 'idle', id: null, message: '' },
    historyItems: [],
    historyCursor: null,
    historyDetail: null,
    workflowDirty: false,
    step: 1,
    busy: false,
    busyAction: null,
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
    selectedTraits: [],
    traitNote: '',
  };
}

export const session = createInitialState();

export function updateSession(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!SESSION_KEYS.has(key)) {
      throw new TypeError(`Unsupported session field: ${key}`);
    }
    session[key] = value;
  }
}

export function setScreen(screen, step) {
  updateSession({ screen, ...(step ? { step } : {}) });
}

export function setBusy(busy, busyAction = null) {
  const active = Boolean(busy);
  updateSession({
    busy: active,
    busyAction: active ? String(busyAction || '') || null : null,
  });
}

export function setIntake(intake) {
  updateSession({ intake: { ...intake } });
}

export function setAnswers(answers) {
  updateSession({ answers: Array.isArray(answers) ? answers.map((item) => ({ ...item })) : [] });
}

export function setIntakeResult(intakeResult) {
  updateSession({ intakeResult });
}

export function setClassification(classification) {
  updateSession({ classification });
}

export function setSelectedProfileId(selectedProfileId) {
  updateSession({ selectedProfileId: selectedProfileId || null });
}

export function setSelectedTraits(selectedTraits) {
  const normalized = Array.isArray(selectedTraits)
    ? [...new Set(selectedTraits.map((item) => String(item).trim()).filter(Boolean))]
    : [];
  updateSession({ selectedTraits: normalized });
}

export function setTraitNote(traitNote) {
  updateSession({ traitNote: String(traitNote || '') });
}

export function composeTraits(selectedTraits = [], traitNote = '') {
  const keywords = Array.isArray(selectedTraits)
    ? selectedTraits.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const note = String(traitNote || '').trim();
  if (keywords.length > 0 && note) {
    return `关键词：${keywords.join('、')}。补充描述：${note}`;
  }
  if (keywords.length > 0) return keywords.join('、');
  return note;
}

export function setPlan(plan) {
  updateSession({ plan });
}

export function setFeedback(feedback) {
  updateSession({ feedback });
}

export function setFeedbackText(feedbackText) {
  updateSession({ feedbackText: String(feedbackText || '') });
}

export function setBlocked(blocked) {
  updateSession({ blocked });
}

export function setError(error) {
  updateSession({ error: error || null });
}

export function isCurrentEpoch(epoch) {
  return epoch === session.requestEpoch;
}

export function beginRequestEpoch() {
  session.requestEpoch += 1;
  return session.requestEpoch;
}

export function invalidateRequestEpoch() {
  return beginRequestEpoch();
}

function normalizedForKey(value) {
  if (Array.isArray(value)) return value.map(normalizedForKey);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalizedForKey(value[key])]),
    );
  }
  return value;
}

function submissionKey(payload) {
  return JSON.stringify(normalizedForKey(payload));
}

export function matchesSubmission(stage, payload) {
  return session.submissionKeys[stage] === submissionKey(payload);
}

export function markSubmission(stage, payload) {
  updateSession({
    submissionKeys: { ...session.submissionKeys, [stage]: submissionKey(payload) },
  });
}

export function clearDownstream(stage) {
  if (stage === 'intake') {
    updateSession({
      intakeResult: null,
      classification: null,
      plan: null,
      feedback: null,
      feedbackText: '',
      blocked: null,
      selectedProfileId: null,
      submissionKeys: { ...session.submissionKeys, classification: null, plan: null },
    });
    return;
  }
  if (stage === 'classification') {
    updateSession({
      plan: null,
      feedback: null,
      feedbackText: '',
      submissionKeys: { ...session.submissionKeys, plan: null },
    });
    return;
  }
  if (stage === 'plan') {
    updateSession({ feedback: null, feedbackText: '' });
    return;
  }
  throw new TypeError(`Unsupported downstream stage: ${stage}`);
}

export function resetSession() {
  const nextEpoch = invalidateRequestEpoch();
  Object.assign(session, createInitialState({
    authReady: session.authReady,
    user: session.user,
    csrfToken: session.csrfToken,
    preAuthCsrfToken: session.preAuthCsrfToken,
  }), { requestEpoch: nextEpoch });
  return nextEpoch;
}
