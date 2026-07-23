const session = require('express-session');

class SqliteSessionStore extends session.Store {
  constructor({ repository, sessionMaxAgeMs, cookie, createCsrfTokenHash }) {
    super();
    this.repository = repository;
    this.sessionMaxAgeMs = sessionMaxAgeMs;
    this.cookie = Object.freeze({ ...cookie });
    this.createCsrfTokenHash = createCsrfTokenHash;
  }

  get(sessionId, callback) {
    this.repository.findByToken(sessionId).then((stored) => {
      if (!stored) return callback(null, null);
      callback(null, {
        userId: stored.userId,
        cookie: {
          ...this.cookie,
          originalMaxAge: this.sessionMaxAgeMs,
          expires: new Date(stored.expiresAt),
        },
      });
    }, callback);
  }

  set(sessionId, value, callback = () => {}) {
    if (!value?.userId) {
      callback(Object.assign(new Error('Authenticated session user is required.'), {
        code: 'AUTH_REQUIRED',
      }));
      return;
    }

    Promise.resolve(this.createCsrfTokenHash(sessionId)).then((csrfTokenHash) => (
      this.repository.upsert({
        rawSessionId: sessionId,
        userId: value.userId,
        csrfTokenHash,
        sessionMaxAgeMs: this.sessionMaxAgeMs,
      })
    )).then(() => callback(), callback);
  }

  touch(sessionId, value, callback = () => {}) {
    this.repository.touch(sessionId).then(() => callback(), callback);
  }

  destroy(sessionId, callback = () => {}) {
    this.repository.destroyCurrent(sessionId).then(() => callback(), callback);
  }
}

module.exports = { SqliteSessionStore };
