export const TYPE_LABELS = Object.freeze({
  A: '高能力高意愿型',
  B: '成熟待激活型',
  C: '成长发展型',
  D1: '新入职适应型',
  D2: '绩效改进支持型',
});

export function typeLabel(typeId) {
  return TYPE_LABELS[typeId] || '未判定';
}
