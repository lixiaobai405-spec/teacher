const fs = require('node:fs/promises');
const path = require('node:path');

const sqlite3 = require('sqlite3');

const { MIGRATIONS, runMigrations } = require('./migrations.js');

function connect(filename) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filename, (error) => {
      if (error) return reject(error);
      resolve(database);
    });
  });
}

function rawRun(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function rawGet(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (error, row) => {
      if (error) return reject(error);
      resolve(row);
    });
  });
}

function rawAll(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => {
      if (error) return reject(error);
      resolve(rows);
    });
  });
}

function rawExec(database, sql) {
  return new Promise((resolve, reject) => {
    database.exec(sql, (error) => (error ? reject(error) : resolve()));
  });
}

function rawClose(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => (error ? reject(error) : resolve()));
  });
}

function createTransactionClient(database) {
  return Object.freeze({
    run: (sql, params) => rawRun(database, sql, params),
    get: (sql, params) => rawGet(database, sql, params),
    all: (sql, params) => rawAll(database, sql, params),
    exec: (sql) => rawExec(database, sql),
  });
}

async function openDatabase({ filename, migrations = MIGRATIONS }) {
  if (typeof filename !== 'string' || !filename.trim()) {
    throw new TypeError('Database filename is required');
  }
  if (filename !== ':memory:') {
    await fs.mkdir(path.dirname(path.resolve(filename)), { recursive: true });
  }

  const rawDatabase = await connect(filename);
  let queue = Promise.resolve();
  let closed = false;

  function enqueue(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  }

  const database = Object.freeze({
    run(sql, params) {
      return enqueue(() => rawRun(rawDatabase, sql, params));
    },
    get(sql, params) {
      return enqueue(() => rawGet(rawDatabase, sql, params));
    },
    all(sql, params) {
      return enqueue(() => rawAll(rawDatabase, sql, params));
    },
    exec(sql) {
      return enqueue(() => rawExec(rawDatabase, sql));
    },
    transaction(work) {
      return enqueue(async () => {
        await rawExec(rawDatabase, 'BEGIN IMMEDIATE');
        const transaction = createTransactionClient(rawDatabase);
        try {
          const result = await work(transaction);
          await rawExec(rawDatabase, 'COMMIT');
          return result;
        } catch (error) {
          try {
            await rawExec(rawDatabase, 'ROLLBACK');
          } catch {
            // Preserve the operation error that caused the rollback.
          }
          throw error;
        }
      });
    },
    close() {
      return enqueue(async () => {
        if (closed) return;
        closed = true;
        await rawClose(rawDatabase);
      });
    },
  });

  try {
    await rawExec(rawDatabase, 'PRAGMA journal_mode = WAL;');
    await rawExec(rawDatabase, 'PRAGMA foreign_keys = ON;');
    await rawExec(rawDatabase, 'PRAGMA busy_timeout = 5000;');
    await database.transaction((transaction) => runMigrations(transaction, migrations));
    return database;
  } catch (error) {
    await database.close().catch(() => undefined);
    throw error;
  }
}

module.exports = { openDatabase };
