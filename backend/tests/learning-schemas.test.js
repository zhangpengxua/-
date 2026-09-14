const { test } = require('node:test');
const assert = require('node:assert');
const validators = require('../validators/learningSchemas');
const taxonomy = require('../config/knowledgeTaxonomy');

const KP = 'math.calculus.derivative.chain_rule';

test('validateCreateAnalysis：合法输入通过并补默认值', () => {
  const r = validators.validateCreateAnalysis({ conversationIds: ['conv_1', 'conv_2'], requestKey: 'rk-1' });
  assert.equal(r.ok, true);
  assert.equal(r.value.includePracticeResults, true);
  assert.equal(r.value.forceRefresh, false);
});

test('validateCreateAnalysis：非法范围/缺失 requestKey 被拒绝', () => {
  assert.equal(validators.validateCreateAnalysis({ conversationIds: [], requestKey: 'x' }).ok, false);
  assert.equal(validators.validateCreateAnalysis({ conversationIds: ['conv_1'] }).ok, false);
  assert.equal(validators.validateCreateAnalysis({ conversationIds: Array.from({ length: 51 }, (_, i) => `c${i}`), requestKey: 'x' }).ok, false);
  const dup = validators.validateCreateAnalysis({ conversationIds: ['a', 'a'], requestKey: 'x' });
  assert.equal(dup.ok, false);
});

test('validateCreatePractice：数量与难度约束', () => {
  const ok = validators.validateCreatePractice({ analysisId: 'analysis_1', knowledgePointIds: [KP], questionCount: 3, difficulty: 'basic', requestKey: 'rk' });
  assert.equal(ok.ok, true);
  assert.equal(validators.validateCreatePractice({ analysisId: 'a', knowledgePointIds: [KP], questionCount: 4, difficulty: 'basic', requestKey: 'rk' }).ok, false);
  assert.equal(validators.validateCreatePractice({ analysisId: 'a', knowledgePointIds: [KP, KP, KP, KP], questionCount: 3, difficulty: 'basic', requestKey: 'rk' }).ok, false);
  assert.equal(validators.validateCreatePractice({ analysisId: 'a', knowledgePointIds: [KP], questionCount: 3, difficulty: 'easy', requestKey: 'rk' }).ok, false);
});

test('validateSubmitAttempt：必填与长度', () => {
  assert.equal(validators.validateSubmitAttempt({ questionId: 'q1', answer: '4:9', submissionKey: 'sk' }).ok, true);
  assert.equal(validators.validateSubmitAttempt({ questionId: 'q1', answer: '', submissionKey: 'sk' }).ok, false);
  assert.equal(validators.validateSubmitAttempt({ questionId: 'q1', answer: 'x', submissionKey: '' }).ok, false);
});

test('validateBatchExtraction：伪造知识点 ID 与证据 ID 被拒绝', () => {
  const parsed = {
    problems: [{
      problemId: 'conv_1',
      knowledgePoints: [{ id: 'fake.knowledge.point', evidenceRefs: ['ev_1'] }],
      difficulties: [],
    }],
    unmappedTopics: [],
  };
  const r = validators.validateBatchExtraction(parsed, [{ problemId: 'conv_1' }], new Set(['ev_1']));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('fake.knowledge.point')));
});

test('validateBatchExtraction：未归类知识点需要 proposedName', () => {
  const r = validators.validateBatchExtraction({
    problems: [{ problemId: 'conv_1', knowledgePoints: [{ id: null, proposedName: '锥面截线', evidenceRefs: ['ev_1'] }], difficulties: [] }],
    unmappedTopics: ['锥面截线'],
  }, [{ problemId: 'conv_1' }], new Set(['ev_1']));
  assert.equal(r.ok, true);
  assert.equal(r.value.problems[0].knowledgePoints[0].proposedName, '锥面截线');
});

test('validateSummaryOutput：不存在的证据引用被拒绝', () => {
  const r = validators.validateSummaryOutput({
    summary: 'x',
    knowledgePoints: [{ id: KP, assessment: 'review_suggestion', evidenceRefs: ['ev_999'], reason: 'r', reviewAdvice: 'a', trainingGoal: 'g' }],
    limitations: [],
  }, new Set(['ev_1']), new Set(taxonomy.points.map((p) => p.id)));
  assert.equal(r.ok, false);
});

test('validateGenerationOutput：单选题选项与正确项约束', () => {
  const base = {
    knowledgePointId: KP,
    type: 'single_choice',
    stem: '设 y=sin(2x)，求 dy/dx 的表达式。',
    hints: ['先对内层函数求导。'],
    canonical: '2cos(2x)',
    explanation: '链式法则：外层导数乘内层导数。',
    rubric: [{ id: 'r1', description: '正确使用链式法则', points: 2 }],
  };
  const good = validators.validateGenerationOutput({ questions: [{ ...base, options: [{ id: 'A', text: 'cos(2x)' }, { id: 'B', text: '2cos(2x)' }, { id: 'C', text: '-2cos(2x)' }], correctOptionId: 'B' }] }, [KP], new Set());
  assert.equal(good.ok, true);
  const badCorrect = validators.validateGenerationOutput({ questions: [{ ...base, options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }], correctOptionId: 'D' }] }, [KP], new Set());
  assert.equal(badCorrect.ok, false);
  const figure = validators.validateGenerationOutput({ questions: [{ ...base, stem: '如图所示，求导数。', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }], correctOptionId: 'B' }] }, [KP], new Set());
  assert.equal(figure.ok, false);
});

test('validateGradingOutput：评分点区间与覆盖约束', () => {
  const rubric = [{ id: 'r1', description: 'x', points: 1 }, { id: 'r2', description: 'y', points: 1 }];
  const ok = validators.validateGradingOutput({ verdict: 'partially_correct', rubricScores: [{ rubricId: 'r1', score: 1 }, { rubricId: 'r2', score: 0 }], feedback: '部分正确', errorKnowledgePointIds: [KP], confidence: 'high', needsReview: false }, rubric, [KP]);
  assert.equal(ok.ok, true);
  const outOfRange = validators.validateGradingOutput({ verdict: 'correct', rubricScores: [{ rubricId: 'r1', score: 2 }, { rubricId: 'r2', score: 1 }], feedback: '满分反馈', errorKnowledgePointIds: [], confidence: 'high' }, rubric, [KP]);
  assert.equal(outOfRange.ok, false);
  const missing = validators.validateGradingOutput({ verdict: 'correct', rubricScores: [{ rubricId: 'r1', score: 1 }], feedback: '缺评分点', errorKnowledgePointIds: [], confidence: 'high' }, rubric, [KP]);
  assert.equal(missing.ok, false);
});
