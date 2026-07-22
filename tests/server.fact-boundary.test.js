const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FACT_BOUNDARY_CODES,
  findFactBoundaryDiagnostics,
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

test('根据已提供信息判断的分类依据不被误判为确定性因果', () => {
  assert.deepEqual(findFactBoundaryIssues({
    source: { will_clues: '员工近期主动性和投入度不足。' },
    generated: { reason: '根据已提供信息判断，因此员工意愿偏低。' },
  }), []);
});

test('分析判断语气不豁免无来源的既成结果', () => {
  assert.deepEqual(findFactBoundaryIssues({
    source: { will_clues: '员工近期主动性和投入度不足。' },
    generated: { reason: '根据已提供信息判断，员工已经完成整改，因此意愿提高。' },
  }), [FACT_BOUNDARY_CODES.UNSUPPORTED_RESULT]);
});

test('稳定错误码不包含模型原文或用户事实', () => {
  const issues = findFactBoundaryIssues({
    source: { goal: '提升协作' },
    generated: { result: '2026年8月1日已经提升50%。' },
  });

  assert.equal(issues.every((code) => Object.values(FACT_BOUNDARY_CODES).includes(code)), true);
  assert.equal(issues.some((code) => code.includes('2026') || code.includes('提升协作')), false);
});

test('不把本周主动完成和周五前完成误判为人物', () => {
  const source = {
    goal: '本周主动完成一次跨部门风险同步，并在周五复盘。',
  };

  assert.deepEqual(findFactBoundaryIssues({
    source,
    generated: {
      goal: '本周主动完成一次跨部门风险同步。',
      will: '周五前完成首次同步并复盘。',
    },
  }), []);
});

test('GROW SBI 结构标签不改变已知事实的来源判断', () => {
  assert.deepEqual(findFactBoundaryIssues({
    source: { feedback: '员工在周五主动同步了风险。' },
    generated: { behavior: 'Behavior（行为）：员工在周五主动同步了风险。' },
  }), []);
});

test('不把已有能力事实的已能或已经具备表达误判为既成结果', () => {
  const source = {
    ability: '员工能够独立完成复杂任务，交付质量稳定。',
  };

  assert.deepEqual(findFactBoundaryIssues({
    source,
    generated: {
      reality: 'Reality（现状）：员工已能独立完成复杂任务。',
      entry: '员工已经具备独立完成复杂任务的能力。',
    },
  }), []);

  assert.deepEqual(findFactBoundaryIssues({
    source,
    generated: { result: '项目已经延期。' },
  }), [FACT_BOUNDARY_CODES.UNSUPPORTED_RESULT]);
});

test('中文与阿拉伯数字的等价数量表达共享同一事实来源', () => {
  const source = {
    goal: '未来四周内每周主动汇报一次进展。',
    history: '过去两个绩效周期均完成交付，返工比例为百分之三十。',
  };

  assert.deepEqual(findFactBoundaryIssues({
    source,
    generated: {
      goal: '未来4周内每周主动汇报1次进展。',
      history: '过去2个绩效周期均完成交付，返工比例为30%。',
    },
  }), []);
});

test('仍拒绝事实源中不存在的建议时长和次数', () => {
  assert.deepEqual(findFactBoundaryIssues({
    source: { goal: '提升主动同步意愿。' },
    generated: { frequency: '建议每周沟通3次，每次15分钟。' },
  }), [FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER]);
});

test('步骤 3 策略允许 frequency 中的未来次数与时长', () => {
  assert.deepEqual(findFactBoundaryIssues({
    source: { goal: '提升主动同步意愿。' },
    generated: { frequency: '每2周沟通1次，每次15分钟。' },
    allowSuggestedTimeNumbers: true,
  }), []);
});

test('步骤 3 策略允许其他字段中明确建议的次数与时长', () => {
  assert.deepEqual(findFactBoundaryIssues({
    source: { goal: '提升主动同步意愿。' },
    generated: {
      entry: ['下一步可以在2周内安排1次沟通，每次15分钟。'],
      scripts: ['Will（行动承诺）：在30天内持续跟进。'],
    },
    allowSuggestedTimeNumbers: true,
  }), []);
});

test('步骤 3 策略仍拒绝事实语句中的无来源时长', () => {
  assert.deepEqual(findFactBoundaryIssues({
    source: { goal: '提升主动同步意愿。' },
    generated: { reality: '员工连续2周投入不足。' },
    allowSuggestedTimeNumbers: true,
  }), [FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER]);
});

test('步骤 3 策略把带量词的月份识别为建议时长', () => {
  assert.deepEqual(findFactBoundaryIssues({
    source: { goal: '提升主动同步意愿。' },
    generated: { entry: ['后续可以观察1个月再复盘。'] },
    allowSuggestedTimeNumbers: true,
  }), []);
});

test('步骤 3 策略不允许后置建议标记替事实数字背书', () => {
  assert.deepEqual(findFactBoundaryIssues({
    source: { goal: '提升主动同步意愿。' },
    generated: { entry: '员工已连续2周投入不足，建议后续跟进。' },
    allowSuggestedTimeNumbers: true,
  }), [FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER]);
});

test('步骤 3 策略不允许建议措辞包装无来源事实数字', () => {
  assert.deepEqual(findFactBoundaryIssues({
    source: { goal: '提升主动同步意愿。' },
    generated: { entry: '建议注意：员工已连续2周投入不足。' },
    allowSuggestedTimeNumbers: true,
  }), [FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER]);
});

test('步骤 3 策略允许建议先引用当前情况再给出未来时长', () => {
  assert.deepEqual(findFactBoundaryIssues({
    source: { goal: '提升主动同步意愿。' },
    generated: { entry: '建议结合员工目前情况，在2周内安排1次沟通。' },
    allowSuggestedTimeNumbers: true,
  }), []);
});

test('步骤 3 策略仍拒绝建议中的比例人数金额分数和事项数量', () => {
  assert.deepEqual(findFactBoundaryDiagnostics({
    source: { goal: '提升主动同步意愿。' },
    generated: { entry: '建议由2人完成3项行动，预算20元，目标80分或50%。' },
    allowSuggestedTimeNumbers: true,
  }), {
    issues: [FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER],
    numberKinds: ['arabic:人', 'arabic:项', 'arabic:元', 'arabic:分', 'arabic:percent'],
  });
});

test('数字诊断只返回书写形式和单位而不返回数值或上下文', () => {
  const diagnostics = findFactBoundaryDiagnostics({
    source: { goal: '每周主动汇报一次进展。' },
    generated: {
      frequency: '建议每周1次，每次15分钟，由员工完成。',
    },
  });

  assert.deepEqual(diagnostics, {
    issues: [FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER],
    numberKinds: ['arabic:分钟'],
  });
  assert.doesNotMatch(JSON.stringify(diagnostics), /15|员工|进展/);
});
