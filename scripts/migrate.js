const { loadConfig } = require('../server/config.js');
const { openDatabase } = require('../server/database/sqlite.js');

async function main() {
  let database;
  try {
    const config = loadConfig(process.env);
    database = await openDatabase({ filename: config.databasePath });
    process.stdout.write('Database migrations completed.\n');
  } catch (error) {
    const message = error?.code === 'CONFIG_INVALID'
      ? 'Migration failed: invalid configuration.\n'
      : 'Migration failed.\n';
    process.stderr.write(message);
    process.exitCode = 1;
  } finally {
    if (database) {
      await database.close().catch(() => {
        process.stderr.write('Migration failed.\n');
        process.exitCode = 1;
      });
    }
  }
}

main();
