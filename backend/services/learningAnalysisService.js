// 学习分析服务：分批提取知识点与困难线索 → 校验引用 → 汇总判断 → 后端计算统计并应用证据规则 → 保存报告。
// 模型只提出判断；所有数量、优先级、支持程度上限由后端计算与约束。
const fs = require('fs');
const path = require('path');
const LLMService = require('../utils/llmService');
const { ApiError } = require('../utils/apiError');
const taxonomy = require('../config/knowledgeTaxonomy');
const validators = require('../validators/learningSchemas');
const evidenceService = require('./historyEvidenceService');
const conversationRepository = require('../repositories/conversationRepository');
const learningRepository = require('../repositories/learningRepository');
const knowledgeResolution = require('./knowledgeResolutionService');

const PROMPT_VERSION = 'analysis-v2';
const ANALYSIS_PROMPT = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'learning-analysis.txt'), 'utf8');

const BATCH_LIMITS = {
  maxPerBatch: 10,          // 每批最多 10 道根题
  maxCharsPerBatch: 20000,  // 每批正文预算（工程初值，模型配置变化后应再评估）
  maxTemperature: 0.2,
};

// 新流程 JSON 解析：先直接 JSON.parse，必要时仅去除代码围栏；不使用含修复逻辑的 tryExtractJSON。
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

function planBatches(samples) {
  const batches = [];
  let current = [];
  let chars = 0;
  const sampleSize = (s) =>
    s.questionText.length + s.followups.reduce((n, f) => n + f.studentText.length, 0) +
    s.assistantContext.reduce((n, c) => n + c.excerpt.length, 0) + 200;
  for (const s of samples) {
    const size = sampleSize(s);
    if (current.length && (current.length >= BATCH_LIMITS.maxPerBatch || chars + size > BATCH_LIMITS.maxCharsPerBatch)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(s);
    chars += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

function serializeSample(s) {
  return {
    problemId: s.problemId,
    questionText: s.questionText,
    followups: s.followups.map((f) => ({ messageId: f.messageId, studentText: f.studentText })),
    assistantContext: s.assistantContext.map((c) => ({ excerpt: c.excerpt, trusted: false })),
    warnings: s.warnings,
  };
}

async function callModelWithRepair(ctx, systemPrompt, messages, validate, taskType) {
  for (let attempt = 0; attempt < 2; attempt++) {
    ctx.ensureActive();
    const raw = await LLMService.callLLMStructured(messages, systemPrompt, 8192, {
      signal: ctx.signal,
      temperature: BATCH_LIMITS.maxTemperature,
      taskType,
      timeoutMs: Number(process.env.LEARNING_LLM_TIMEOUT_MS) || undefined,
    });
    const parsed = parseModelJson(raw);
    if (!parsed.ok) {
      if (attempt === 0) {
        messages.push({ role: 'assistant', content: raw }, { role: 'user', content: `你的输出不是合法 JSON（${parsed.error}）。请重新只输出符合 Schema 的 JSON 对象，不要包含任何其他文字。` });
        continue;
      }
      throw new ApiError('LLM_INVALID_OUTPUT', '模型输出无法解析为 JSON', { details: { errors: [parsed.error] } });
    }
    const check = validate(parsed.value);
    if (check.ok) return check.value;
    if (attempt === 0) {
      messages.push({ role: 'assistant', content: raw }, { role: 'user', content: `你的输出存在以下校验问题，请修正后重新只输出 JSON：\n- ${check.errors.join('\n- ')}` });
      continue;
    }
    throw new ApiError('LLM_INVALID_OUTPUT', '模型输出未通过结构与引用校验', { details: { errors: check.errors } });
  }
  throw new ApiError('LLM_INVALID_OUTPUT', '模型输出未通过校验');
}

async function extractBatch(ctx, batchSamples, evidenceTable) {
  const evidenceIds = new Set(evidenceTable.map((e) => e.id));
  const cacheKey = evidenceService.sha256(JSON.stringify({
    kind: 'analysis-batch',
    promptVersion: PROMPT_VERSION,
    taxonomyVersion: taxonomy.version,
    model: LLMService.getModelName(),
    samples: batchSamples.map(serializeSample),
    evidenceIds: [...evidenceIds],
  }));
  const cached = learningRepository.getBatchResult(cacheKey);
  if (cached) return cached;

  const messages = [{
    role: 'user',
    content: JSON.stringify({
      task: 'extract',
      knowledgeTaxonomy: taxonomy.listForPrompt(),
      samples: batchSamples.map(serializeSample),
      evidence: evidenceTable,
      outputSchemaHint: {
        problems: '[{ problemId, knowledgePoints: [{ id, proposedName, evidenceRefs, note }], difficulties: [{ knowledgePointId, proposedName, strength, description, evidenceRefs }] }]',
        unmappedTopics: '[候选名称]',
      },
    }),
  }];
  const value = await callModelWithRepair(ctx, ANALYSIS_PROMPT, messages, (v) => {
    const check = validators.validateBatchExtraction(v, batchSamples, evidenceIds);
    if (!check.ok) return check;
    if (batchSamples.some((s) => !check.value.problems.some((p) => p.problemId === s.problemId && p.knowledgePoints.length))) {
      return { ok: false, errors: ['每道题必须识别至少一个实际知识点；目录不覆盖时提供 proposedName，不得遗漏题目'] };
    }
    return check;
  }, 'learning-analysis');
  const resolved = await knowledgeResolution.resolveBatch(ctx, value, batchSamples, evidenceTable);
  learningRepository.putBatchResult(cacheKey, resolved);
  return resolved;
}

async function summarizeBatches(ctx, { batchResults, samples, evidenceTable, attemptRows, stats }) {
  const evidenceIds = new Set(evidenceTable.map((e) => e.id));
  const validKpIds = new Set(batchResults.flatMap((batch) => batch.problems.flatMap((p) => [
    ...p.knowledgePoints.map((kp) => kp.id), ...p.difficulties.map((d) => d.knowledgePointId),
  ])).concat(attemptRows.flatMap((r) => r.knowledgePointIds)));
  const messages = [{
    role: 'user',
    content: JSON.stringify({
      task: 'summarize',
      knowledgeTaxonomy: taxonomy.listForPrompt(),
      batches: batchResults,
      evidence: evidenceTable,
      independentAttempts: attemptRows.map((r) => ({
        attemptId: r.attemptId,
        knowledgePointIds: r.knowledgePointIds,
        verdict: r.verdict,
        score: r.score,
        maxScore: r.maxScore,
        occurredAt: r.occurredAt,
      })),
      stats,
      outputSchemaHint: {
        summary: 'string',
        knowledgePoints: '[{ id 或 proposedName, assessment, reason, evidenceRefs, reviewAdvice, trainingGoal }]',
        limitations: '[string]',
      },
    }),
  }];
  const value = await callModelWithRepair(ctx, ANALYSIS_PROMPT, messages, (v) => {
    const check = validators.validateSummaryOutput(v, evidenceIds, validKpIds);
    if (!check.ok) return check;
    if (check.value.knowledgePoints.some((kp) => !kp.id)) return { ok: false, errors: ['归类已完成，汇总只能复用分批结果的知识点 ID，不得再提出新名称'] };
    const missing = [...validKpIds].filter((id) => !check.value.knowledgePoints.some((kp) => kp.id === id));
    if (missing.length) return { ok: false, errors: [`请覆盖已识别知识点：${missing.join('、')}。缺少学习表现证据时标记 review_suggestion 或 insufficient_evidence，不要遗漏`] };
    return check;
  }, 'learning-analysis');
  return value;
}

// ==================== 后端证据规则（8.1/8.2） ====================

function kpKeyOf(kp) {
  return kp.id || `unmapped:${kp.proposedName}`;
}

function collectBatchKnowledge(batchResults) {
  const problemsByKp = new Map();     // kpKey -> Set(problemId)
  const refsByKp = new Map();         // kpKey -> Set(evidenceId)
  for (const batch of batchResults) {
    for (const problem of batch.problems) {
      const register = (key, refs) => {
        if (!key) return;
        if (!problemsByKp.has(key)) problemsByKp.set(key, new Set());
        problemsByKp.get(key).add(problem.problemId);
        if (!refsByKp.has(key)) refsByKp.set(key, new Set());
        for (const ref of refs || []) refsByKp.get(key).add(ref);
      };
      for (const kp of problem.knowledgePoints || []) register(kp.id ? kp.id : `unmapped:${kp.proposedName}`, kp.evidenceRefs);
      for (const d of problem.difficulties || []) {
        register(d.knowledgePointId ? d.knowledgePointId : `unmapped:${d.proposedName}`, d.evidenceRefs);
      }
    }
  }
  return { problemsByKp, refsByKp };
}

function applyEvidenceRules({ summaryKps, batchResults, samples, evidenceTable, attemptRows }) {
  const evidenceById = new Map(evidenceTable.map((e) => [e.id, e]));
  const { problemsByKp, refsByKp } = collectBatchKnowledge(batchResults);
  const dedupExcluded = new Set(samples.filter((s) => s.duplicateOf).map((s) => s.problemId));
  const ruleNotes = [];

  const cards = summaryKps.map((kp) => {
    const key = kpKeyOf(kp);
    const meta = kp.id ? taxonomy.getPoint(kp.id) : null;
    const refs = new Set(kp.evidenceRefs || []);
    for (const r of refsByKp.get(key) || []) refs.add(r);
    const evs = [...refs].map((id) => evidenceById.get(id)).filter(Boolean);
    const historyEvs = evs.filter((e) => e.sourceType === 'history_message');
    const attemptEvs = evs.filter((e) => e.sourceType === 'practice_attempt');
    const explicitConvs = new Set(historyEvs.filter((e) => e.evidenceKind === 'explicit_confusion').map((e) => e.conversationId));
    const involvedConvs = new Set(historyEvs.map((e) => e.conversationId).filter(Boolean));

    const relatedProblems = new Set([...(problemsByKp.get(key) || [])].filter((p) => !dedupExcluded.has(p)));
    const relatedProblemCount = relatedProblems.size;
    const kpAttempts = kp.id ? attemptRows.filter((r) => r.knowledgePointIds.includes(kp.id) &&
      (r.verdict === 'correct' || !r.errorKnowledgePointIds || r.errorKnowledgePointIds.includes(kp.id))) : [];
    const performance = {
      independent: kpAttempts.length,
      correct: kpAttempts.filter((r) => r.verdict === 'correct').length,
      partial: kpAttempts.filter((r) => r.verdict === 'partially_correct').length,
      incorrect: kpAttempts.filter((r) => r.verdict === 'incorrect' || r.verdict === 'partially_correct').length,
    };

    // assessment 与证据一致性（后端约束，不信任模型结论）。
    let assessment = kp.assessment;
    const notes = [];
    if (assessment === 'observed_error' && performance.incorrect === 0) {
      assessment = 'review_suggestion';
      notes.push('没有可靠的独立作答错误记录，observed_error 已降级为 review_suggestion');
    }
    if (assessment === 'recent_success' && performance.correct === 0) {
      assessment = 'review_suggestion';
      notes.push('没有可靠独立作答正确记录，recent_success 已降级为 review_suggestion');
    }
    if (assessment === 'suspected_weakness' && explicitConvs.size === 0) {
      assessment = 'review_suggestion';
      notes.push('没有学生明确表达困难的证据，suspected_weakness 已降级为 review_suggestion');
    }

    // 支持程度上限：仅主题 → 低；单会话追问/单次作答 → 最多中；跨题明确困难或多条可靠独立作答 → 可高。
    let evidenceLevel = 'low';
    if (explicitConvs.size > 0 || attemptEvs.length > 0) evidenceLevel = 'medium';
    const crossProblemDifficulty = explicitConvs.size >= 2;
    const multipleReliableAttempts = kpAttempts.length >= 2;
    if (crossProblemDifficulty || multipleReliableAttempts) evidenceLevel = 'high';

    const latestEvidenceAt = evs.map((e) => e.occurredAt).filter(Boolean).sort().at(-1) || null;

    return {
      id: kp.id,
      proposedName: kp.id ? null : kp.proposedName,
      unmapped: !kp.id,
      name: meta ? meta.name : kp.proposedName,
      path: meta ? meta.path : null,
      definition: meta?.definition || '',
      boundary: meta?.boundary || '',
      difficultySignals: [...new Set(batchResults.flatMap((b) => b.problems.flatMap((p) => p.difficulties
        .filter((d) => d.knowledgePointId === kp.id && d.strength === 'explicit_confusion')
        .map((d) => d.description))).concat(kpAttempts.filter((r) => r.verdict !== 'correct').map((r) => r.feedback)).filter(Boolean))],
      assessment,
      evidenceLevel,
      priority: 'low',
      priorityReason: '',
      reason: kp.reason,
      evidenceRefs: [...refs],
      relatedProblemCount,
      performance,
      reviewAdvice: kp.reviewAdvice,
      trainingGoal: kp.trainingGoal,
      ruleNotes: notes,
      _latestEvidenceAt: latestEvidenceAt,
    };
  });

  // 透明优先顺序（8.2）：不作伪科学评分。
  const bucketOf = (kp) => {
    if (kp.performance.incorrect > 0) return 1;
    if (kp.assessment === 'suspected_weakness' && kp.relatedProblemCount >= 2) return 2;
    if (kp.assessment === 'suspected_weakness') return 3;
    return 4;
  };
  const bucketReason = {
    1: '最近的可靠独立训练中出现错误或部分正确',
    2: '多道不同题中反复出现明确困难',
    3: '单道题中明确表达了困难',
    4: '仅出现过、尚未通过独立作答验证',
  };
  for (const kp of cards) {
    const bucket = bucketOf(kp);
    kp._bucket = bucket;
    kp.priority = bucket === 1 ? 'high' : bucket === 4 ? 'low' : 'medium';
    kp.priorityReason = bucketReason[bucket];
    delete kp._bucket;
  }
  cards.sort((a, b) => {
    const bucketA = bucketOf(a);
    const bucketB = bucketOf(b);
    if (bucketA !== bucketB) return bucketA - bucketB;
    const ta = a._latestEvidenceAt || '';
    const tb = b._latestEvidenceAt || '';
    if (ta !== tb) return tb.localeCompare(ta);
    return b.relatedProblemCount - a.relatedProblemCount;
  });
  for (const kp of cards) delete kp._latestEvidenceAt;
  return cards;
}

// ==================== 任务入口 ====================

async function runAnalysis(ctx, params) {
  ctx.setStage('reading');
  const conversations = params.conversationIds.map((id) => conversationRepository.requireConversation(id));
  const snapshotConversations = conversations.map((c) => ({ id: c._id, revision: c.revision }));

  const { samples, evidence, exclusions, stats } = evidenceService.buildLearningSamples(conversations);

  // 范围内的可靠独立作答：只有全部来源会话仍在当前范围内的训练组才计入。
  const attemptRows = [];
  if (params.includePracticeResults) {
    const inScopeSessions = learningRepository.listSessionsByAnalysisScope(params.conversationIds);
    for (const session of inScopeSessions) {
      const questions = learningRepository.getQuestions(session.id);
      for (const attempt of learningRepository.listAttempts(session.id)) {
        if (attempt.status !== 'graded' || !attempt.result || attempt.disputed) continue;
        if (!attempt.isFirstAttempt || !attempt.independent) continue;
        if (attempt.result.verdict === 'uncertain') continue;
        const question = questions.find((q) => q.id === attempt.questionId);
        if (!question) continue;
        attemptRows.push({
          attemptId: attempt.id,
          sessionId: session.id,
          knowledgePointIds: question.knowledgePointIds,
          errorKnowledgePointIds: attempt.result.errorKnowledgePointIds || [],
          knowledgePointNames: question.knowledgePointIds.map((id) => taxonomy.getPoint(id)?.name || id),
          verdict: attempt.result.verdict,
          score: attempt.result.score,
          maxScore: attempt.result.maxScore,
          feedback: attempt.result.feedback,
          occurredAt: attempt.gradedAt || attempt.createdAt,
        });
      }
    }
  }
  stats.independentAttempts = attemptRows.length;

  const evidenceTable = evidenceService.buildAttemptEvidence(attemptRows, evidence, evidence.length);

  const contentHash = evidenceService.sha256(JSON.stringify({
    samples: samples.map((s) => ({ problemId: s.problemId, q: s.questionText, f: s.followups.map((f) => f.studentText) })),
    revisions: snapshotConversations,
    attempts: attemptRows.map((r) => [r.attemptId, r.verdict, r.score, r.maxScore]),
    exclusions,
  }));
  const fingerprint = evidenceService.sha256([
    contentHash,
    LLMService.getModelName(),
    PROMPT_VERSION,
    taxonomy.version,
    params.includePracticeResults ? 'with-practice' : 'history-only',
  ].join('|'));

  if (!params.forceRefresh) {
    const cached = learningRepository.findCachedAnalysis(fingerprint);
    if (cached && cached.knowledgePoints.every((kp) => kp.id && taxonomy.isValidId(kp.id))) return { analysisId: cached.id, cached: true };
  }

  if (stats.deduplicatedProblems === 0) {
    throw new ApiError('INSUFFICIENT_DATA', '所选范围内没有可分析的文字题目', {
      details: { exclusions, hint: '请选择包含完整题干文字的记录，图片题请先回原题确认文字。' },
    });
  }

  ctx.setProgress({ completedBatches: 0, totalBatches: planBatches(samples).length });
  ctx.setStage('extracting');
  const batches = planBatches(samples);
  const batchResults = [];
  for (let i = 0; i < batches.length; i++) {
    ctx.ensureActive();
    batchResults.push(await extractBatch(ctx, batches[i], evidenceTable));
    ctx.setProgress({ completedBatches: i + 1, totalBatches: batches.length });
  }

  ctx.setStage('summarizing');
  const summary = await summarizeBatches(ctx, { batchResults, samples, evidenceTable, attemptRows, stats });

  const knowledgePoints = applyEvidenceRules({ summaryKps: summary.knowledgePoints, batchResults, samples, evidenceTable, attemptRows });

  const limitations = [...(summary.limitations || [])];
  if (attemptRows.length === 0 && !limitations.some((l) => l.includes('独立作答'))) {
    limitations.push('暂无独立作答数据：未作答的历史题目只能用于提出复习建议，不能判断掌握程度。');
  }
  if (exclusions.length > 0) {
    limitations.push(`有 ${exclusions.length} 条记录未纳入分析（空对话、示例、图片无文字或超长等）。`);
  }
  limitations.push('分析依据为所选学习记录；支持程度只描述证据充分性，不是统计概率。');

  // 发布前重新校验来源：revision 变化或来源被删除时不发布看似最新的结论。
  ctx.ensureActive();
  ctx.setStage('saving');
  for (const s of snapshotConversations) {
    const current = conversationRepository.getConversation(s.id);
    if (!current) throw new ApiError('SOURCE_CHANGED', `来源对话 ${s.id} 在分析期间被删除`);
    if (current.revision !== s.revision) throw new ApiError('SOURCE_CHANGED', '分析期间来源发生了变化，请重试以纳入最新记录');
  }

  const analysis = learningRepository.createAnalysis({
    promptVersion: PROMPT_VERSION,
    taxonomyVersion: taxonomy.version,
    model: LLMService.getModelName(),
    status: 'completed',
    scope: { conversationIds: [...params.conversationIds], from: null, to: null },
    sourceSnapshot: {
      conversations: snapshotConversations,
      attemptIds: attemptRows.map((r) => r.attemptId),
      contentHash,
      expiresAt: null,
    },
    fingerprint,
    stats,
    exclusions,
    limitations,
    summary: summary.summary,
    knowledgePoints,
    evidence: evidenceTable,
  });
  return { analysisId: analysis.id };
}

module.exports = {
  PROMPT_VERSION,
  BATCH_LIMITS,
  parseModelJson,
  planBatches,
  runAnalysis,
  applyEvidenceRules,
};
