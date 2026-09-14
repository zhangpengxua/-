// 学习功能接口：/api/learning/*。
// 使用短请求创建任务 + 轮询任务状态；错误统一 {error:{code,message,retryable,details}}。
const express = require('express');
const router = express.Router();
const { ApiError, sendApiError } = require('../utils/apiError');
const LLMService = require('../utils/llmService');
const validators = require('../validators/learningSchemas');
const evidenceService = require('../services/historyEvidenceService');
const learningAnalysisService = require('../services/learningAnalysisService');
const practiceService = require('../services/practiceService');
const gradingService = require('../services/gradingService');
const learningJobService = require('../services/learningJobService');
const conversationRepository = require('../repositories/conversationRepository');
const learningRepository = require('../repositories/learningRepository');

function uuid() {
  return require('crypto').randomUUID();
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function requireValid(body, validatorFn) {
  const v = validatorFn(body);
  if (!v.ok) throw new ApiError('INVALID_INPUT', v.error);
  return v.value;
}

// 将判题阶段异常映射为任务错误；取消保留已提交作答并标记 grading_failed。
function normalizeGradingError(e) {
  if (e instanceof ApiError) return e;
  const c = LLMService.classifyError(e);
  if (c.code === 'CANCELLED') return new ApiError('CANCELLED', c.message);
  return new ApiError(c.code === 'LLM_TIMEOUT' ? 'LLM_TIMEOUT' : 'LLM_UPSTREAM_ERROR', c.message, { retryable: c.retryable });
}

function runGradingJob(ctx, attempt, question) {
  return (async () => {
    try {
      await gradingService.gradeAttempt({ attempt, question, ctx });
      const session = learningRepository.findSession(attempt.sessionId);
      if (session) {
        const questions = learningRepository.getQuestions(session.id);
        const allSettled = questions.every((q) => {
          const a = learningRepository.getFirstAttempt(session.id, q.id);
          return a && a.status !== 'grading';
        });
        session.status = allSettled ? 'completed' : 'in_progress';
      }
      return { attemptId: attempt.id };
    } catch (e) {
      attempt.status = 'grading_failed';
      const mapped = normalizeGradingError(e);
      attempt.gradingError = { code: mapped.code, message: mapped.message, retryable: mapped.retryable };
      throw e;
    }
  })();
}

// ==================== 历史记录 ====================

// GET /history?from=&to=&cursor=&limit=20
// 时间筛选按题目 createdAt；from/to 由前端按本地日历日换算为 UTC 的开始闭区间与结束开区间。
router.get('/history', asyncHandler((req, res) => {
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  let from = null;
  let to = null;
  if (req.query.from) {
    from = new Date(req.query.from);
    if (Number.isNaN(from.getTime())) throw new ApiError('INVALID_INPUT', 'from 必须是合法时间');
  }
  if (req.query.to) {
    to = new Date(req.query.to);
    if (Number.isNaN(to.getTime())) throw new ApiError('INVALID_INPUT', 'to 必须是合法时间');
  }
  const all = conversationRepository.listConversationSummaries()
    .map((s) => conversationRepository.getConversation(s._id))
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const filtered = from || to
    ? all.filter((c) => {
        const t = new Date(c.createdAt);
        return (!from || t >= from) && (!to || t < to);
      })
    : all;
  const startIdx = req.query.cursor ? filtered.findIndex((c) => c._id === req.query.cursor) + 1 : 0;
  const page = filtered.slice(Math.max(0, startIdx), Math.max(0, startIdx) + limit);
  const items = page.map((c) => {
    const assessment = evidenceService.assessConversation(c);
    return {
      id: c._id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c.messages.length,
      source: c.source,
      analyzable: assessment.analyzable,
      analyzabilityReason: assessment.reason,
    };
  });
  res.json({
    items,
    nextCursor: page.length && startIdx + page.length < filtered.length ? page[page.length - 1]._id : null,
  });
}));

// ==================== 分析报告 ====================

// POST /analyses → 202 {jobId}（命中报告缓存时任务内直接完成并返回 cached）
router.post('/analyses', asyncHandler((req, res) => {
  const value = requireValid(req.body, validators.validateCreateAnalysis);
  const sortedIds = [...value.conversationIds].sort();
  const requestHash = evidenceService.sha256(JSON.stringify({
    conversationIds: sortedIds,
    includePracticeResults: value.includePracticeResults,
    forceRefresh: value.forceRefresh,
  }));
  const mergeKey = evidenceService.sha256(JSON.stringify({ conversationIds: sortedIds, includePracticeResults: value.includePracticeResults }));
  const { job, existing, merged } = learningJobService.createJob({
    type: 'analysis',
    requestKey: value.requestKey,
    requestHash,
    mergeKey,
    conversations: value.conversationIds,
    run: (ctx) => learningAnalysisService.runAnalysis(ctx, value),
  });
  res.status(202).json({ jobId: job.id, existing: Boolean(existing), merged: Boolean(merged) });
}));

router.get('/analyses', asyncHandler((req, res) => {
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const { items, nextCursor } = learningRepository.listAnalyses({ limit, cursor: req.query.cursor || null });
  res.json({ items: items.map(learningRepository.toPublicAnalysis), nextCursor });
}));

router.get('/analyses/:id', asyncHandler((req, res) => {
  res.json(learningRepository.toPublicAnalysis(learningRepository.getAnalysis(req.params.id)));
}));

router.delete('/analyses/:id', asyncHandler((req, res) => {
  const deleted = learningRepository.deleteAnalysis(req.params.id);
  if (!deleted) throw new ApiError('NOT_FOUND', `分析报告 ${req.params.id} 不存在`);
  res.status(204).end();
}));

// ==================== 任务 ====================

router.get('/jobs/:id', asyncHandler((req, res) => {
  res.json(learningJobService.getJob(req.params.id));
}));

router.post('/jobs/:id/cancel', asyncHandler((req, res) => {
  res.json(learningJobService.cancelJob(req.params.id));
}));

// ==================== 专项训练 ====================

// POST /practice-sessions → 202 {jobId}
router.post('/practice-sessions', asyncHandler((req, res) => {
  const value = requireValid(req.body, validators.validateCreatePractice);
  const requestHash = evidenceService.sha256(JSON.stringify({
    analysisId: value.analysisId,
    knowledgePointIds: [...value.knowledgePointIds].sort(),
    questionCount: value.questionCount,
    difficulty: value.difficulty,
  }));
  const { job, existing, merged } = learningJobService.createJob({
    type: 'practice_generation',
    requestKey: value.requestKey,
    requestHash,
    conversations: [],
    run: (ctx) => practiceService.runGeneration(ctx, value),
  });
  res.status(202).json({ jobId: job.id, existing: Boolean(existing), merged: Boolean(merged) });
}));

router.get('/practice-sessions', asyncHandler((req, res) => {
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const { items, nextCursor } = learningRepository.listSessions({ limit, cursor: req.query.cursor || null });
  res.json({
    items: items.map((s) => ({
      id: s.id,
      analysisId: s.analysisId,
      knowledgePointIds: s.knowledgePointIds,
      knowledgePointNames: s.knowledgePointIds.map((id) => require('../config/knowledgeTaxonomy').getPoint(id)?.name || id),
      status: s.status,
      difficulty: s.difficulty,
      count: s.count,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    })),
    nextCursor,
  });
}));

router.get('/practice-sessions/:id', asyncHandler((req, res) => {
  res.json(learningRepository.toPublicSession(learningRepository.getSession(req.params.id)));
}));

router.delete('/practice-sessions/:id', asyncHandler((req, res) => {
  const deleted = learningRepository.deleteSession(req.params.id, { staleAnalysis: true });
  if (!deleted) throw new ApiError('NOT_FOUND', `训练组 ${req.params.id} 不存在`);
  res.status(204).end();
}));

// PATCH /practice-sessions/:id/draft — 保存当前题文字草稿；旧版本不得覆盖新版本。
router.patch('/practice-sessions/:id/draft', asyncHandler((req, res) => {
  const session = learningRepository.getSession(req.params.id);
  const value = requireValid(req.body, validators.validateDraftPatch);
  learningRepository.getQuestion(session.id, value.questionId);
  const result = learningRepository.saveDraft(session.id, value.questionId, value);
  res.json({ draftVersion: result.draftVersion, accepted: result.accepted });
}));

// POST .../questions/:qid/hint — 记录辅助行为并释放下一条提示。
router.post('/practice-sessions/:id/questions/:qid/hint', asyncHandler((req, res) => {
  const session = learningRepository.getSession(req.params.id);
  const question = learningRepository.getQuestion(session.id, req.params.qid);
  res.json(practiceService.releaseHint(session, question));
}));

// POST .../questions/:qid/reveal — 记录查看答案，结束该题独立测验机会。
router.post('/practice-sessions/:id/questions/:qid/reveal', asyncHandler((req, res) => {
  const session = learningRepository.getSession(req.params.id);
  const question = learningRepository.getQuestion(session.id, req.params.qid);
  res.json({ ...practiceService.revealAnswer(question), revealed: true });
}));

// POST /practice-sessions/:id/attempts — 保存不可变提交并创建判题任务；规则判题立即返回。
router.post('/practice-sessions/:id/attempts', asyncHandler(async (req, res) => {
  const session = learningRepository.getSession(req.params.id);
  const value = requireValid(req.body, validators.validateSubmitAttempt);
  const question = learningRepository.getQuestion(session.id, value.questionId);
  const { attempt, idempotent, jobParams } = await practiceService.acceptAttempt({
    session,
    question,
    answer: value.answer,
    reasoning: value.reasoning,
    submissionKey: value.submissionKey,
  });
  if (idempotent) {
    return res.json({ attemptId: attempt.id, jobId: null, idempotent: true, attempt: learningRepository.toPublicAttempt(attempt) });
  }
  if (jobParams) {
    const { job } = learningJobService.createJob({
      type: 'grading',
      conversations: [],
      run: (ctx) => runGradingJob(ctx, jobParams.attempt, jobParams.question),
    });
    return res.status(202).json({ attemptId: attempt.id, jobId: job.id, idempotent: false, attempt: learningRepository.toPublicAttempt(attempt) });
  }
  res.json({ attemptId: attempt.id, jobId: null, idempotent: false, attempt: learningRepository.toPublicAttempt(attempt) });
}));

router.get('/attempts/:id', asyncHandler((req, res) => {
  res.json(learningRepository.toPublicAttempt(learningRepository.getAttempt(req.params.id)));
}));

// POST /attempts/:id/retry-grading — 重试失败的批改；复用同一次作答，不重复计入统计。
router.post('/attempts/:id/retry-grading', asyncHandler(async (req, res) => {
  const attempt = learningRepository.getAttempt(req.params.id);
  if (attempt.status === 'grading') throw new ApiError('ATTEMPT_IN_PROGRESS', '批改仍在进行中');
  if (attempt.status === 'graded') throw new ApiError('INVALID_INPUT', '该作答已完成批改，无需重试');
  const question = learningRepository.getQuestion(attempt.sessionId, attempt.questionId);
  attempt.status = 'grading';
  attempt.gradingError = null;
  const { job } = learningJobService.createJob({
    type: 'grading',
    conversations: [],
    run: (ctx) => runGradingJob(ctx, attempt, question),
  });
  res.status(202).json({ attemptId: attempt.id, jobId: job.id });
}));

// POST /attempts/:id/dispute — 标记争议，排除争议成绩；保留原结果供复核。
router.post('/attempts/:id/dispute', asyncHandler((req, res) => {
  const attempt = learningRepository.getAttempt(req.params.id);
  const value = requireValid(req.body, validators.validateDispute);
  attempt.disputed = true;
  attempt.disputeReason = value.reason;
  res.json(learningRepository.toPublicAttempt(attempt));
}));

// GET /practice-sessions/:id/result — 服务端计算的整组统计。
router.get('/practice-sessions/:id/result', asyncHandler((req, res) => {
  const session = learningRepository.getSession(req.params.id);
  res.json(practiceService.buildSessionResult(session));
}));

// 统一错误出口。
router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  sendApiError(res, err);
});

module.exports = router;
