function configError(message) {
  return Object.assign(new Error(message), { code: 'CONFIG_INVALID' });
}

function requiredText(environment, key) {
  const value = environment[key] == null ? '' : String(environment[key]).trim();
  if (!value) throw configError(`Missing required environment variable: ${key}`);
  return value;
}

function requiredBoolean(environment, key) {
  const value = requiredText(environment, key).toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw configError(`Invalid boolean environment variable: ${key}`);
}

function loadConfig(environment = {}) {
  const sessionSecret = requiredText(environment, 'SESSION_SECRET');
  if (Buffer.byteLength(sessionSecret, 'utf8') < 48) {
    throw configError('SESSION_SECRET must contain at least 48 bytes');
  }

  const rawSessionMaxAgeMs = requiredText(environment, 'SESSION_MAX_AGE_MS');
  const sessionMaxAgeMs = Number(rawSessionMaxAgeMs);
  if (!Number.isInteger(sessionMaxAgeMs) || sessionMaxAgeMs !== 604_800_000) {
    throw configError('SESSION_MAX_AGE_MS must be 604800000');
  }

  return Object.freeze({
    databasePath: requiredText(environment, 'DATABASE_PATH'),
    sessionSecret,
    sessionCookieSecure: requiredBoolean(environment, 'SESSION_COOKIE_SECURE'),
    sessionMaxAgeMs,
  });
}

module.exports = { loadConfig };
