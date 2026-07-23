const Ajv = require('ajv');

const {
  validateClassification,
  validateFeedback,
  validatePlan,
} = require('../contracts.js');

const HISTORY_SCHEMA_VERSION = 1;
const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const text = { type: 'string', maxLength: 2000 };
const requiredText = { ...text, minLength: 1 };
const ajv = new Ajv({ allErrors: true, strict: true });

const snapshotSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'clientRecordId',
    'intake',
    'answers',
    'selectedProfileId',
    'classification',
    'plan',
    'feedbackText',
    'feedback',
  ],
  properties: {
    clientRecordId: { type: 'string', pattern: UUID_PATTERN },
    intake: {
      type: 'object',
      additionalProperties: false,
      required: ['role', 'tenure', 'performance', 'goal', 'pain', 'traits'],
      properties: {
        role: requiredText,
        tenure: requiredText,
        performance: requiredText,
        goal: text,
        pain: text,
        traits: text,
      },
    },
    answers: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'answer'],
        properties: {
          question: requiredText,
          answer: requiredText,
        },
      },
    },
    selectedProfileId: { enum: ['A', 'B', 'C', 'D'] },
    classification: { type: 'object' },
    plan: { type: 'object' },
    feedbackText: { anyOf: [text, { type: 'null' }] },
    feedback: { anyOf: [{ type: 'object' }, { type: 'null' }] },
  },
};

const validateShape = ajv.compile(snapshotSchema);

function inputError() {
  return Object.assign(new Error('历史快照格式不正确。'), {
    code: 'INPUT_INVALID',
    status: 400,
    expose: true,
  });
}

function dataError() {
  return Object.assign(new Error('历史数据暂时无法读取。'), {
    code: 'HISTORY_DATA_INVALID',
    status: 500,
    expose: false,
  });
}

function publicProfileId(typeId) {
  if (typeId === 'D1' || typeId === 'D2') return 'D';
  return ['A', 'B', 'C'].includes(typeId) ? typeId : null;
}

function assertSemantics(snapshot) {
  if (
    snapshot.intake.role.trim().length === 0
    || snapshot.intake.tenure.trim().length === 0
    || snapshot.intake.performance.trim().length === 0
    || snapshot.answers.some(
      ({ question, answer }) => !question.trim() || !answer.trim(),
    )
    || !validateClassification(snapshot.classification)
    || snapshot.classification.status !== '已判定'
    || publicProfileId(snapshot.classification.type_id) !== snapshot.selectedProfileId
    || !validatePlan(snapshot.plan, { typeId: snapshot.classification.type_id })
  ) {
    throw inputError();
  }

  const feedbackBothNull = snapshot.feedbackText === null && snapshot.feedback === null;
  const feedbackBothPresent = typeof snapshot.feedbackText === 'string'
    && snapshot.feedback !== null
    && validateFeedback(snapshot.feedback, {
      requireSbi: snapshot.feedbackText.trim().length > 0,
    });
  if (!feedbackBothNull && !feedbackBothPresent) throw inputError();
}

function validateHistorySnapshot(value) {
  if (!validateShape(value)) throw inputError();
  assertSemantics(value);
  return JSON.parse(JSON.stringify(value));
}

function decodeStoredSnapshot(record) {
  try {
    if (!record || record.schemaVersion !== HISTORY_SCHEMA_VERSION) throw dataError();
    return validateHistorySnapshot({
      clientRecordId: record.clientRecordId,
      intake: JSON.parse(record.intakeJson),
      answers: JSON.parse(record.answersJson),
      selectedProfileId: record.selectedProfileId,
      classification: JSON.parse(record.classificationJson),
      plan: JSON.parse(record.planJson),
      feedbackText: record.feedbackText,
      feedback: record.feedbackJson === null ? null : JSON.parse(record.feedbackJson),
    });
  } catch {
    throw dataError();
  }
}

module.exports = {
  HISTORY_SCHEMA_VERSION,
  UUID_PATTERN,
  decodeStoredSnapshot,
  validateHistorySnapshot,
};
