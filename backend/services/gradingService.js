// 判题服务：单选题后端比较选项 ID；填空题仅在保守规则范围内做等价比较；其余交模型批改。
// 模型输出经结构与区间校验，总分由服务端按评分点求和；无法可靠判定时保留 uncertain。
const fs = require('fs');
const path = require('path');
const LLMService = require('../utils/llmService');
const { ApiError } = require('../utils/apiError');
const validators = require('../validators/learningSchemas');

const GRADING_PROMPT = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'practice-grading.txt'), 'utf8');

// 保守规范化：去空白/首尾标点、全角转半角、统一冒号括号；不做会改变数学含义的变换。
function normalizeFillAnswer(text) {
  let s = String(text || '').trim().toLowerCase();
  s = s.replace(/[。．，,；;！!？?、]+$/g, '');
  s = s.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  s = s.replace(/\s+/g, '');
  return s;
}

// 有限格式等价：纯小数、简单分数 a/b、比值 a:b 之间的数值相等。
function safeNumericEqual(a, b) {
  const parse = (t) => {
    let m = /^([+-]?\d+(?:\.\d+)?)$/.exec(t);
    if (m) return Number(m[1]);
    m = /^([+-]?\d+(?:\.\d+)?)\/([+-]?\d+(?:\.\d+)?)$/.exec(t);
    if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
    m = /^([+-]?\d+(?:\.\d+)?):([+-]?\d+(?:\.\d+)?)$/.exec(t);
    if (m && Number(m[2]) !== 0) return Number(m[1]) / Number(m[2]);
    return null;
  };
  const va = parse(a);
  const vb = parse(b);
  return va !== null && vb !== null && Math.abs(va - vb) < 1e-9;
}

function fillMatches(answer, candidates) {
  const norm = normalizeFillAnswer(answer);
  return candidates.some((c) => {
    const target = normalizeFillAnswer(c);
    if (!target) return false;
    if (norm === target) return true;
    return safeNumericEqual(norm, target);
  });
}

// 规则可判 → 返回确定结果；否则返回 null（交给模型批改）。
function ruleGrade(question, answer) {
  const maxScore = question.privateAnswer.maxScore;
  if (question.type === 'single_choice') {
    const correct = String(answer || '').trim().toUpperCase() === question.privateAnswer.correctOptionId;
    const rubric = question.privateAnswer.rubric;
    return {
      verdict: correct ? 'correct' : 'incorrect',
      score: correct ? maxScore : 0,
      maxScore,
      rubricScores: rubric.map((r) => ({ rubricId: r.id, score: correct ? r.points : 0 })),
      feedback: correct
        ? '回答正确。'
        : `正确答案是 ${question.privateAnswer.correctOptionId}。`,
      errorKnowledgePointIds: correct ? [] : question.knowledgePointIds,
      confidence: 'high',
      needsReview: false,
      uncertain: false,
    };
  }
  if (question.type === 'fill_blank' && question.knowledgePointIds.every((id) => id.startsWith('math.'))) {
    const candidates = [question.privateAnswer.canonical, ...(question.privateAnswer.acceptedVariants || [])];
    if (fillMatches(answer, candidates)) {
      return {
        verdict: 'correct',
        score: maxScore,
        maxScore,
        rubricScores: question.privateAnswer.rubric.map((r) => ({ rubricId: r.id, score: r.points })),
        feedback: '答案正确。',
        errorKnowledgePointIds: [],
        confidence: 'high',
        needsReview: false,
        uncertain: false,
      };
    }
    // 未命中规则时交给模型批改（可接受其他等价形式，也可判 uncertain）。
    return null;
  }
  return null;
}

function parseModelJson(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) { /* fallthrough */ }
  const stripped = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return { ok: true, value: JSON.parse(stripped) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function modelGrade(question, attempt, ctx) {
  const pa = question.privateAnswer;
  const messages = [{
    role: 'user',
    content: JSON.stringify({
      question: {
        type: question.type,
        stem: question.stem,
        options: question.type === 'single_choice' ? question.options : undefined,
        knowledgePointIds: question.knowledgePointIds,
        knowledgePoints: question.knowledgePointIds.map((id) => require('../config/knowledgeTaxonomy').getPoint(id)),
      },
      canonical: pa.canonical,
      acceptedVariants: pa.acceptedVariants || [],
      explanation: pa.explanation,
      rubric: pa.rubric,
      maxScore: pa.maxScore,
      studentAnswer: attempt.answer,
      studentReasoning: attempt.reasoning || '',
    }),
  }];
  let lastErrors = [];
  for (let round = 0; round < 2; round++) {
    ctx.ensureActive();
    const raw = await LLMService.callLLMStructured(messages, GRADING_PROMPT, 4096, {
      signal: ctx.signal,
      temperature: 0.1,
      taskType: 'learning-grading',
      timeoutMs: Number(process.env.LEARNING_LLM_TIMEOUT_MS) || undefined,
    });
    const parsed = parseModelJson(raw);
    if (!parsed.ok) {
      lastErrors = [`输出不是合法 JSON：${parsed.error}`];
      messages.push({ role: 'assistant', content: raw }, { role: 'user', content: '你的输出无法解析为 JSON，请重新只输出符合 Schema 的 JSON 对象。' });
      continue;
    }
    const check = validators.validateGradingOutput(parsed.value, question.privateAnswer.rubric, question.knowledgePointIds);
    if (check.ok) {
      const value = check.value;
      if (value.verdict === 'uncertain') {
        return { uncertain: true, score: null, ...value };
      }
      // 总分由服务端按评分点求和，并据此映射判定；不信任模型自写总分。
      const score = value.rubricScores.reduce((n, r) => n + (r.score || 0), 0);
      const maxScore = question.privateAnswer.maxScore;
      const derived = score >= maxScore ? 'correct' : score === 0 ? 'incorrect' : 'partially_correct';
      return { ...value, verdict: derived, score, uncertain: false };
    }
    lastErrors = check.errors;
    messages.push({ role: 'assistant', content: raw }, { role: 'user', content: `你的输出存在以下校验问题，请修正后重新只输出 JSON：\n- ${check.errors.join('\n- ')}` });
  }
  throw new ApiError('LLM_INVALID_OUTPUT', '批改输出未通过校验', { details: { errors: lastErrors } });
}

// 将确定结果写回 attempt（规则判题即时路径与模型批改共用）。
function applyRuleOutcome(attempt, outcome) {
  attempt.result = {
    verdict: outcome.verdict,
    score: outcome.uncertain ? null : outcome.score,
    maxScore: outcome.maxScore,
    rubricScores: outcome.rubricScores || [],
    feedback: outcome.feedback,
    errorKnowledgePointIds: outcome.errorKnowledgePointIds || [],
    confidence: outcome.confidence,
    needsReview: outcome.uncertain || outcome.needsReview === true,
    uncertaintyReason: outcome.uncertaintyReason || '',
  };
  attempt.status = 'graded';
  attempt.gradedAt = new Date().toISOString();
  return attempt;
}

// 执行一次批改并写回 attempt；失败向上抛出由任务层标记 grading_failed。
async function gradeAttempt({ attempt, question, ctx }) {
  const outcome = ruleGrade(question, attempt.answer) || await modelGrade(question, attempt, ctx);
  return applyRuleOutcome(attempt, { ...outcome, maxScore: question.privateAnswer.maxScore });
}

module.exports = {
  normalizeFillAnswer,
  safeNumericEqual,
  fillMatches,
  ruleGrade,
  applyRuleOutcome,
  modelGrade,
  gradeAttempt,
};
