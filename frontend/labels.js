export const TYPE_LABELS = Object.freeze({
  A: '核心明星型',
  B: '熟手待激活型',
  C: '潜力新兵型',
  D: '待改进型',
  D1: '待改进型',
  D2: '待改进型',
});

export const CLASSIFICATION_LABELS = Object.freeze({
  status: '判定状态',
  classification_confidence: '判断可信度',
  ability: '能力',
  will: '意愿',
  strategy: '用人策略',
  coach_mode: '教练模式',
  reason: '判定说明',
});

export function typeLabel(typeId) {
  return TYPE_LABELS[typeId] || '未判定';
}
