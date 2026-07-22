const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FACT_BOUNDARY_CODES,
  findFactBoundaryIssues,
} = require('../server/fact-boundary.js');

test('拒绝事实源中不存在的日期数字人物结果与因果断言', () => {
  const issues = findFactBoundaryIssues({
    source: {
      goal: '提升主动同步意识',
      pain: '员工通常需要主管提醒，实际影响尚未说明',
    },
    generated: {
      reason: '张经理指出员工在2026年7月15日导致项目进度下降30%，并且已连续三次完成整改。',
    },
  });

  assert.deepEqual(issues, [
    FACT_BOUNDARY_CODES.UNSUPPORTED_DATE,
    FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER,
    FACT_BOUNDARY_CODES.UNSUPPORTED_PERSON,
    FACT_BOUNDARY_CODES.UNSUPPORTED_RESULT,
    FACT_BOUNDARY_CODES.UNSUPPORTED_CAUSALITY,
  ]);
});

test('接受输入中已有的具体事实以及明确待确认或可能性表达', () => {
  const knownSentence = '张经理指出延期导致客户复核增加。';
  const source = {
    note: `${knownSentence} 复盘日期为2026年7月15日，返工比例为30%。`,
  };

  assert.deepEqual(findFactBoundaryIssues({
    source,
    generated: {
      evidence: [knownSentence, '复盘日期为2026年7月15日，返工比例为30%。'],
      impact: '需补充该行为造成的具体影响。',
      analysis: '根据现有信息判断，该行为可能导致协作风险，具体结果待确认。',
    },
  }), []);
});

test('稳定错误码不包含模型原文或用户事实', () => {
  const issues = findFactBoundaryIssues({
    source: { goal: '提升协作' },
    generated: { result: '2026年8月1日已经提升50%。' },
  });

  assert.equal(issues.every((code) => Object.values(FACT_BOUNDARY_CODES).includes(code)), true);
  assert.equal(issues.some((code) => code.includes('2026') || code.includes('提升协作')), false);
});
