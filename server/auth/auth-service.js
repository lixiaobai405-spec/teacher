const crypto = require('node:crypto');

const { httpProblem } = require('../http/problem.js');
const { normalizeUsername, validateUsername } = require('./username.js');

const DUMMY_PASSWORD_HASH = [
  'scrypt',
  'v=1',
  'N=32768',
  'r=8',
  'p=3',
  Buffer.alloc(16).toString('base64url'),
  Buffer.alloc(64).toString('base64url'),
].join('$');
const DUMMY_RECOVERY_CODE_HASH = crypto
  .createHash('sha256')
  .update('0'.repeat(48), 'ascii')
  .digest('base64url');

function inputProblem() {
  return httpProblem('INPUT_INVALID', '用户名或密码格式不正确。', 400);
}

function invalidCredentials() {
  return httpProblem('AUTH_INVALID_CREDENTIALS', '用户名或密码不正确。', 401);
}

function invalidRecoveryCredentials() {
  return httpProblem('AUTH_INVALID_CREDENTIALS', '用户名或恢复码不正确。', 401);
}

function createAuthService({
  database,
  userRepository,
  sessionRepository,
  passwordService,
  recoveryCodeService,
  randomUUID = crypto.randomUUID,
}) {
  return Object.freeze({
    async register({ username, password }) {
      let displayUsername;
      let normalizedUsername;
      try {
        displayUsername = validateUsername(username);
        normalizedUsername = normalizeUsername(displayUsername);
        passwordService.validatePassword(password, normalizedUsername);
      } catch {
        throw inputProblem();
      }

      const passwordHash = await passwordService.hashPassword(password);
      const recoveryCode = recoveryCodeService.generateRecoveryCode();
      const recoveryCodeHash = recoveryCodeService.hashRecoveryCode(recoveryCode);
      const id = randomUUID();

      let user;
      try {
        user = await database.transaction(
          (transaction) => userRepository.createUser(transaction, {
            id,
            username: displayUsername,
            passwordHash,
            recoveryCodeHash,
          }),
        );
      } catch (error) {
        if (error?.code === 'AUTH_USERNAME_TAKEN') {
          throw httpProblem('AUTH_USERNAME_TAKEN', '该用户名已被使用。', 409);
        }
        throw error;
      }

      return {
        user: { id: user.id, username: user.username },
        recoveryCode,
      };
    },

    async login({ username, password }) {
      let user = null;
      try {
        user = await userRepository.findByNormalizedUsername(normalizeUsername(username));
      } catch {
        // Invalid and unknown usernames share the same response and scrypt work.
      }

      const passwordHash = user?.passwordHash || DUMMY_PASSWORD_HASH;
      const valid = typeof password === 'string'
        && await passwordService.verifyPassword(password, passwordHash);
      if (!user || !valid) throw invalidCredentials();

      return { id: user.id, username: user.username };
    },

    async resetWithRecovery({ username, recoveryCode, newPassword }) {
      let user = null;
      let normalizedUsername;
      try {
        normalizedUsername = normalizeUsername(username);
        user = await userRepository.findByNormalizedUsername(normalizedUsername);
      } catch {
        // Invalid and unknown usernames share the same response and recovery-code work.
      }

      const recoveryCodeHash = user?.recoveryCodeHash || DUMMY_RECOVERY_CODE_HASH;
      const recoveryCodeValid = recoveryCodeService.verifyRecoveryCode(
        recoveryCode,
        recoveryCodeHash,
      );
      if (!user || !recoveryCodeValid) throw invalidRecoveryCredentials();

      try {
        passwordService.validatePassword(newPassword, normalizedUsername);
      } catch {
        throw inputProblem();
      }

      const passwordHash = await passwordService.hashPassword(newPassword);
      const nextRecoveryCode = recoveryCodeService.generateRecoveryCode();
      const nextRecoveryCodeHash = recoveryCodeService.hashRecoveryCode(nextRecoveryCode);

      await database.transaction(async (transaction) => {
        const current = await userRepository.findById(user.id, transaction);
        const currentCodeValid = current && recoveryCodeService.verifyRecoveryCode(
          recoveryCode,
          current.recoveryCodeHash,
        );
        if (!currentCodeValid) throw invalidRecoveryCredentials();

        const result = await userRepository.updateCredentials(transaction, {
          userId: current.id,
          passwordHash,
          recoveryCodeHash: nextRecoveryCodeHash,
        });
        if (result.changes !== 1) throw invalidRecoveryCredentials();
        await sessionRepository.destroyAllForUser(transaction, current.id);
      });

      return { recoveryCode: nextRecoveryCode };
    },

    async rotateRecoveryCode({ userId, password }) {
      const user = await userRepository.findById(userId);
      const passwordHash = user?.passwordHash || DUMMY_PASSWORD_HASH;
      const passwordValid = typeof password === 'string'
        && await passwordService.verifyPassword(password, passwordHash);
      if (!user || !passwordValid) throw invalidCredentials();

      const nextRecoveryCode = recoveryCodeService.generateRecoveryCode();
      const nextRecoveryCodeHash = recoveryCodeService.hashRecoveryCode(nextRecoveryCode);

      await database.transaction(async (transaction) => {
        const result = await userRepository.rotateRecoveryCode(transaction, {
          userId: user.id,
          expectedPasswordHash: user.passwordHash,
          recoveryCodeHash: nextRecoveryCodeHash,
        });
        if (result.changes !== 1) throw invalidCredentials();
      });

      return { recoveryCode: nextRecoveryCode };
    },
  });
}

module.exports = { createAuthService };
