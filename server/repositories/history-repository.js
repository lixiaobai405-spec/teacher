const crypto = require('node:crypto');

const {
  HISTORY_SCHEMA_VERSION,
  UUID_PATTERN,
  decodeStoredSnapshot,
  validateHistorySnapshot,
} = require('../history/contracts.js');
const {
  decodeHistoryCursor,
  encodeHistoryCursor,
  normalizeHistoryLimit,
} = require('../history/cursor.js');

const UUID = new RegExp(UUID_PATTERN);
const DETAIL_COLUMNS = `
  id, client_record_id, title, intake_json, answers_json, selected_profile_id,
  classification_json, plan_json, feedback_text, feedback_json, schema_version,
  created_at, updated_at
`;

function authRequired() {
  return Object.assign(new Error('Authenticated userId is required.'), {
    code: 'AUTH_REQUIRED',
    status: 401,
    expose: true,
  });
}

function requireUserId(userId) {
  if (typeof userId !== 'string' || !UUID.test(userId)) throw authRequired();
  return userId;
}

function mapSummary(row) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function storedSnapshot(row) {
  return decodeStoredSnapshot({
    clientRecordId: row.client_record_id,
    intakeJson: row.intake_json,
    answersJson: row.answers_json,
    selectedProfileId: row.selected_profile_id,
    classificationJson: row.classification_json,
    planJson: row.plan_json,
    feedbackText: row.feedback_text,
    feedbackJson: row.feedback_json,
    schemaVersion: row.schema_version,
  });
}

function mapDetail(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    ...storedSnapshot(row),
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function historyTitle(snapshot, timestamp) {
  const date = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
  }).format(new Date(timestamp));
  return `${snapshot.intake.role} · ${date}`;
}

function createHistoryRepository({
  database,
  now = () => new Date().toISOString(),
  randomUUID = crypto.randomUUID,
}) {
  return Object.freeze({
    async save({ userId, snapshot } = {}) {
      const ownerId = requireUserId(userId);
      const value = validateHistorySnapshot(snapshot);
      const id = randomUUID();
      if (!UUID.test(id)) throw new Error('History UUID source returned an invalid result.');
      const timestamp = now();
      if (
        !Number.isFinite(Date.parse(timestamp))
        || new Date(timestamp).toISOString() !== timestamp
      ) {
        throw new Error('History clock returned an invalid timestamp.');
      }

      return database.transaction(async (transaction) => {
        const inserted = await transaction.run(
          `INSERT INTO coaching_records (
            id, user_id, client_record_id, title, intake_json, answers_json,
            selected_profile_id, classification_json, plan_json, feedback_text,
            feedback_json, schema_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, client_record_id) DO NOTHING`,
          [
            id,
            ownerId,
            value.clientRecordId,
            historyTitle(value, timestamp),
            JSON.stringify(value.intake),
            JSON.stringify(value.answers),
            value.selectedProfileId,
            JSON.stringify(value.classification),
            JSON.stringify(value.plan),
            value.feedbackText,
            value.feedback === null ? null : JSON.stringify(value.feedback),
            HISTORY_SCHEMA_VERSION,
            timestamp,
            timestamp,
          ],
        );

        if (inserted.changes === 0) {
          const currentRow = await transaction.get(
            `SELECT ${DETAIL_COLUMNS}
             FROM coaching_records
             WHERE user_id = ? AND client_record_id = ?`,
            [ownerId, value.clientRecordId],
          );
          const current = storedSnapshot(currentRow);
          validateHistorySnapshot({
            ...current,
            plan: value.plan,
            feedbackText: value.feedbackText,
            feedback: value.feedback,
          });
          await transaction.run(
            `UPDATE coaching_records
             SET plan_json = ?,
                 feedback_text = ?,
                 feedback_json = ?,
                 updated_at = ?
             WHERE user_id = ? AND client_record_id = ?`,
            [
              JSON.stringify(value.plan),
              value.feedbackText,
              value.feedback === null ? null : JSON.stringify(value.feedback),
              timestamp,
              ownerId,
              value.clientRecordId,
            ],
          );
        }

        const row = await transaction.get(
          `SELECT ${DETAIL_COLUMNS}
           FROM coaching_records
           WHERE user_id = ? AND client_record_id = ?`,
          [ownerId, value.clientRecordId],
        );
        return { created: inserted.changes === 1, item: mapDetail(row) };
      });
    },

    async list({ userId, limit, cursor } = {}) {
      const ownerId = requireUserId(userId);
      const pageSize = normalizeHistoryLimit(limit);
      const boundary = decodeHistoryCursor(cursor);
      const params = [ownerId];
      let cursorSql = '';
      if (boundary) {
        cursorSql = 'AND (created_at < ? OR (created_at = ? AND id < ?))';
        params.push(boundary.createdAt, boundary.createdAt, boundary.id);
      }
      params.push(pageSize + 1);
      const rows = await database.all(
        `SELECT id, title, created_at, updated_at
         FROM coaching_records
         WHERE user_id = ?
         ${cursorSql}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
        params,
      );
      const hasMore = rows.length > pageSize;
      const items = rows.slice(0, pageSize).map(mapSummary);
      const last = items.at(-1);
      return {
        items,
        nextCursor: hasMore && last
          ? encodeHistoryCursor({ createdAt: last.createdAt, id: last.id })
          : null,
      };
    },

    async getById({ userId, id } = {}) {
      const ownerId = requireUserId(userId);
      if (typeof id !== 'string' || !UUID.test(id)) return null;
      const row = await database.get(
        `SELECT ${DETAIL_COLUMNS}
         FROM coaching_records
         WHERE id = ? AND user_id = ?`,
        [id, ownerId],
      );
      return mapDetail(row);
    },

    async deleteById({ userId, id } = {}) {
      const ownerId = requireUserId(userId);
      if (typeof id !== 'string' || !UUID.test(id)) return false;
      const result = await database.run(
        'DELETE FROM coaching_records WHERE id = ? AND user_id = ?',
        [id, ownerId],
      );
      return result.changes === 1;
    },
  });
}

module.exports = { createHistoryRepository };
