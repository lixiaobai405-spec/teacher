const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase } = require('../../server/database/sqlite.js');

async function createTestDatabase(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'teacher-database-test-'));
  const filename = path.join(directory, 'test.sqlite');
  let database = await openDatabase({ filename, ...options });

  async function close() {
    if (!database) return;
    const openDatabaseHandle = database;
    database = null;
    await openDatabaseHandle.close();
  }

  t.after(async () => {
    await close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  return { database, filename, directory, close };
}

module.exports = { createTestDatabase };
