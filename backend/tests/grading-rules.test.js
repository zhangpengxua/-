const { test } = require('node:test');
const assert = require('node:assert');
const gradingService = require('../services/gradingService');
const { installMockLLM } = require('./helpers/mock-llm');

function makeQuestion(overrides = {}) {
  return {
    id: 'question_1',
    sessionId: 'session_1',
    knowledgePointIds: ['math.calculus.derivative.chain_rule'],
    type: 'single_choice',
    stem: '设 y=sin(2x)，求 dy/dx。',
    options: [{ id: 'A', text: 'cos(2x)' }, { id: 'B', text: '2cos(2x)' }, { id: 'C', text: '-2cos(2x)' }],
    hints: ['先求内层导数。'],
    privateAnswer: {
      canonical: '2cos(2x)',
      acceptedVariants: [],
      explanation: '链式法则。',
      rubric: [{ id: 'r1', description: '选择正确导数', points: 2 }],
      maxScore: 2,
      correctOptionId: 'B',
    },
    qualityCheck: { status: 'passed', method: 'model_review' },
    ...overrides,
  };
}

test('单选题：后端比较选项 ID，不调用模型', () => {
  const q = makeQuestion();
  const correct = gradingService.ruleGrade(q, 'b'); // 大小写不敏感
  assert.equal(correct.verdict, 'correct');
  assert.equal(correct.score, 2);
  const wrong = gradingService.ruleGrade(q, 'A');
  assert.equal(wrong.verdict, 'incorrect');
  assert.equal(wrong.score, 0);
});

test('填空题：保守规范化等价（全角/空白/比值与分数/小数）', () => {
  const q = makeQuestion({
    type: 'fill_blank',
    privateAnswer: {
      canonical: '4:9',
      acceptedVariants: ['4/9'],
      explanation: '面积比为半径比的平方。',
      rubric: [{ id: 'r1', description: '写出面积比', points: 1 }],
      maxScore: 1,
    },
  });
  assert.equal(gradingService.ruleGrade(q, ' ４：９ ').verdict, 'correct');   // 全角冒号+数字
  assert.equal(gradingService.ruleGrade(q, '4 / 9').verdict, 'correct');
  assert.equal(gradingService.ruleGrade(q, '0.4444444444444444').verdict, 'correct'); // 有限小数与 4/9 数值等价
  assert.equal(gradingService.ruleGrade(q, '9:4')?.verdict ?? null, null); // 反比不匹配 → 交模型
  assert.equal(gradingService.ruleGrade(q, '2:3')?.verdict ?? null, null);
});

test('填空/简答未命中规则时走模型批改；模型输出按评分点求和', async () => {
  const q = makeQuestion({
    type: 'short_answer',
    privateAnswer: {
      canonical: '先求内层导数 2，再乘外层导数 cos(2x)，得 2cos(2x)。',
      acceptedVariants: [],
      explanation: '链式法则。',
      rubric: [
        { id: 'r1', description: '内层导数正确', points: 1 },
        { id: 'r2', description: '写出最终结果', points: 1 },
      ],
      maxScore: 2,
    },
  });
  const mock = installMockLLM(() => JSON.stringify({
    verdict: 'partially_correct',
    rubricScores: [{ rubricId: 'r1', score: 1 }, { rubricId: 'r2', score: 0 }],
    feedback: '内层导数正确，但最终结果错了。',
    errorKnowledgePointIds: ['math.calculus.derivative.chain_rule'],
    confidence: 'high',
    needsReview: false,
  }));
  try {
    const ctx = { signal: undefined, ensureActive() {}, setStage() {}, setProgress() {} };
    const outcome = await gradingService.modelGrade(q, { answer: '内层导数是 2，答案是 2sin(2x)', reasoning: '' }, ctx);
    assert.equal(outcome.verdict, 'partially_correct'); // 服务端按求和映射，不信任模型自写 verdict 之外的总分
    assert.equal(outcome.score, 1);
  } finally {
    mock.restore();
  }
});

test('模型判 uncertain 时 score 为 null，不按零分统计', async () => {
  const q = makeQuestion({ type: 'short_answer' });
  const mock = installMockLLM(() => JSON.stringify({
    verdict: 'uncertain',
    rubricScores: [{ rubricId: 'r1', score: null }],
    feedback: '标准答案可能有误。',
    errorKnowledgePointIds: [],
    confidence: 'low',
    needsReview: true,
    uncertaintyReason: '题目条件不完整',
  }));
  try {
    const ctx = { ensureActive() {}, setStage() {}, setProgress() {} };
    const outcome = await gradingService.modelGrade(q, { answer: '随便写的', reasoning: '' }, ctx);
    assert.equal(outcome.uncertain, true);
    assert.equal(outcome.score, null);
  } finally {
    mock.restore();
  }
});

test('applyRuleOutcome 将结果写回 attempt 并置 graded', () => {
  const attempt = { id: 'attempt_1', status: 'grading', result: null, gradedAt: null };
  const q = makeQuestion();
  gradingService.applyRuleOutcome(attempt, gradingService.ruleGrade(q, 'B'));
  assert.equal(attempt.status, 'graded');
  assert.equal(attempt.result.score, 2);
  assert.ok(attempt.gradedAt);
});
