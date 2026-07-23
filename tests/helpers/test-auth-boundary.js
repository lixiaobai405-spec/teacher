const express = require('express');

function createTestAuthBoundary({ historyRouter = express.Router() } = {}) {
  return Object.freeze({
    historyRouter,
    sessionMiddleware(request, _response, next) {
      request.sessionID = 'test-session-id';
      request.session = { userId: '00000000-0000-4000-8000-000000000000' };
      next();
    },
    router: express.Router(),
    requireAuth(request, _response, next) {
      request.auth = {
        userId: request.session.userId,
        user: { id: request.session.userId, username: 'Test_User' },
      };
      next();
    },
    requireSameOrigin(_request, _response, next) {
      next();
    },
    requireSessionCsrf(_request, _response, next) {
      next();
    },
  });
}

module.exports = { createTestAuthBoundary };
