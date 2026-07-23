const { UUID_PATTERN } = require('./contracts.js');

const UUID = new RegExp(UUID_PATTERN);

function inputError() {
  return Object.assign(new Error('历史分页参数不正确。'), {
    code: 'INPUT_INVALID',
    status: 400,
    expose: true,
  });
}

function normalizeCursorValue(value) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).length !== 2
    || !Object.hasOwn(value, 'createdAt')
    || !Object.hasOwn(value, 'id')
    || typeof value.createdAt !== 'string'
    || typeof value.id !== 'string'
    || !UUID.test(value.id)
  ) {
    throw inputError();
  }
  const timestamp = Date.parse(value.createdAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value.createdAt) {
    throw inputError();
  }
  return { createdAt: value.createdAt, id: value.id };
}

function encodeHistoryCursor(value) {
  const normalized = normalizeCursorValue(value);
  return Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64url');
}

function decodeHistoryCursor(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw inputError();
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw inputError();
    return normalizeCursorValue(JSON.parse(decoded.toString('utf8')));
  } catch {
    throw inputError();
  }
}

function normalizeHistoryLimit(value) {
  if (value == null || value === '') return 20;
  let parsed;
  if (typeof value === 'number') parsed = value;
  else if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) parsed = Number(value);
  else throw inputError();
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw inputError();
  return Math.min(parsed, 50);
}

module.exports = {
  decodeHistoryCursor,
  encodeHistoryCursor,
  normalizeHistoryLimit,
};
