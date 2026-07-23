const express = require('express');

const { httpProblem } = require('../http/problem.js');

function credentials(body) {
  if (
    !body
    || typeof body !== 'object'
    || Array.isArray(body)
    || Object.keys(body).some((key) => !['username', 'password'].includes(key))
    || typeof body.username !== 'string'
    || typeof body.password !== 'string'
  ) {
    throw httpProblem('INPUT_INVALID', '用户名或密码格式不正确。', 400);
  }
  return { username: body.username, password: body.password };
}

function recoveryReset(body) {
  if (
    !body
    || typeof body !== 'object'
    || Array.isArray(body)
    || Object.keys(body).some(
      (key) => !['username', 'recoveryCode', 'newPassword'].includes(key),
    )
    || typeof body.username !== 'string'
    || typeof body.recoveryCode !== 'string'
    || typeof body.newPassword !== 'string'
  ) {
    throw httpProblem('INPUT_INVALID', '重置密码信息格式不正确。', 400);
  }
  return {
    username: body.username,
    recoveryCode: body.recoveryCode,
    newPassword: body.newPassword,
  };
}

function currentPassword(body) {
  if (
    !body
    || typeof body !== 'object'
    || Array.isArray(body)
    || Object.keys(body).some((key) => key !== 'password')
    || typeof body.password !== 'string'
  ) {
    throw httpProblem('INPUT_INVALID', '密码格式不正确。', 400);
  }
  return { password: body.password };
}

function regenerate(request) {
  return new Promise((resolve, reject) => request.session.regenerate((error) => (
    error ? reject(error) : resolve()
  )));
}

function save(request) {
  return new Promise((resolve, reject) => request.session.save((error) => (
    error ? reject(error) : resolve()
  )));
}

function destroy(request) {
  return new Promise((resolve, reject) => request.session.destroy((error) => (
    error ? reject(error) : resolve()
  )));
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response)).catch(next);
}

function createAuthRouter({
  authService,
  createPreAuthCsrfToken,
  createSessionCsrfToken,
  limiters,
  requireAuth,
  requirePreAuthCsrf,
  requireSameOrigin,
  requireSessionCsrf,
  sessionCookie,
}) {
  const router = express.Router();

  router.get('/csrf', (_request, response) => {
    response.json({ csrfToken: createPreAuthCsrfToken() });
  });

  router.post(
    '/register',
    requireSameOrigin,
    limiters.register,
    requirePreAuthCsrf,
    asyncRoute(async (request, response) => {
      const result = await authService.register(credentials(request.body));
      response.status(201).json(result);
    }),
  );

  router.post(
    '/login',
    requireSameOrigin,
    limiters.login,
    requirePreAuthCsrf,
    asyncRoute(async (request, response) => {
      const user = await authService.login(credentials(request.body));
      await regenerate(request);
      request.session.userId = user.id;
      await save(request);
      response.json({ user });
    }),
  );

  router.post(
    '/logout',
    requireSameOrigin,
    requireAuth,
    requireSessionCsrf,
    asyncRoute(async (request, response) => {
      await destroy(request);
      response.clearCookie('teacher.sid', {
        httpOnly: sessionCookie.httpOnly,
        secure: sessionCookie.secure,
        sameSite: sessionCookie.sameSite,
        path: sessionCookie.path,
      });
      response.status(204).end();
    }),
  );

  router.post(
    '/password/reset-with-recovery',
    requireSameOrigin,
    limiters.reset,
    requirePreAuthCsrf,
    asyncRoute(async (request, response) => {
      const result = await authService.resetWithRecovery(recoveryReset(request.body));
      response.json(result);
    }),
  );

  router.post(
    '/recovery-code/rotate',
    requireSameOrigin,
    requireAuth,
    requireSessionCsrf,
    asyncRoute(async (request, response) => {
      const result = await authService.rotateRecoveryCode({
        userId: request.auth.user.id,
        ...currentPassword(request.body),
      });
      response.json(result);
    }),
  );

  router.get('/me', requireAuth, (request, response) => {
    response.json({
      user: { id: request.auth.user.id, username: request.auth.user.username },
      csrfToken: createSessionCsrfToken(request.sessionID),
    });
  });

  return router;
}

module.exports = { createAuthRouter };
