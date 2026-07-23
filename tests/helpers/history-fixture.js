const CLIENT_RECORD_ID = '99999999-9999-4999-8999-999999999999';

function classificationResult(overrides = {}) {
  return {
    ability: '高',
    will: '高',
    quadrant: 'A',
    type_id: 'A',
    status: '已判定',
    classification_confidence: '高',
    strategy: '委以重任',
    coach_mode: '授权式',
    reason: '能够独立交付且主动承担挑战。',
    evidence: ['能够独立交付且主动承担挑战。'],
    questions: [],
    ...overrides,
  };
}

function planResult(overrides = {}) {
  return {
    entry: ['先确认本周目标与资源。'],
    cautions: ['避免只用结果评价投入。'],
    frequency: '每两周复盘一次。',
    gap_fix: ['把跨部门风险同步拆成可观察行为。'],
    scripts: [
      'Goal（目标）：本周主动完成一次跨部门风险同步。Reality（现状）：当前协作节奏较慢。',
      'Options（可选方案）：可在例会前或里程碑当天同步。Will（行动承诺）：周五前完成首次同步并复盘。',
    ],
    ...overrides,
  };
}

function feedbackResult(overrides = {}) {
  return {
    progress_read: '员工已明确下一步协作目标。',
    next_steps: [
      'Situation（情境）：周五协作复盘。Behavior（行为）：员工主动同步了风险。Impact（影响）：团队提前安排了支持。',
      '下周核对行动结果。',
    ],
    watch_points: ['观察资源阻塞是否持续。'],
    ...overrides,
  };
}

function historySnapshot(overrides = {}) {
  return {
    clientRecordId: CLIENT_RECORD_ID,
    intake: {
      role: '基层管理岗',
      tenure: '1 年以上',
      performance: '持续达标',
      goal: '提升项目影响力。',
      pain: '跨部门协作节奏慢。',
      traits: '主动、务实。',
    },
    answers: [
      { question: '最近一次复盘是什么时候？', answer: '上周五。' },
    ],
    selectedProfileId: 'A',
    classification: classificationResult(),
    plan: planResult(),
    feedbackText: null,
    feedback: null,
    ...overrides,
  };
}

module.exports = {
  CLIENT_RECORD_ID,
  classificationResult,
  feedbackResult,
  historySnapshot,
  planResult,
};
