// 学习功能内存仓库：报告、训练组、题目（含私有答案）、作答、草稿。
// 与对话共用同一数据源：通过 conversationRepository 事件联动失效与级联删除。
// 首版为内存实现，进程重启即清空；页面会明确提示这一点。
const crypto = require('crypto');
const { ApiError } = require('../utils/apiError');
const conversationRepository = require('./conversationRepository');

const num = (v, def) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};

const TTL = {
  reportMs: num(process.env.LEARNING_REPORT_TTL_MS, 7 * 24 * 3600 * 1000),
  sessionMs: num(process.env.LEARNING_SESSION_TTL_MS, 7 * 24 * 3600 * 1000),
  batchCacheMs: 30 * 60 * 1000,
};
const CAPACITY = { maxAnalyses: num(process.env.LEARNING_MAX_ANALYSES, 200), maxSessions: num(process.env.LEARNING_MAX_SESSIONS, 200) };

const analyses = new Map();               // analysisId -> analysis
const sessions = new Map();               // sessionId -> session
const questionsBySession = new Map();     // sessionId -> Map(questionId -> question)
const attemptsBySession = new Map();      // sessionId -> Map(attemptId -> attempt)
const firstAttemptIndex = new Map();      // `${sessionId}:${questionId}` -> attemptId
const attemptsBySubmissionKey = new Map();
const draftsBySession = new Map();        // sessionId -> Map(questionId -> {text, version, updatedAt})
const fingerprintIndex = new Map();       // analysis fingerprint -> analysisId
const batchResultCache = new Map();       // hash -> {value, expiresAt}

function uuid() {
  return crypto.randomUUID();
}

function isoNow() {
  return new Date().toISOString();
}

function countLiveAnalyses(now) {
  let n = 0;
  for (const a of analyses.values()) if (!a.expiresAt || new Date(a.expiresAt) > now) n++;
  return n;
}

function countLiveSessions(now) {
  let n = 0;
  for (const s of sessions.values()) if (!s.expiresAt || new Date(s.expiresAt) > now) n++;
  return n;
}

let lastPruneAt = 0;
function maybePrune() {
  const now = Date.now();
  if (now - lastPruneAt < 60 * 1000) return;
  lastPruneAt = now;
  pruneExpired();
}

function pruneExpired(now = Date.now()) {
  for (const [id, s] of sessions) {
    if (s.expiresAt && new Date(s.expiresAt) <= now) deleteSession(id, { staleAnalysis: true });
  }
  for (const [id, a] of analyses) {
    if (a.expiresAt && new Date(a.expiresAt) <= now) deleteAnalysis(id);
  }
  for (const [h, c] of batchResultCache) {
    if (c.expiresAt <= now) batchResultCache.delete(h);
  }
}

// ==================== 分析报告 ====================

function createAnalysis(data) {
  maybePrune();
  const now = new Date();
  if (countLiveAnalyses(now) >= CAPACITY.maxAnalyses) {
    pruneExpired(now);
    if (countLiveAnalyses(now) >= CAPACITY.maxAnalyses) {
      throw new ApiError('CAPACITY_LIMIT', '分析报告数量达到上限，请先删除旧报告');
    }
  }
  const analysis = {
    id: 'analysis_' + uuid(),
    schemaVersion: 1,
    promptVersion: data.promptVersion,
    taxonomyVersion: data.taxonomyVersion,
    model: data.model,
    status: data.status || 'completed',
    createdAt: isoNow(),
    scope: data.scope,
    sourceSnapshot: data.sourceSnapshot,
    fingerprint: data.fingerprint,
    stats: data.stats,
    exclusions: data.exclusions || [],
    limitations: data.limitations || [],
    summary: data.summary || '',
    knowledgePoints: data.knowledgePoints || [],
    evidence: data.evidence || [],
    derivedSessionIds: [],
    stale: false,
    expiresAt: new Date(Date.now() + TTL.reportMs).toISOString(),
  };
  analyses.set(analysis.id, analysis);
  if (analysis.fingerprint) fingerprintIndex.set(analysis.fingerprint, analysis.id);
  return analysis;
}

function getAnalysis(id) {
  maybePrune();
  const a = analyses.get(id);
  if (!a) throw new ApiError('NOT_FOUND', `分析报告 ${id} 不存在（可能已过期或服务已重启）`);
  return a;
}

function findAnalysis(id) {
  return analyses.get(id) || null;
}

function findCachedAnalysis(fingerprint) {
  maybePrune();
  const id = fingerprintIndex.get(fingerprint);
  if (!id) return null;
  const a = analyses.get(id);
  if (!a || a.stale || a.status !== 'completed') return null;
  return a;
}

function listAnalyses({ limit = 20, cursor = null } = {}) {
  maybePrune();
  const all = [...analyses.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const startIdx = cursor ? all.findIndex((a) => a.id === cursor) + 1 : 0;
  const page = all.slice(Math.max(0, startIdx), Math.max(0, startIdx) + limit);
  return { items: page, nextCursor: page.length && startIdx + page.length < all.length ? page[page.length - 1].id : null };
}

// 删除报告：级联删除其派生训练与作答。
function deleteAnalysis(id) {
  const a = analyses.get(id);
  if (!a) return false;
  for (const sessionId of [...a.derivedSessionIds]) deleteSession(sessionId, { staleAnalysis: false });
  if (a.fingerprint && fingerprintIndex.get(a.fingerprint) === id) fingerprintIndex.delete(a.fingerprint);
  analyses.delete(id);
  return true;
}

// 对话内容变化：包含该对话且快照 revision 落后的报告标记 stale（不默默改写结论）。
function markStaleByRevision(conversationId, revision) {
  for (const a of analyses.values()) {
    if (!a.scope.conversationIds.includes(conversationId)) continue;
    const snap = a.sourceSnapshot.conversations.find((c) => c.id === conversationId);
    if (snap && snap.revision < revision) a.stale = true;
  }
}

// 删除原对话：删除包含它的报告及派生训练/作答；任务取消由 jobService 监听事件处理。
function handleConversationDeleted(conversationId) {
  const removedAnalysisIds = [];
  for (const a of analyses.values()) {
    if (a.scope.conversationIds.includes(conversationId)) removedAnalysisIds.push(a.id);
  }
  for (const id of removedAnalysisIds) deleteAnalysis(id);
  return removedAnalysisIds;
}

// 该范围内可计入训练统计的训练组：仅取“全部来源会话仍在当前范围内”的分析所派生的训练。
function listSessionsByAnalysisScope(conversationIds) {
  const scopeSet = new Set(conversationIds);
  const result = [];
  for (const a of analyses.values()) {
    if (!a.scope.conversationIds.every((id) => scopeSet.has(id))) continue;
    for (const sessionId of a.derivedSessionIds) {
      const s = sessions.get(sessionId);
      if (s) result.push(s);
    }
  }
  return result.sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));
}

// ==================== 训练组与题目 ====================

function createSession(data) {
  maybePrune();
  const now = new Date();
  if (countLiveSessions(now) >= CAPACITY.maxSessions) {
    pruneExpired(now);
    if (countLiveSessions(now) >= CAPACITY.maxSessions) {
      throw new ApiError('CAPACITY_LIMIT', '训练组数量达到上限，请先删除旧训练');
    }
  }
  const session = {
    id: 'session_' + uuid(),
    analysisId: data.analysisId,
    knowledgePointIds: data.knowledgePointIds,
    status: data.status || 'ready',
    difficulty: data.difficulty,
    count: data.count,
    createdAt: isoNow(),
    questionIds: [],
    sourceSnapshotHash: data.sourceSnapshotHash || '',
    expiresAt: new Date(Date.now() + TTL.sessionMs).toISOString(),
  };
  sessions.set(session.id, session);
  questionsBySession.set(session.id, new Map());
  attemptsBySession.set(session.id, new Map());
  draftsBySession.set(session.id, new Map());
  const analysis = analyses.get(session.analysisId);
  if (analysis) analysis.derivedSessionIds.push(session.id);
  return session;
}

function getSession(id) {
  maybePrune();
  const s = sessions.get(id);
  if (!s) throw new ApiError('NOT_FOUND', `训练组 ${id} 不存在（可能已过期或服务已重启）`);
  return s;
}

function findSession(id) {
  return sessions.get(id) || null;
}

function listSessions({ limit = 20, cursor = null } = {}) {
  maybePrune();
  const all = [...sessions.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const startIdx = cursor ? all.findIndex((s) => s.id === cursor) + 1 : 0;
  const page = all.slice(Math.max(0, startIdx), Math.max(0, startIdx) + limit);
  return { items: page, nextCursor: page.length && startIdx + page.length < all.length ? page[page.length - 1].id : null };
}

// 删除训练：删除作答和草稿；直接删除（非级联）时关联报告标记 stale。
function deleteSession(id, { staleAnalysis = true } = {}) {
  const s = sessions.get(id);
  if (!s) return false;
  questionsBySession.delete(id);
  const attempts = attemptsBySession.get(id);
  if (attempts) {
    for (const a of attempts.values()) {
      if (a.submissionKey && attemptsBySubmissionKey.get(a.submissionKey) === a.id) attemptsBySubmissionKey.delete(a.submissionKey);
    }
  }
  attemptsBySession.delete(id);
  firstAttemptIndex.delete(id);
  draftsBySession.delete(id);
  sessions.delete(id);
  const analysis = analyses.get(s.analysisId);
  if (analysis) {
    analysis.derivedSessionIds = analysis.derivedSessionIds.filter((x) => x !== id);
    if (staleAnalysis) analysis.stale = true;
  }
  return true;
}

function saveQuestion(sessionId, question) {
  const qs = questionsBySession.get(sessionId);
  if (!qs) throw new ApiError('NOT_FOUND', '训练组不存在');
  qs.set(question.id, question);
  return question;
}

function getQuestions(sessionId) {
  return [...(questionsBySession.get(sessionId)?.values() || [])];
}

function getQuestion(sessionId, questionId) {
  const q = questionsBySession.get(sessionId)?.get(questionId);
  if (!q) throw new ApiError('NOT_FOUND', `题目 ${questionId} 不存在`);
  return q;
}

function setSessionStatus(sessionId, status) {
  const s = getSession(sessionId);
  s.status = status;
  return s;
}

// ==================== 作答 ====================

function createAttempt(data) {
  const attempt = {
    id: 'attempt_' + uuid(),
    sessionId: data.sessionId,
    questionId: data.questionId,
    submissionKey: data.submissionKey,
    answer: data.answer,
    reasoning: data.reasoning || '',
    status: data.status || 'grading',
    assistance: data.assistance || { hintedBeforeSubmit: false, revealedBeforeSubmit: false },
    isFirstAttempt: data.isFirstAttempt === true,
    independent: data.independent === true,
    result: null,
    gradingError: null,
    disputed: false,
    disputeReason: null,
    createdAt: isoNow(),
    gradedAt: null,
  };
  attemptsBySession.get(data.sessionId).set(attempt.id, attempt);
  attemptsBySubmissionKey.set(attempt.submissionKey, attempt.id);
  if (attempt.isFirstAttempt) {
    firstAttemptIndex.set(`${attempt.sessionId}:${attempt.questionId}`, attempt.id);
  }
  return attempt;
}

function getAttempt(id) {
  for (const attempts of attemptsBySession.values()) {
    const a = attempts.get(id);
    if (a) return a;
  }
  throw new ApiError('NOT_FOUND', `作答记录 ${id} 不存在（可能已过期或服务已重启）`);
}

function findAttempt(id) {
  for (const attempts of attemptsBySession.values()) {
    const a = attempts.get(id);
    if (a) return a;
  }
  return null;
}

function findAttemptBySubmissionKey(submissionKey) {
  const id = attemptsBySubmissionKey.get(submissionKey);
  return id ? findAttempt(id) : null;
}

function getFirstAttempt(sessionId, questionId) {
  const id = firstAttemptIndex.get(`${sessionId}:${questionId}`);
  return id ? findAttempt(id) : null;
}

function listAttempts(sessionId) {
  return [...(attemptsBySession.get(sessionId)?.values() || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function listInFlightAttempts(sessionId) {
  return listAttempts(sessionId).filter((a) => a.status === 'grading');
}

// ==================== 草稿 ====================

// 旧版本草稿不覆盖新版本。
function saveDraft(sessionId, questionId, { text, draftVersion }) {
  const drafts = draftsBySession.get(sessionId);
  if (!drafts) throw new ApiError('NOT_FOUND', '训练组不存在');
  const prev = drafts.get(questionId);
  if (prev && prev.version > draftVersion) {
    return { accepted: false, draftVersion: prev.version };
  }
  drafts.set(questionId, { text, version: draftVersion, updatedAt: isoNow() });
  return { accepted: true, draftVersion };
}

function getDraft(sessionId, questionId) {
  return draftsBySession.get(sessionId)?.get(questionId) || null;
}

// ==================== 抽取结果短期缓存（供批次重试） ====================

function getBatchResult(hash) {
  const c = batchResultCache.get(hash);
  if (!c) return null;
  if (c.expiresAt <= Date.now()) {
    batchResultCache.delete(hash);
    return null;
  }
  return c.value;
}

function putBatchResult(hash, value) {
  batchResultCache.set(hash, { value, expiresAt: Date.now() + TTL.batchCacheMs });
}

// ==================== 公开 DTO ====================

function toPublicAnalysis(a) {
  const pendingSessions = a.derivedSessionIds
    .map((id) => sessions.get(id))
    .filter(Boolean)
    .filter((s) => listAttempts(s.id).some((at) => at.status === 'graded' && !at.disputed && new Date(at.gradedAt || at.createdAt) > new Date(a.createdAt)))
    .map((s) => s.id);
  return {
    id: a.id,
    schemaVersion: a.schemaVersion,
    promptVersion: a.promptVersion,
    taxonomyVersion: a.taxonomyVersion,
    model: a.model,
    status: a.status,
    createdAt: a.createdAt,
    scope: a.scope,
    sourceSnapshot: { conversations: a.sourceSnapshot.conversations, expiresAt: a.expiresAt },
    stats: a.stats,
    exclusions: a.exclusions,
    limitations: a.limitations,
    summary: a.summary,
    knowledgePoints: a.knowledgePoints,
    evidence: a.evidence,
    stale: a.stale,
    expiresAt: a.expiresAt,
    pendingEvidence: { hasNew: pendingSessions.length > 0, sessionIds: pendingSessions },
  };
}

function toPublicQuestion(q, { includeHintIndex = 0 } = {}) {
  const dto = {
    id: q.id,
    sessionId: q.sessionId,
    knowledgePointIds: q.knowledgePointIds,
    type: q.type,
    difficulty: q.difficulty,
    stem: q.stem,
    targetSkill: q.targetSkill || null,
    options: q.type === 'single_choice' ? q.options : [],
    hintsAvailable: q.hints.length,
    hintsRevealed: q.state.hintsRevealed,
    revealed: q.state.revealed,
    hints: q.hints.slice(0, q.state.hintsRevealed),
    qualityCheck: { status: q.qualityCheck.status, method: q.qualityCheck.method },
  };
  if (q.state.revealed) {
    dto.answerRelease = { canonical: q.privateAnswer.canonical, explanation: q.privateAnswer.explanation };
  }
  return dto;
}

// 作答 DTO：答案与解析仅在已批改或已揭晓时释放。
function toPublicAttempt(a) {
  const dto = {
    id: a.id,
    sessionId: a.sessionId,
    questionId: a.questionId,
    status: a.status,
    answer: a.answer,
    reasoning: a.reasoning,
    assistance: a.assistance,
    isFirstAttempt: a.isFirstAttempt,
    independent: a.independent,
    disputed: a.disputed,
    disputeReason: a.disputeReason,
    createdAt: a.createdAt,
    gradedAt: a.gradedAt,
    result: a.result,
    gradingError: a.gradingError,
  };
  if (a.status === 'graded' && a.result) {
    const q = questionsBySession.get(a.sessionId)?.get(a.questionId);
    if (q) dto.answerRelease = { canonical: q.privateAnswer.canonical, explanation: q.privateAnswer.explanation };
  }
  return dto;
}

function toPublicSession(s) {
  const questions = getQuestions(s.id);
  const attempts = listAttempts(s.id);
  const attemptByQuestion = new Map();
  for (const a of attempts) {
    const prev = attemptByQuestion.get(a.questionId);
    if (!prev || (!prev.isFirstAttempt && a.isFirstAttempt)) attemptByQuestion.set(a.questionId, a);
  }
  return {
    id: s.id,
    analysisId: s.analysisId,
    knowledgePointIds: s.knowledgePointIds,
    status: s.status,
    difficulty: s.difficulty,
    count: s.count,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    questions: questions.map((q) => {
      const dto = toPublicQuestion(q);
      const attempt = attemptByQuestion.get(q.id);
      dto.attempt = attempt ? toPublicAttempt(attempt) : null;
      const draft = draftsBySession.get(s.id)?.get(q.id);
      dto.draft = draft ? { text: draft.text, version: draft.version } : null;
      dto.hasInFlightGrading = attempts.some((a) => a.questionId === q.id && a.status === 'grading');
      return dto;
    }),
  };
}

// 对话事件联动。
conversationRepository.subscribe((event, payload) => {
  if (event === 'changed') {
    markStaleByRevision(payload.conversationId, payload.revision);
  } else if (event === 'deleted') {
    handleConversationDeleted(payload.conversationId);
  }
});

module.exports = {
  TTL,
  CAPACITY,
  createAnalysis,
  getAnalysis,
  findAnalysis,
  findCachedAnalysis,
  listAnalyses,
  deleteAnalysis,
  markStaleByRevision,
  handleConversationDeleted,
  listSessionsByAnalysisScope,
  createSession,
  getSession,
  findSession,
  listSessions,
  deleteSession,
  saveQuestion,
  getQuestions,
  getQuestion,
  setSessionStatus,
  createAttempt,
  getAttempt,
  findAttempt,
  findAttemptBySubmissionKey,
  getFirstAttempt,
  listAttempts,
  listInFlightAttempts,
  saveDraft,
  getDraft,
  getBatchResult,
  putBatchResult,
  toPublicAnalysis,
  toPublicQuestion,
  toPublicAttempt,
  toPublicSession,
  pruneExpired,
  __resetForTests() {
    analyses.clear();
    sessions.clear();
    questionsBySession.clear();
    attemptsBySession.clear();
    firstAttemptIndex.clear();
    attemptsBySubmissionKey.clear();
    draftsBySession.clear();
    fingerprintIndex.clear();
    batchResultCache.clear();
  },
};
