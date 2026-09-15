const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server');
const conversationRepository = require('../repositories/conversationRepository');
const learningRepository = require('../repositories/learningRepository');
const learningJobService = require('../services/learningJobService');
const evidenceService = require('../services/historyEvidenceService');
const { installMockLLM, waitFor } = require('./helpers/mock-llm');

const KP = 'math.calculus.derivative.chain_rule';
let server;
let base;
let mock;
let gradingDelayMs = 0;
let gradingShouldFail = false;

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/learning`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (mock) mock.restore();
});

beforeEach(() => {
  conversationRepository.__resetForTests();
  learningRepository.__resetForTests();
  learningJobService.__resetForTests();
  gradingDelayMs = 0;
  gradingShouldFail = false;
});

function seedUserProblem({ stem, followups = [] }) {
  const conv = conversationRepository.createConversation({ source: 'user_problem' });
  conversationRepository.appendUserMessage(conv, { content: stem, kind: 'question', source: 'user_problem' });
  for (const f of followups) {
    conversationRepository.appendUserMessage(conv, { content: `针对题目追问：${stem}\n当前步骤：步骤\n学生问题：${f}`, kind: 'followup', studentQuestion: f, source: 'user_problem' });
  }
  return conv;
}

function analysisHandlerFor(convs) {
  const fixture = (() => {
    const { samples, evidence } = evidenceService.buildLearningSamples(convs);
    return {
      problems: samples.map((s) => ({
        problemId: s.problemId,
        knowledgePoints: [{ id: KP, evidenceRefs: ['ev_1', ...s.followups.map((f) => f.evidenceRef)] }],
        difficulties: s.followups.length ? [{ knowledgePointId: KP, strength: 'explicit_confusion', description: '对链式法则有疑问', evidenceRefs: [s.followups[0].evidenceRef] }] : [],
      })),
      unmappedTopics: [],
      evidenceIds: evidence.map((e) => e.id),
    };
  })();
  return ({ systemPrompt, messages }) => {
    if (systemPrompt.includes('学习诊断助手')) {
      if (messages[0].content.includes('"task":"summarize"')) {
        return JSON.stringify({
          summary: '建议复习链式法则。',
          knowledgePoints: [{ id: KP, assessment: 'suspected_weakness', reason: '追问表达疑问。', evidenceRefs: fixture.evidenceIds.slice(0, 1), reviewAdvice: '先分内外层。', trainingGoal: '独立求导。' }],
          limitations: [],
        });
      }
      return JSON.stringify(fixture);
    }
    if (systemPrompt.includes('训练题设计助手')) {
      return JSON.stringify({
        questions: [
          {
            knowledgePointId: KP, type: 'single_choice',
            stem: '设 y=sin(2x)，下列哪项是 dy/dx？',
            options: [{ id: 'A', text: 'cos(2x)' }, { id: 'B', text: '2cos(2x)' }, { id: 'C', text: '-2cos(2x)' }],
            correctOptionId: 'B',
            hints: ['先对内层 2x 求导。'],
            canonical: '2cos(2x)', acceptedVariants: [],
            explanation: '链式法则：y′ = cos(2x)·2 = 2cos(2x)。',
            rubric: [{ id: 'r1', description: '选择正确导数', points: 2 }],
            targetSkill: 'direct_application',
          },
          {
            knowledgePointId: KP, type: 'fill_blank',
            stem: '设 f(x)=sin(2x)，则 f′(0)=____。',
            hints: ['f′(x)=2cos(2x)。'],
            canonical: '2', acceptedVariants: ['2.0'],
            explanation: 'f′(x)=2cos(2x)，f′(0)=2。',
            rubric: [{ id: 'r1', description: '写出正确数值', points: 1 }],
            targetSkill: 'direct_application',
          },
          {
            knowledgePointId: KP, type: 'short_answer',
            stem: '用链式法则说明 y=sin(2x) 的求导过程并写出结果。',
            hints: ['区分内外层函数。', '外层导数乘内层导数。'],
            canonical: 'y′=2cos(2x)',
            acceptedVariants: ['2cos(2x)'],
            explanation: '内层 u=2x，u′=2；外层 sin(u) 的导数为 cos(u)；相乘得 2cos(2x)。',
            rubric: [{ id: 'r1', description: '指出内层导数为 2', points: 1 }, { id: 'r2', description: '写出最终结果 2cos(2x)', points: 1 }],
            targetSkill: 'near_transfer',
          },
        ],
      });
    }
    if (systemPrompt.includes('审校助手')) {
      return JSON.stringify({ reviews: [{ index: 0, status: 'passed', issues: [] }, { index: 1, status: 'passed', issues: [] }, { index: 2, status: 'passed', issues: [] }] });
    }
    if (systemPrompt.includes('作答评估助手')) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (gradingShouldFail) {
            const e = new Error('connection reset');
            e.code = 'ECONNRESET';
            reject(e);
            return;
          }
          resolve(JSON.stringify({
            verdict: 'correct',
            rubricScores: [{ rubricId: 'r1', score: 1 }, { rubricId: 'r2', score: 1 }],
            feedback: '过程与结果正确。',
            errorKnowledgePointIds: [],
            confidence: 'high',
            needsReview: false,
          }));
        }, gradingDelayMs);
      });
    }
    throw new Error('unexpected prompt: ' + systemPrompt.slice(0, 30));
  };
}

function useHandler(convs) {
  if (mock) mock.restore();
  mock = installMockLLM(analysisHandlerFor(convs));
}

test('跨学科同义知识点归并后可出题、批改，并回流到同一知识点', async () => {
  const taxonomy = require('../config/knowledgeTaxonomy');
  const a = seedUserProblem({ stem: '在8位补码表示下，两个正整数相加为何可能得到负数？' });
  const b = seedUserProblem({ stem: '解释带符号整数相加超出表示范围的判断规则。' });
  let kpId;
  if (mock) mock.restore();
  mock = installMockLLM(({ messages, options }) => {
    const input = JSON.parse(messages[0].content);
    if (options.taskType === 'learning-classification') {
      const existing = input.knowledgeTaxonomy.find((p) => p.name === '补码加法溢出判定');
      if (existing) return JSON.stringify({ existingId: existing.id, reason: '同一补码溢出规则的不同表述' });
      return JSON.stringify({ newPoint: { name: '补码加法溢出判定', path: ['计算机科学', '数据表示'], aliases: ['有符号加法溢出'], definition: '定长补码中两个同号数相加结果变号时发生溢出。', boundary: '区别于无符号加法的最高位进位。' }, reason: '现有数学目录未覆盖该规则' });
    }
    if (options.taskType === 'learning-analysis' && input.task === 'extract') {
      return JSON.stringify({ problems: input.samples.map((s) => ({ problemId: s.problemId, knowledgePoints: [{ id: null, proposedName: s.questionText.includes('8位') ? '补码正数相加变号' : '有符号相加越界', evidenceRefs: input.evidence.filter((e) => e.conversationId === s.problemId).map((e) => e.id) }], difficulties: [] })) });
    }
    if (options.taskType === 'learning-analysis') {
      kpId = input.batches[0].problems[0].knowledgePoints[0].id;
      assert.ok(input.batches.every((batch) => batch.problems.every((p) => p.knowledgePoints[0].id === kpId)));
      return JSON.stringify({ summary: '复习补码加法溢出规则。', knowledgePoints: [{ id: kpId, assessment: input.independentAttempts.length ? 'observed_error' : 'review_suggestion', evidenceRefs: input.evidence.map((e) => e.id), reason: '根据题目及独立作答分析。', reviewAdvice: '区分进位与溢出。', trainingGoal: '正确判断有符号溢出。' }] });
    }
    if (options.taskType === 'learning-practice') {
      assert.equal(input.knowledgePoints[0].definition, taxonomy.getPoint(kpId).definition);
      return JSON.stringify({ questions: [1, 2, 3].map((n) => ({ knowledgePointId: kpId, type: 'short_answer', stem: `训练${n}：请说明8位补码中两个正数相加的溢出判断依据。`, hints: ['观察结果符号。'], canonical: '两个正数相加结果为负数则溢出。', explanation: '定长补码超出最大正数时，结果的符号位可能变为1。', rubric: [{ id: 'r1', description: '正确区分结果符号与最高位进位', points: 1 }], targetSkill: 'direct_application' })) });
    }
    if (options.taskType === 'learning-review') {
      assert.equal(input.questions[0].knowledgePoint.id, kpId);
      return JSON.stringify({ reviews: [0, 1, 2].map((index) => ({ index, status: 'passed', issues: [] })) });
    }
    if (options.taskType === 'learning-grading') {
      assert.equal(input.question.knowledgePoints[0].id, kpId);
      return JSON.stringify({ verdict: 'incorrect', rubricScores: [{ rubricId: 'r1', score: 0 }], feedback: '混淆无符号进位与有符号溢出。', errorKnowledgePointIds: [kpId], confidence: 'high', needsReview: false });
    }
    throw new Error('unexpected task');
  });
  let seq = 0;
  const jobResult = async (url, body) => {
    const res = await jsonFetch(url, { method: 'POST', body: { ...body, requestKey: `adaptive-${++seq}` } });
    assert.equal(res.status, 202, JSON.stringify(res.data));
    let job;
    assert.ok(await waitFor(async () => {
      job = (await jsonFetch(`/jobs/${res.data.jobId}`)).data;
      return ['completed', 'failed'].includes(job.status);
    }));
    assert.equal(job.status, 'completed', JSON.stringify(job.error));
    return job.result;
  };
  const analyze = async (convs) => {
    const result = await jobResult('/analyses', { conversationIds: convs.map((c) => c._id), forceRefresh: true, includePracticeResults: true });
    return (await jsonFetch(`/analyses/${result.analysisId}`)).data;
  };
  const first = await analyze([a]);
  const second = await analyze([b]);
  assert.equal(first.knowledgePoints[0].id, second.knowledgePoints[0].id);
  const combined = await analyze([a, b]);
  assert.equal(combined.knowledgePoints.length, 1);
  assert.equal(combined.knowledgePoints[0].unmapped, false);
  assert.equal(combined.knowledgePoints[0].relatedProblemCount, 2);
  const generated = await jobResult('/practice-sessions', { analysisId: combined.id, knowledgePointIds: [kpId], questionCount: 3, difficulty: 'basic' });
  const session = (await jsonFetch(`/practice-sessions/${generated.sessionId}`)).data;
  assert.equal(session.questions.length, 3);
  await jobResult(`/practice-sessions/${session.id}/attempts`, { questionId: session.questions[0].id, answer: '最高位有进位就是有符号溢出', submissionKey: 'adaptive-answer' });
  const updated = await analyze([a, b]);
  assert.equal(updated.knowledgePoints[0].id, kpId);
  assert.equal(updated.knowledgePoints[0].assessment, 'observed_error');
  assert.equal(updated.knowledgePoints[0].performance.incorrect, 1);
});

test('empty initial candidates can regenerate using the originally selected knowledge points', async () => {
  const conv = seedUserProblem({ stem: '求复合函数 y=sin(3x) 的导数并说明链式法则。' });
  const analysis = await runAnalysisJob([conv]);
  mock.restore();
  const normal = analysisHandlerFor([conv]);
  let generationCalls = 0;
  mock = installMockLLM((args) => {
    if (args.options.taskType === 'learning-practice') {
      generationCalls++;
      if (generationCalls === 1) return JSON.stringify({ questions: [] });
      const payload = JSON.parse(args.messages[0].content);
      assert.deepEqual(payload.knowledgePoints.map((kp) => kp.id), [KP]);
      assert.deepEqual(payload.quota, [3]);
    }
    return normal(args);
  });
  const session = await createPracticeSession(analysis);
  assert.equal(session.questions.length, 3);
  assert.equal(generationCalls, 2);
});

async function jsonFetch(path, options = {}) {
  const res = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  if (res.status !== 204) data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function runAnalysisJob(convs, { requestKey = 'rk-analysis', forceRefresh = false } = {}) {
  useHandler(convs);
  const created = await jsonFetch('/analyses', { method: 'POST', body: { conversationIds: convs.map((c) => c._id), includePracticeResults: true, forceRefresh, requestKey } });
  assert.equal(created.status, 202);
  const jobId = created.data.jobId;
  await waitFor(async () => ['completed', 'failed', 'cancelled'].includes((await jsonFetch(`/jobs/${jobId}`)).data.status), { intervalMs: 30 });
  const job = (await jsonFetch(`/jobs/${jobId}`)).data;
  assert.equal(job.status, 'completed', JSON.stringify(job.error));
  return (await jsonFetch(`/analyses/${job.result.analysisId}`)).data;
}

async function createPracticeSession(analysis, { requestKey = 'rk-practice' } = {}) {
  const created = await jsonFetch('/practice-sessions', {
    method: 'POST',
    body: { analysisId: analysis.id, knowledgePointIds: [KP], questionCount: 3, difficulty: 'basic', requestKey },
  });
  assert.equal(created.status, 202);
  await waitFor(async () => ['completed', 'failed', 'cancelled'].includes((await jsonFetch(`/jobs/${created.data.jobId}`)).data.status), { intervalMs: 30 });
  const job = (await jsonFetch(`/jobs/${created.data.jobId}`)).data;
  assert.equal(job.status, 'completed', JSON.stringify(job.error));
  return (await jsonFetch(`/practice-sessions/${job.result.sessionId}`)).data;
}

test('历史接口：返回可分析状态，demo 与空对话被标记', async () => {
  const ok = seedUserProblem({ stem: '求 y=x^2 的导数。' });
  const demo = conversationRepository.createConversation({ source: 'demo' });
  conversationRepository.appendUserMessage(demo, { content: evidenceService.DEMO_EXAMPLE, kind: 'question', source: 'demo' });
  const empty = conversationRepository.createConversation({});
  const { status, data } = await jsonFetch('/history?limit=50');
  assert.equal(status, 200);
  const byId = new Map(data.items.map((i) => [i.id, i]));
  assert.equal(byId.get(ok._id).analyzable, true);
  assert.equal(byId.get(demo._id).analyzable, false);
  assert.equal(byId.get(demo._id).analyzabilityReason, 'demo_source');
  assert.equal(byId.get(empty._id).analyzable, false);
});

test('幂等：同一 requestKey 返回同一任务；同键不同内容返回 409', async () => {
  const conv = seedUserProblem({ stem: '求 y=sin(2x) 的导数。', followups: ['为什么有系数 2？'] });
  useHandler([conv]);
  const body = { conversationIds: [conv._id], requestKey: 'rk-same' };
  const first = await jsonFetch('/analyses', { method: 'POST', body });
  const second = await jsonFetch('/analyses', { method: 'POST', body });
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(first.data.jobId, second.data.jobId);
  assert.equal(second.data.existing, true);
  const conflict = await jsonFetch('/analyses', { method: 'POST', body: { ...body, forceRefresh: true } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error.code, 'IDEMPOTENCY_CONFLICT');
});

test('完整闭环：分析 → 出题（公开 DTO 不泄漏答案）→ 作答 → 批改 → 结果统计', async () => {
  const conv = seedUserProblem({ stem: '求 y=sin(2x) 的导数。', followups: ['为什么要用链式法则？'] });
  const analysis = await runAnalysisJob([conv]);
  assert.equal(analysis.knowledgePoints.length, 1);

  const session = await createPracticeSession(analysis);
  assert.equal(session.questions.length, 3);
  // 未作答时公开响应不含标准答案/评分点/正确选项/提示内容（选项文本本身是公开的）
  const sessionStr = JSON.stringify(session);
  assert.ok(!sessionStr.includes('"rubric"'));
  assert.ok(!sessionStr.includes('"canonical"'));
  assert.ok(!sessionStr.includes('correctOptionId'));
  assert.ok(!sessionStr.includes('链式法则：y′'));
  assert.ok(!sessionStr.includes('先对内层 2x 求导'));
  for (const q of session.questions) {
    assert.ok(!('answerRelease' in q));
    assert.equal(q.hints.length, 0);
    assert.ok(q.hintsAvailable >= 1);
  }

  const q1 = session.questions.find((q) => q.type === 'single_choice');
  const q2 = session.questions.find((q) => q.type === 'fill_blank');
  const q3 = session.questions.find((q) => q.type === 'short_answer');

  // 规则判题：单选立即返回
  const r1 = await jsonFetch(`/practice-sessions/${session.id}/attempts`, {
    method: 'POST',
    body: { questionId: q1.id, answer: 'B', reasoning: '', submissionKey: 'sk-1' },
  });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.attempt.result.verdict, 'correct');
  assert.equal(r1.data.jobId, null);

  // submissionKey 幂等：重复提交返回同一次作答
  const r1Again = await jsonFetch(`/practice-sessions/${session.id}/attempts`, {
    method: 'POST',
    body: { questionId: q1.id, answer: 'B', reasoning: '', submissionKey: 'sk-1' },
  });
  assert.equal(r1Again.data.idempotent, true);
  assert.equal(r1Again.data.attempt.id, r1.data.attempt.id);

  // 填空：全角数字规范化等价
  const r2 = await jsonFetch(`/practice-sessions/${session.id}/attempts`, {
    method: 'POST',
    body: { questionId: q2.id, answer: '２', reasoning: '', submissionKey: 'sk-2' },
  });
  assert.equal(r2.data.attempt.result.verdict, 'correct');

  // 简答：模型批改（202 + 轮询）
  const r3 = await jsonFetch(`/practice-sessions/${session.id}/attempts`, {
    method: 'POST',
    body: { questionId: q3.id, answer: '外层导数乘内层导数，y′=2cos(2x)。', reasoning: '', submissionKey: 'sk-3' },
  });
  assert.equal(r3.status, 202);
  assert.ok(r3.data.jobId);
  await waitFor(async () => ['completed', 'failed'].includes((await jsonFetch(`/jobs/${r3.data.jobId}`)).data.status), { intervalMs: 30 });
  const a3 = (await jsonFetch(`/attempts/${r3.data.attemptId}`)).data;
  assert.equal(a3.status, 'graded');
  assert.equal(a3.result.score, 2);
  assert.ok(a3.answerRelease); // 批改后释放答案
  assert.equal(a3.independent, true);

  // 结果统计（服务端计算）
  const result = (await jsonFetch(`/practice-sessions/${session.id}/result`)).data;
  assert.equal(result.counts.correct, 3);
  assert.equal(result.independent.total, 3);
  assert.equal(result.canUpdateAnalysis, true);

  // 争议：排除争议成绩
  const disputed = await jsonFetch(`/attempts/${r1.data.attemptId}/dispute`, { method: 'POST', body: { reason: '我认为批改有误' } });
  assert.equal(disputed.data.disputed, true);
  const result2 = (await jsonFetch(`/practice-sessions/${session.id}/result`)).data;
  assert.equal(result2.counts.correct, 2);
  assert.equal(result2.counts.uncertain, 1);
  assert.equal(result2.independent.total, 2);

  // 新的训练证据 → 分析出现 pendingEvidence
  const analysisAfter = (await jsonFetch(`/analyses/${analysis.id}`)).data;
  assert.equal(analysisAfter.pendingEvidence.hasNew, true);
});

test('看答案后首次提交：independent=false，不计入独立正确率', async () => {
  const conv = seedUserProblem({ stem: '求 y=ln(3x) 的导数。', followups: ['常数要提出来吗？'] });
  const analysis = await runAnalysisJob([conv], { requestKey: 'rk-2', forceRefresh: true });
  const session = await createPracticeSession(analysis, { requestKey: 'rk-p2' });
  const q3 = session.questions.find((q) => q.type === 'short_answer');

  const revealed = await jsonFetch(`/practice-sessions/${session.id}/questions/${q3.id}/reveal`, { method: 'POST' });
  assert.equal(revealed.status, 200);
  assert.ok(revealed.data.canonical);
  // 揭晓后提示不可再用
  const hint = await jsonFetch(`/practice-sessions/${session.id}/questions/${q3.id}/hint`, { method: 'POST' });
  assert.equal(hint.status, 409);
  assert.equal(hint.data.error.code, 'ANSWER_ALREADY_REVEALED');

  const submitted = await jsonFetch(`/practice-sessions/${session.id}/attempts`, {
    method: 'POST',
    body: { questionId: q3.id, answer: 'y′=2cos(2x) 类似过程', reasoning: '', submissionKey: 'sk-reveal' },
  });
  await waitFor(async () => ['completed', 'failed'].includes((await jsonFetch(`/jobs/${submitted.data.jobId}`)).data.status), { intervalMs: 30 });
  const attempt = (await jsonFetch(`/attempts/${submitted.data.attemptId}`)).data;
  assert.equal(attempt.independent, false);
  assert.equal(attempt.assistance.revealedBeforeSubmit, true);
  const result = (await jsonFetch(`/practice-sessions/${session.id}/result`)).data;
  assert.equal(result.independent.total, 0);
  assert.equal(result.assistedPracticeCompleted, 1);
});

test('提示渐进释放，并影响独立性判定', async () => {
  const conv = seedUserProblem({ stem: '求 y=e^(2x) 的导数。' });
  const analysis = await runAnalysisJob([conv], { requestKey: 'rk-3', forceRefresh: true });
  const session = await createPracticeSession(analysis, { requestKey: 'rk-p3' });
  const q3 = session.questions.find((q) => q.type === 'short_answer');
  const hint1 = await jsonFetch(`/practice-sessions/${session.id}/questions/${q3.id}/hint`, { method: 'POST' });
  assert.equal(hint1.status, 200);
  assert.equal(hint1.data.hintIndex, 0);
  const submitted = await jsonFetch(`/practice-sessions/${session.id}/attempts`, {
    method: 'POST',
    body: { questionId: q3.id, answer: 'y′=2e^(2x)', reasoning: '', submissionKey: 'sk-hint' },
  });
  await waitFor(async () => ['completed', 'failed'].includes((await jsonFetch(`/jobs/${submitted.data.jobId}`)).data.status), { intervalMs: 30 });
  const attempt = (await jsonFetch(`/attempts/${submitted.data.attemptId}`)).data;
  assert.equal(attempt.independent, false); // 先提示后作答 → 辅助练习
  assert.equal(attempt.assistance.hintedBeforeSubmit, true);
});

test('同一题并发提交（不同 submissionKey）：只有一个首次作答，另一个 409', async () => {
  const conv = seedUserProblem({ stem: '求 y=tan(x) 的导数。' });
  const analysis = await runAnalysisJob([conv], { requestKey: 'rk-4', forceRefresh: true });
  const session = await createPracticeSession(analysis, { requestKey: 'rk-p4' });
  const q3 = session.questions.find((q) => q.type === 'short_answer');
  gradingDelayMs = 200;
  const [first, second] = await Promise.all([
    jsonFetch(`/practice-sessions/${session.id}/attempts`, { method: 'POST', body: { questionId: q3.id, answer: 'sec^2(x)', reasoning: '', submissionKey: 'sk-a' } }),
    jsonFetch(`/practice-sessions/${session.id}/attempts`, { method: 'POST', body: { questionId: q3.id, answer: 'sec^2(x)', reasoning: '', submissionKey: 'sk-b' } }),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [202, 409]);
  assert.equal((first.status === 409 ? first : second).data.error.code, 'ATTEMPT_IN_PROGRESS');
  // 等待批改完成后，被拒的提交可以重新作为第二次作答提交
  const okOne = first.status === 202 ? first : second;
  await waitFor(async () => ['completed', 'failed'].includes((await jsonFetch(`/jobs/${okOne.data.jobId}`)).data.status), { intervalMs: 30 });
  const attempts = (await jsonFetch(`/practice-sessions/${session.id}`)).data.questions.find((q) => q.id === q3.id);
  assert.ok(attempts.attempt);
});

test('批改失败后重试：复用同一作答，不重复计数', async () => {
  const conv = seedUserProblem({ stem: '求 y=x·e^x 的导数。' });
  const analysis = await runAnalysisJob([conv], { requestKey: 'rk-5', forceRefresh: true });
  const session = await createPracticeSession(analysis, { requestKey: 'rk-p5' });
  const q3 = session.questions.find((q) => q.type === 'short_answer');
  gradingShouldFail = true;
  const submitted = await jsonFetch(`/practice-sessions/${session.id}/attempts`, {
    method: 'POST',
    body: { questionId: q3.id, answer: 'e^x(x+1)', reasoning: '', submissionKey: 'sk-retry' },
  });
  await waitFor(async () => ['completed', 'failed'].includes((await jsonFetch(`/jobs/${submitted.data.jobId}`)).data.status), { intervalMs: 30 });
  let attempt = (await jsonFetch(`/attempts/${submitted.data.attemptId}`)).data;
  assert.equal(attempt.status, 'grading_failed');
  assert.ok(attempt.gradingError);

  gradingShouldFail = false;
  const retried = await jsonFetch(`/attempts/${submitted.data.attemptId}/retry-grading`, { method: 'POST' });
  assert.equal(retried.status, 202);
  await waitFor(async () => ['completed', 'failed'].includes((await jsonFetch(`/jobs/${retried.data.jobId}`)).data.status), { intervalMs: 30 });
  attempt = (await jsonFetch(`/attempts/${submitted.data.attemptId}`)).data;
  assert.equal(attempt.status, 'graded');
  const result = (await jsonFetch(`/practice-sessions/${session.id}/result`)).data;
  assert.equal(result.counts.correct, 1); // 仍只有一次作答
});

test('删除原对话：报告与派生训练/作答级联删除，任务取消', async () => {
  const conv = seedUserProblem({ stem: '求 y=sqrt(x) 的导数。' });
  const analysis = await runAnalysisJob([conv], { requestKey: 'rk-6', forceRefresh: true });
  const session = await createPracticeSession(analysis, { requestKey: 'rk-p6' });
  const del = await fetch(`http://127.0.0.1:${server.address().port}/api/conversations/${conv._id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await jsonFetch(`/analyses/${analysis.id}`)).status, 404);
  assert.equal((await jsonFetch(`/practice-sessions/${session.id}`)).status, 404);
  assert.equal((await jsonFetch('/practice-sessions')).data.items.length, 0);
});

test('草稿：版本号防回退，保存后可恢复', async () => {
  const conv = seedUserProblem({ stem: '求 y=x^4 的导数。' });
  const analysis = await runAnalysisJob([conv], { requestKey: 'rk-7', forceRefresh: true });
  const session = await createPracticeSession(analysis, { requestKey: 'rk-p7' });
  const q = session.questions[0];
  const d1 = await jsonFetch(`/practice-sessions/${session.id}/draft`, { method: 'PATCH', body: { questionId: q.id, text: '草稿 v1', draftVersion: 1 } });
  assert.equal(d1.data.accepted, true);
  const d3 = await jsonFetch(`/practice-sessions/${session.id}/draft`, { method: 'PATCH', body: { questionId: q.id, text: '草稿 v3', draftVersion: 3 } });
  assert.equal(d3.data.draftVersion, 3);
  const d2 = await jsonFetch(`/practice-sessions/${session.id}/draft`, { method: 'PATCH', body: { questionId: q.id, text: '过期的 v2', draftVersion: 2 } });
  assert.equal(d2.data.accepted, false); // 旧版本不得覆盖新版本
  const refreshed = (await jsonFetch(`/practice-sessions/${session.id}`)).data;
  assert.equal(refreshed.questions[0].draft.text, '草稿 v3');
});
