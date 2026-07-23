import { beginRequestEpoch, invalidateRequestEpoch, isCurrentEpoch } from './state.js';

let pendingController = null;
let sessionCsrfToken = null;

export function setSessionCsrfToken(token) {
  sessionCsrfToken = typeof token === 'string' && token ? token : null;
}

async function requestJson(path, {
  method = 'GET',
  body,
  csrfToken,
} = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

  try {
    const response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    const payload = response.status === 204
      ? null
      : await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: payload?.code || 'REQUEST_FAILED',
        message: payload?.message || '请求未完成，请稍后重试。',
      };
    }
    return { ok: true, status: response.status, data: payload };
  } catch {
    return {
      ok: false,
      status: 0,
      code: 'NETWORK_ERROR',
      message: '网络连接异常，请稍后重试。',
    };
  }
}

export function getCurrentUser() {
  return requestJson('/api/auth/me');
}

export function getPreAuthCsrf() {
  return requestJson('/api/auth/csrf');
}

export function registerAccount(username, password, csrfToken) {
  return requestJson('/api/auth/register', {
    method: 'POST',
    csrfToken,
    body: { username, password },
  });
}

export function loginAccount(username, password, csrfToken) {
  return requestJson('/api/auth/login', {
    method: 'POST',
    csrfToken,
    body: { username, password },
  });
}

export function logoutAccount(csrfToken) {
  return requestJson('/api/auth/logout', {
    method: 'POST',
    csrfToken,
  });
}

export function resetPasswordWithRecovery(
  username,
  recoveryCode,
  newPassword,
  csrfToken,
) {
  return requestJson('/api/auth/password/reset-with-recovery', {
    method: 'POST',
    csrfToken,
    body: { username, recoveryCode, newPassword },
  });
}

export function cancelPendingRequests({ invalidate = true } = {}) {
  if (invalidate) invalidateRequestEpoch();
  if (pendingController) {
    pendingController.abort();
    pendingController = null;
  }
}

export function resetApiState() {
  cancelPendingRequests();
}

export async function request(method, payload) {
  const requestEpoch = beginRequestEpoch();
  cancelPendingRequests({ invalidate: false });
  const controller = new AbortController();
  pendingController = controller;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionCsrfToken) headers['X-CSRF-Token'] = sessionCsrfToken;
    const response = await fetch(`/api/coach/${method}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (!isCurrentEpoch(requestEpoch)) return { stale: true, requestEpoch };
    if (!response.ok || !body || typeof body !== 'object') {
      return {
        ok: false,
        message: body && typeof body.message === 'string' ? body.message : '请求未完成，请稍后重试。',
        requestEpoch,
      };
    }
    if (body.ok === false) {
      return {
        ok: false,
        message: typeof body.message === 'string' ? body.message : '请求未完成，请稍后重试。',
        requestEpoch,
      };
    }
    return { ...body, requestEpoch };
  } catch (error) {
    if (error && error.name === 'AbortError') return { stale: true, requestEpoch };
    return isCurrentEpoch(requestEpoch)
      ? { ok: false, message: '网络连接异常，请稍后重试。', requestEpoch }
      : { stale: true, requestEpoch };
  } finally {
    if (pendingController === controller) pendingController = null;
  }
}

export function intake(payload) {
  return request('intake', payload);
}

export function classify(payload) {
  return request('classify', payload);
}

export function generatePlan(payload) {
  return request('plan', payload);
}

export function submitFeedback(payload) {
  return request('feedback', payload);
}
