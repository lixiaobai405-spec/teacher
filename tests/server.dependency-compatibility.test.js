const assert = require('node:assert/strict');
const test = require('node:test');

test('认证与 SQLite 依赖支持 Node 20 CommonJS', () => {
  assert.equal(Number(process.versions.node.split('.')[0]), 20);
  assert.equal(typeof require('express-session'), 'function');
  assert.equal(typeof require('express-rate-limit').rateLimit, 'function');
  assert.equal(typeof require('sqlite3').Database, 'function');
});
