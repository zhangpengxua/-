const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const conversationRepository = require('../repositories/conversationRepository');
const learningRepository = require('../repositories/learningRepository');
const learningJobService = require('../services/learningJobService');
const analysisService = require('../services/learningAnalysisService');
const evidenceService = require('../services/historyEvidenceService');
const { installMockLLM, waitFor } = require('./helpers/mock-llm');

const KP = 'math.calculus.derivative.chain_rule';

beforeEach(() => {
  conversationRepository.__resetForTests();
  learningRepository.__resetForTests();
  learningJobService.__resetForTests();
});

function seedUserProblem({ stem, followups = [] }) {
  const conv = conversationRepository.createConversation({ source: 'user_problem' });
  conversationRepository.appendUserMessage(conv, { content: stem, kind: 'question', source: 'user_problem' });
  for (const f of followups) {
    conversationRepository.appendUserMessage(conv, { content: `针对题目追问：${stem}\n当前步骤：步骤\n学生问题：${f}`, kind: 'followup', studentQuestion: f, source: 'user_problem' });
  }
  return conv;
}

function extractFixtureFor(convs, { fabricated = false } = {}) {
  const { samples, evidence } = evidenceService.buildLearningSamples(convs);
  const ids = evidence.map((e) => e.id);
  return {
    problems: samples.map((s) => ({
      problemId: s.problemId,
      knowledgePoints: [{ id: fabricated ? 'fake.kp' : KP, evidenceRefs: [ids[0], ...s.followups.map((f) => f.evidenceRef)] }],
      difficulties: s.followups.length
        ? [{ knowledgePointId: fabricated ? 'fake.kp' : KP, strength: 'explicit_confusion', description: '对链式法则使用有疑问', evidenceRefs: [s.followups[0].evidenceRef] }]
        : [],
    })),
    unmappedTopics: [],
    _evidenceIds: ids,
  };
}

function summarizeFixture(overrides = {}) {
  return {
    summary: '建议复习链式法则。',
    knowledgePoints: [{
      id: KP,
      assessment: 'suspected_weakness',
      reason: '追问中对链式法则有疑问。',
      evidenceRefs: [],
      reviewAdvice: '先写内外层函数再求导。',
      trainingGoal: '独立完成复合函数求导。',
      ...overrides,
    }],
    limitations: [],
  };
}

async function startAnalysis(convs, { forceRefresh = false, requestKey } = {}) {
  const { job } = learningJobService.createJob({
    type: 'analysis',
    requestKey: requestKey || `rk-${Math.random()}`,
    requestHash: 'hash',
    conversations: convs.map((c) => c._id),
    run: (ctx) => analysisService.runAnalysis(ctx, { conversationIds: convs.map((c) => c._id), includePracticeResults: true, forceRefresh }),
  });
  return job;
}

async function awaitJobTerminal(jobDto) {
  await waitFor(() => ['completed', 'failed', 'cancelled'].includes(learningJobService.getJob(jobDto.id).status));
  return learningJobService.getJob(jobDto.id);
}

test('完整分析：统计由后端计算，伪造知识点 ID 触发修复后成功', async () => {
  const a = seedUserProblem({ stem: '求 y=sin(2x) 的导数。', followups: ['为什么要用链式法则？'] });
  const b = seedUserProblem({ stem: '求 y=ln(x^2+1) 的导数。' });
  const fixture = extractFixtureFor([a, b]);
  let extractCalls = 0;
  const mock = installMockLLM(({ systemPrompt, messages }) => {
    if (systemPrompt.includes('学习诊断助手')) {
      const isSummarize = messages[0].content.includes('"task":"summarize"');
      if (isSummarize) return JSON.stringify(summarizeFixture({ evidenceRefs: fixture._evidenceIds }));
      extractCalls += 1;
      if (extractCalls === 1) {
        // 第一次输出伪造 ID，应触发一次修复
        return JSON.stringify({ ...fixture, problems: fixture.problems.map((p) => ({ ...p, knowledgePoints: p.knowledgePoints.map((k) => ({ ...k, id: 'fake.kp' })) })) });
      }
      return JSON.stringify(fixture);
    }
    throw new Error('unexpected prompt');
  });
  try {
    const job = await awaitJobTerminal(await startAnalysis([a, b]));
    assert.equal(job.status, 'completed');
    assert.equal(extractCalls, 2); // 1 次失败 + 1 次修复
    const report = learningRepository.toPublicAnalysis(learningRepository.getAnalysis(job.result.analysisId));
    assert.equal(report.stats.selectedConversations, 2);
    assert.equal(report.stats.eligibleProblems, 2);
    assert.equal(report.stats.deduplicatedProblems, 2);
    assert.equal(report.stats.followupCount, 1);
    assert.equal(report.stats.independentAttempts, 0);
    assert.equal(report.knowledgePoints[0].id, KP);
    // 后端证据规则：单题明确困难 → suspected_weakness 保留，支持程度最多 medium
    assert.equal(report.knowledgePoints[0].assessment, 'suspected_weakness');
    assert.equal(report.knowledgePoints[0].evidenceLevel, 'medium');
    assert.equal(report.knowledgePoints[0].relatedProblemCount, 2); // 两道题都涉及该知识点
    assert.ok(report.limitations.some((l) => l.includes('独立作答')));
    // 模型引用的证据必须真实存在
    for (const ref of report.knowledgePoints[0].evidenceRefs) {
      assert.ok(report.evidence.some((e) => e.id === ref));
    }
  } finally {
    mock.restore();
  }
});

test('三道题无追问：模型过度声称 suspected_weakness 会被降级，不产生错题率', async () => {
  const convs = [
    seedUserProblem({ stem: '求 y=x^3 的导数。' }),
    seedUserProblem({ stem: '求 y=e^x 的导数。' }),
    seedUserProblem({ stem: '求 y=cos(x) 的导数。' }),
  ];
  const fixture = extractFixtureFor(convs);
  const mock = installMockLLM(({ systemPrompt, messages }) => {
    if (messages[0].content.includes('"task":"summarize"')) {
      return JSON.stringify(summarizeFixture({ assessment: 'suspected_weakness', evidenceRefs: fixture._evidenceIds }));
    }
    return JSON.stringify(fixture);
  });
  try {
    const job = await awaitJobTerminal(await startAnalysis(convs));
    assert.equal(job.status, 'completed');
    const report = learningRepository.getAnalysis(job.result.analysisId);
    assert.equal(report.knowledgePoints[0].assessment, 'review_suggestion'); // 无明确困难证据 → 降级
    assert.equal(report.knowledgePoints[0].evidenceLevel, 'low'); // 只有主题出现 → 低
    assert.equal(report.knowledgePoints[0].priority, 'low');
    assert.ok(!JSON.stringify(report).includes('错题率'));
  } finally {
    mock.restore();
  }
});

test('零可用内容：分析不可启动（INSUFFICIENT_DATA），不调用模型', async () => {
  const empty = conversationRepository.createConversation({});
  let modelCalled = false;
  const mock = installMockLLM(() => { modelCalled = true; return '{}'; });
  try {
    const job = await awaitJobTerminal(await startAnalysis([empty]));
    assert.equal(job.status, 'failed');
    assert.equal(job.error.code, 'INSUFFICIENT_DATA');
    assert.equal(modelCalled, false);
  } finally {
    mock.restore();
  }
});

test('同一内容指纹：完成报告复用（不重复调用模型）；forceRefresh 重新分析', async () => {
  const a = seedUserProblem({ stem: '求 y=sin(2x) 的导数。', followups: ['为什么有 2？'] });
  const fixture = extractFixtureFor([a]);
  let calls = 0;
  const mock = installMockLLM(({ messages }) => {
    calls += 1;
    if (messages[0].content.includes('"task":"summarize"')) return JSON.stringify(summarizeFixture({ evidenceRefs: fixture._evidenceIds }));
    return JSON.stringify(fixture);
  });
  try {
    const job1 = await awaitJobTerminal(await startAnalysis([a], { requestKey: 'rk-1' }));
    assert.equal(job1.status, 'completed');
    const callsAfterFirst = calls;
    const job2 = await awaitJobTerminal(await startAnalysis([a], { requestKey: 'rk-2' }));
    assert.equal(job2.status, 'completed');
    assert.equal(calls, callsAfterFirst); // 指纹缓存命中，无新模型调用
    assert.equal(learningRepository.getAnalysis(job1.result.analysisId).id, learningRepository.getAnalysis(job2.result.analysisId).id);

    const job3 = await awaitJobTerminal(await startAnalysis([a], { requestKey: 'rk-3', forceRefresh: true }));
    assert.equal(job3.status, 'completed');
    assert.ok(calls > callsAfterFirst);
  } finally {
    mock.restore();
  }
});

test('点击取消时模型晚返回：任务保持 cancelled，不写报告', async () => {
  const a = seedUserProblem({ stem: '求 y=sin(2x) 的导数。', followups: ['为什么？'] });
  const mock = installMockLLM(({ options }) => new Promise((resolve, reject) => {
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        const e = new Error('canceled');
        e.name = 'CanceledError';
        e.code = 'ERR_CANCELED';
        reject(e);
      });
    }
    setTimeout(() => resolve(JSON.stringify(extractFixtureFor([a]))), 60 * 1000);
  }));
  try {
    const { job: jobDto } = learningJobService.createJob({
      type: 'analysis',
      requestKey: 'rk-cancel',
      conversations: [a._id],
      run: (ctx) => analysisService.runAnalysis(ctx, { conversationIds: [a._id], includePracticeResults: true, forceRefresh: true }),
    });
    await waitFor(() => learningJobService.getJob(jobDto.id).status === 'running');
    const cancelled = learningJobService.cancelJob(jobDto.id);
    assert.equal(cancelled.status, 'cancelled');
    await waitFor(() => learningJobService.getJob(jobDto.id).status === 'cancelled');
    assert.equal(learningRepository.listAnalyses({ limit: 10 }).items.length, 0);
  } finally {
    mock.restore();
  }
});

test('分析期间来源变化：SOURCE_CHANGED，不发布看似最新的结论', async () => {
  const a = seedUserProblem({ stem: '求 y=sin(2x) 的导数。', followups: ['为什么？'] });
  const fixture = extractFixtureFor([a]);
  const mock = installMockLLM(({ messages }) => {
    if (messages[0].content.includes('"task":"summarize"')) {
      // 汇总阶段模拟新增追问（revision 变化）
      conversationRepository.appendUserMessage(a, { content: '针对题目追问：x\n当前步骤：s\n学生问题：还有一步不懂', kind: 'followup', studentQuestion: '还有一步不懂', source: 'user_problem' });
      return JSON.stringify(summarizeFixture({ evidenceRefs: fixture._evidenceIds }));
    }
    return JSON.stringify(fixture);
  });
  try {
    const job = await awaitJobTerminal(await startAnalysis([a], { forceRefresh: true }));
    assert.equal(job.status, 'failed');
    assert.equal(job.error.code, 'SOURCE_CHANGED');
    assert.equal(learningRepository.listAnalyses({ limit: 10 }).items.length, 0);
  } finally {
    mock.restore();
  }
});

test('applyEvidenceRules：优先顺序与支持程度上限', () => {
  const samples = [{ problemId: 'c1' }, { problemId: 'c2' }, { problemId: 'c3', duplicateOf: 'c2' }];
  const evidenceTable = [
    { id: 'ev_1', sourceType: 'practice_attempt', conversationId: null, messageId: null, attemptId: 'a1', excerpt: 'x', evidenceKind: 'graded_attempt', occurredAt: '2026-09-10T10:00:00.000Z' },
    { id: 'ev_2', sourceType: 'history_message', conversationId: 'c1', messageId: 'm1', attemptId: null, excerpt: '为什么', evidenceKind: 'explicit_confusion', occurredAt: '2026-09-09T10:00:00.000Z' },
    { id: 'ev_3', sourceType: 'history_message', conversationId: 'c2', messageId: 'm2', attemptId: null, excerpt: '不懂', evidenceKind: 'explicit_confusion', occurredAt: '2026-09-08T10:00:00.000Z' },
    { id: 'ev_4', sourceType: 'history_message', conversationId: 'c3', messageId: 'm3', attemptId: null, excerpt: 'topic', evidenceKind: 'topic', occurredAt: '2026-09-07T10:00:00.000Z' },
  ];
  const attemptRows = [{ attemptId: 'a1', knowledgePointIds: [KP], verdict: 'incorrect', score: 0, maxScore: 2, occurredAt: '2026-09-10T10:00:00.000Z' }];
  const batchResults = [{
    problems: [
      { problemId: 'c1', knowledgePoints: [{ id: KP, evidenceRefs: ['ev_1'] }], difficulties: [] },
      { problemId: 'c2', knowledgePoints: [{ id: KP, evidenceRefs: ['ev_3'] }, { id: 'math.function.domain_range', evidenceRefs: ['ev_2'] }], difficulties: [] },
      { problemId: 'c3', knowledgePoints: [{ id: KP, evidenceRefs: ['ev_4'] }], difficulties: [] },
    ],
  }];
  const cards = analysisService.applyEvidenceRules({
    summaryKps: [
      { id: KP, proposedName: null, assessment: 'observed_error', reason: 'r', evidenceRefs: ['ev_1'], reviewAdvice: 'a', trainingGoal: 'g' },
      { id: 'math.function.domain_range', proposedName: null, assessment: 'suspected_weakness', reason: 'r', evidenceRefs: ['ev_2'], reviewAdvice: 'a', trainingGoal: 'g' },
    ],
    batchResults,
    samples,
    evidenceTable,
    attemptRows,
  });
  assert.equal(cards.length, 2);
  const [observed, suspected] = cards;
  assert.equal(observed.priority, 'high');       // 1. 最近可靠独立作答出现错误
  assert.equal(observed.evidenceLevel, 'medium'); // 单条可靠独立作答最多中
  assert.equal(suspected.priority, 'medium');    // 3. 单题明确困难
  assert.equal(suspected.evidenceLevel, 'medium'); // 单会话追问最多中
  assert.equal(suspected.relatedProblemCount, 1); // 重复题 c3 不计入
  // 模型声称 observed_error 但无作答错误 → 降级
  const downgraded = analysisService.applyEvidenceRules({
    summaryKps: [{ id: KP, proposedName: null, assessment: 'observed_error', reason: 'r', evidenceRefs: ['ev_4'], reviewAdvice: 'a', trainingGoal: 'g' }],
    batchResults,
    samples,
    evidenceTable,
    attemptRows: [],
  });
  assert.equal(downgraded[0].assessment, 'review_suggestion');
  assert.equal(downgraded[0].ruleNotes.length, 1);
});
