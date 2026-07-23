function inputError() {
  return Object.assign(
    new Error(
      'Username must be non-empty and contain only Chinese characters, ASCII letters, numbers, or underscores.',
    ),
    { code: 'INPUT_INVALID' },
  );
}

function validateUsername(value) {
  if (typeof value !== 'string') throw inputError();
  const display = value.trim();
  if (!/^[\p{Script=Han}A-Za-z0-9_]+$/u.test(display)) throw inputError();
  return display;
}

function normalizeUsername(value) {
  return validateUsername(value);
}

module.exports = { normalizeUsername, validateUsername };
