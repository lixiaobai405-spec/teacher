const migration = Object.freeze({
  version: 1,
  name: 'create authentication and coaching history tables',
  async up(transaction) {
    await transaction.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        normalized_username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        recovery_code_hash TEXT NOT NULL,
        recovery_code_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX users_normalized_username_unique
        ON users (normalized_username);

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        csrf_token_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX sessions_token_hash_unique
        ON sessions (token_hash);
      CREATE INDEX sessions_user_id_index
        ON sessions (user_id);
      CREATE INDEX sessions_expires_at_index
        ON sessions (expires_at);

      CREATE TABLE coaching_records (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        client_record_id TEXT NOT NULL,
        title TEXT NOT NULL,
        intake_json TEXT NOT NULL,
        answers_json TEXT NOT NULL,
        selected_profile_id TEXT NOT NULL,
        classification_json TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        feedback_text TEXT,
        feedback_json TEXT,
        schema_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX coaching_records_user_client_unique
        ON coaching_records (user_id, client_record_id);
      CREATE INDEX coaching_records_user_created_index
        ON coaching_records (user_id, created_at DESC);
    `);
  },
});

module.exports = migration;
