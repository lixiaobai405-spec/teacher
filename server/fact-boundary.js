const FACT_BOUNDARY_CODES = Object.freeze({
  UNSUPPORTED_DATE: 'UNSUPPORTED_DATE',
  UNSUPPORTED_NUMBER: 'UNSUPPORTED_NUMBER',
  UNSUPPORTED_PERSON: 'UNSUPPORTED_PERSON',
  UNSUPPORTED_RESULT: 'UNSUPPORTED_RESULT',
  UNSUPPORTED_CAUSALITY: 'UNSUPPORTED_CAUSALITY',
});

const DATE_PATTERN = /(?:20\d{2}[年./-]\d{1,2}(?:[月./-]\d{1,2}日?)?|\d{1,2}月\d{1,2}日)/g;
const NUMBER_PATTERN = /(?:\d+(?:\.\d+)?个(?:月|周期)|[零一二两三四五六七八九十百千万]+个(?:月|周期)|\d+(?:\.\d+)?(?:%|次|天|周|月|年|小时|分钟|人|项|个|分|元|周期)|百分之[零一二两三四五六七八九十百千万]+|[零一二两三四五六七八九十百千万]+(?:次|天|周|月|年|小时|分钟|人|项|个|分|元|周期))/g;
const CHINESE_DIGITS = Object.freeze({
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9,
});
const CHINESE_UNITS = Object.freeze({ 十: 10, 百: 100, 千: 1000, 万: 10000 });
const CHINESE_QUANTITY_PATTERN = /^([零一二两三四五六七八九十百千万]+)(次|天|周|月|年|小时|分钟|人|项|个|分|元|周期)$/;
const ARABIC_CLASSIFIED_DURATION_PATTERN = /^(\d+(?:\.\d+)?)个(月|周期)$/;
const CHINESE_CLASSIFIED_DURATION_PATTERN = /^([零一二两三四五六七八九十百千万]+)个(月|周期)$/;
const NUMBER_UNIT_PATTERN = /(次|天|周|月|年|小时|分钟|人|项|个|分|元|周期)$/;
const SUGGESTED_TIME_UNITS = new Set(['次', '天', '周', '月', '年', '小时', '分钟', '周期']);
const SUGGESTION_CONTEXT_MARKERS = Object.freeze([
  '建议', '可以', '可考虑', '下一步', '后续', '未来', '计划', 'Will（行动承诺）',
]);
const FACTUAL_NUMBER_CONTEXT_PATTERN = /(?:当前|目前|近期|最近|过去|此前|现状|实际|已经|已|曾经|曾)/;
const SURNAME = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢邹苏潘葛范彭鲁韦马方任袁唐罗薛伍余姚孟顾尹江钟';
const BARE_PERSON_SURNAME = SURNAME.replace('周', '');
const PERSON_PATTERN = new RegExp(
  `(?:[${SURNAME}][\\u4e00-\\u9fff]{0,2}(?:经理|主管|总监|先生|女士|老师)|(?:[${BARE_PERSON_SURNAME}][\\u4e00-\\u9fff]{1,2}|周(?!主动|[一二三四五六日末前后内])[\\u4e00-\\u9fff]{1,2})(?=表示|指出|认为|负责|完成|导致))`,
  'g',
);
const RESULT_PATTERN = /(?:已经(?!具备|能够|能)|已(?!经|具备|能够|能))(?:[^。！？!?；;\r\n]{0,8})?(?:完成|提升|下降|改善|达成|解决|延期|延误)|(?:完成了|提升了|下降了|改善了|达成了|解决了|同步了|交付了|通过了|结果为|实际影响为)/;
const CAUSALITY_PATTERN = /(?:导致|造成|使得|因此|所以|从而)/;
const UNCERTAIN_PATTERN = /(?:可能|预计|假设|如果|若|建议|可以|可考虑|需补充|待确认|尚不确定|尚未确认)/;
const ANALYSIS_JUDGMENT_PATTERN = /(?:根据(?:已提供|现有|当前)信息(?:分析|判断)|倾向于)/;
const STRUCTURED_LABEL_PATTERN = /^(?:Goal（目标）|Reality（现状）|Options（可选方案）|Will（行动承诺）|Situation（情境）|Behavior（行为）|Impact（影响）)[：:]\s*/;

function collectStrings(value) {
  const values = [];
  const stack = [value];
  const seen = new Set();
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') {
      values.push(current);
    } else if (Array.isArray(current)) {
      stack.push(...current);
    } else if (current && typeof current === 'object' && !seen.has(current)) {
      seen.add(current);
      stack.push(...Object.values(current));
    }
  }
  return values;
}

function collectStringEntries(value) {
  const entries = [];
  const stack = [{ value, path: [] }];
  const seen = new Set();

  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current.value === 'string') {
      entries.push(current);
    } else if (Array.isArray(current.value) && !seen.has(current.value)) {
      seen.add(current.value);
      current.value.forEach((item, index) => {
        stack.push({ value: item, path: [...current.path, index] });
      });
    } else if (current.value && typeof current.value === 'object' && !seen.has(current.value)) {
      seen.add(current.value);
      Object.entries(current.value).forEach(([key, item]) => {
        stack.push({ value: item, path: [...current.path, key] });
      });
    }
  }

  return entries;
}

function compact(value) {
  return String(value || '').replace(/\s+/g, '');
}

function parseChineseInteger(value) {
  let total = 0;
  let section = 0;
  let number = 0;

  for (const character of value) {
    if (Object.hasOwn(CHINESE_DIGITS, character)) {
      number = CHINESE_DIGITS[character];
      continue;
    }

    const unit = CHINESE_UNITS[character];
    if (unit === 10000) {
      section += number;
      total += section * unit;
      section = 0;
      number = 0;
    } else {
      section += (number || 1) * unit;
      number = 0;
    }
  }

  return total + section + number;
}

function normalizeNumberToken(token) {
  const value = compact(token);
  const percent = /^百分之([零一二两三四五六七八九十百千万]+)$/.exec(value);
  if (percent) return `${parseChineseInteger(percent[1])}%`;

  const arabicDuration = ARABIC_CLASSIFIED_DURATION_PATTERN.exec(value);
  if (arabicDuration) return `${arabicDuration[1]}${arabicDuration[2]}`;

  const chineseDuration = CHINESE_CLASSIFIED_DURATION_PATTERN.exec(value);
  if (chineseDuration) return `${parseChineseInteger(chineseDuration[1])}${chineseDuration[2]}`;

  const quantity = CHINESE_QUANTITY_PATTERN.exec(value);
  if (quantity) return `${parseChineseInteger(quantity[1])}${quantity[2]}`;
  return value;
}

function describeNumberKind(token) {
  const value = compact(token);
  const style = /^\d/.test(value) ? 'arabic' : 'chinese';
  if (value.endsWith('%') || value.startsWith('百分之')) return `${style}:percent`;
  const unit = NUMBER_UNIT_PATTERN.exec(value)?.[1];
  return unit ? `${style}:${unit}` : null;
}

function describeFieldPath(path) {
  return path.map((segment, index) => (
    typeof segment === 'number'
      ? `[${segment}]`
      : `${index === 0 ? '' : '.'}${segment}`
  )).join('');
}

function isSuggestedNumberContext(sentence, tokenIndex) {
  const prefix = sentence.slice(0, tokenIndex);
  let markerIndex = -1;
  let markerLength = 0;

  for (const marker of SUGGESTION_CONTEXT_MARKERS) {
    const index = prefix.lastIndexOf(marker);
    if (index > markerIndex) {
      markerIndex = index;
      markerLength = marker.length;
    }
  }

  if (markerIndex < 0) return false;
  const contextAfterMarker = prefix.slice(markerIndex + markerLength);
  const localContext = contextAfterMarker.split(/[，,:：]/).at(-1);
  return !FACTUAL_NUMBER_CONTEXT_PATTERN.test(localContext);
}

function findMissingNumbers(sourceText, generated, allowSuggestedTimeNumbers) {
  const sourceTokens = new Set(
    (sourceText.match(NUMBER_PATTERN) || []).map(normalizeNumberToken),
  );
  const missingNumbers = [];
  const seenMissingNumbers = new Set();

  for (const entry of collectStringEntries(generated)) {
    const isFrequency = entry.path[0] === 'frequency';
    const sentences = entry.value.split(/[。！？!?；;\r\n]+/).filter(Boolean);

    for (const sentence of sentences) {
      for (const match of sentence.matchAll(NUMBER_PATTERN)) {
        const token = match[0];
        if (sourceTokens.has(normalizeNumberToken(token))) continue;

        const unit = NUMBER_UNIT_PATTERN.exec(compact(token))?.[1];
        const isSuggestion = isFrequency || isSuggestedNumberContext(sentence, match.index);
        if (allowSuggestedTimeNumbers && isSuggestion && SUGGESTED_TIME_UNITS.has(unit)) {
          continue;
        }

        const field = describeFieldPath(entry.path);
        const key = `${field}\u0000${token}`;
        if (!seenMissingNumbers.has(key)) {
          seenMissingNumbers.add(key);
          missingNumbers.push({ field, token });
        }
      }
    }
  }

  return missingNumbers;
}

function missingTokens(pattern, generatedText, sourceText, normalizeToken = compact) {
  const sourceTokens = new Set(
    (sourceText.match(pattern) || []).map((token) => normalizeToken(token)),
  );
  const generatedTokens = [...new Set(generatedText.match(pattern) || [])];
  return generatedTokens.filter((token) => !sourceTokens.has(normalizeToken(token)));
}

function findFactBoundaryDiagnostics({
  source,
  generated,
  allowSuggestedTimeNumbers = false,
} = {}) {
  const sourceText = compact(collectStrings(source).join(' '));
  const generatedText = collectStrings(generated).join(' ');
  const issues = [];
  const missingNumbers = findMissingNumbers(
    sourceText,
    generated,
    allowSuggestedTimeNumbers,
  );

  if (missingTokens(DATE_PATTERN, generatedText, sourceText).length > 0) {
    issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_DATE);
  }
  if (missingNumbers.length > 0) {
    issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER);
  }
  if (missingTokens(PERSON_PATTERN, generatedText, sourceText).length > 0) {
    issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_PERSON);
  }

  const sentences = generatedText.split(/[。！？!?；;\r\n]+/).filter(Boolean);
  const unsupported = (pattern, additionalSafePattern) => sentences.some((sentence) => (
    pattern.test(sentence)
    && !UNCERTAIN_PATTERN.test(sentence)
    && !(additionalSafePattern && additionalSafePattern.test(sentence))
    && !sourceText.includes(compact(sentence.replace(STRUCTURED_LABEL_PATTERN, '')))
  ));

  if (unsupported(RESULT_PATTERN)) issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_RESULT);
  if (unsupported(CAUSALITY_PATTERN, ANALYSIS_JUDGMENT_PATTERN)) {
    issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_CAUSALITY);
  }
  return {
    issues,
    numberKinds: [...new Set(
      missingNumbers.map(({ token }) => describeNumberKind(token)).filter(Boolean),
    )].slice(0, 5),
    numberLocations: [...new Map(missingNumbers
      .map(({ field, token }) => ({ field, kind: describeNumberKind(token) }))
      .filter(({ field, kind }) => field && kind)
      .map((location) => [`${location.field}\u0000${location.kind}`, location]))
      .values()]
      .slice(0, 10),
  };
}

function findFactBoundaryIssues(options) {
  return findFactBoundaryDiagnostics(options).issues;
}

module.exports = {
  FACT_BOUNDARY_CODES,
  findFactBoundaryDiagnostics,
  findFactBoundaryIssues,
};
