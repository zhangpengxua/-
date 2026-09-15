// 专项训练服务：出题与复核、训练组与题目私有答案存储、提示/揭晓释放、不可变作答与首答锁。
// 后端持有标准答案；首次公开的题目 DTO 不含答案、完整提示或评分点。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const LLMService = require('../utils/llmService');
const { ApiError } = require('../utils/apiError');
const taxonomy = require('../config/knowledgeTaxonomy');
const validators = require('../validators/learningSchemas');
const evidenceService = require('./historyEvidenceService');
const conversationRepository = require('../repositories/conversationRepository');
const learningRepository = require('../repositories/learningRepository');
const gradingService = require('./gradingService');

const GENERATION_PROMPT = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'practice-generation.txt'), 'utf8');
const REVIEW_PROMPT = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'practice-review.txt'), 'utf8');

const LLM_TIMEOUT_MS = () => Number(process.env.LEARNING_LLM_TIMEOUT_MS) || undefined;

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

// 配额分配：每个所选知识点至少 1 题，余量依次补足。
function allocateQuota(knowledgePointIds, count) {
  const n = knowledgePointIds.length;
  if (!n) throw new ApiError('INVALID_INPUT', '出题至少需要一个知识点');
  const base = Math.floor(count / n);
  const quota = knowledgePointIds.map(() => base);
  let remaining = count - base * n;
  for (let i = 0; remaining > 0; i = (i + 1) % n, remaining--) quota[i] += 1;
  return quota;
}

function difficultyDescription(difficulty) {
  return {
    basic: 'basic：单一知识点直接应用，1～2 步推理',
    standard: 'standard：需要组合条件或多步推理',
    challenge: 'challenge：需要迁移或反向思考，条件更综合',
  }[difficulty] || difficulty;
}

async function callGeneration(ctx, payload, messages) {
  ctx.ensureActive();
  const raw = await LLMService.callLLMStructured(messages, GENERATION_PROMPT, 8192, {
    signal: ctx.signal,
    temperature: 0.5,
    taskType: 'learning-practice',
    timeoutMs: LLM_TIMEOUT_MS(),
  });
  const parsed = parseModelJson(raw);
  if (!parsed.ok) throw new ApiError('LLM_INVALID_OUTPUT', '出题输出无法解析为 JSON', { details: { errors: [parsed.error] } });
  const check = validators.validateGenerationOutput(parsed.value, payload.knowledgePointIds, payload.historyStemSet);
  return { raw, check };
}

// 生成候选题：两轮内收集通过结构校验的候选；结构性问题作为反馈修正一次。
async function generateCandidates(ctx, payload) {
  const messages = [{
    role: 'user',
    content: JSON.stringify({
      knowledgePoints: payload.kps.map((k) => ({ id: k.id, name: k.name, path: k.path, definition: k.definition, boundary: k.boundary, difficultyFocus: k.difficultyFocus, trainingGoal: k.trainingGoal })),
      quota: payload.quota,
      totalCount: payload.totalCount,
      difficulty: difficultyDescription(payload.difficulty),
      outputSchemaHint: '{ questions: [{ knowledgePointId, type, stem, options, correctOptionId, hints, canonical, acceptedVariants, explanation, rubric, targetSkill }] }',
    }),
  }];
  const accepted = [];
  const issues = [];
  for (let round = 0; round < 2; round++) {
    const { raw, check } = await callGeneration(ctx, payload, messages);
    if (check.ok) {
      accepted.push(...check.value);
      break;
    }
    accepted.push(...(check.partial || []));
    issues.push(...check.errors);
    if (accepted.length >= payload.totalCount) break;
    if (round === 0) {
      const stemSet = new Set(accepted.map((q) => q.stem));
      messages.push(
        { role: 'assistant', content: raw },
        {
          role: 'user',
          content: `以下题目未通过校验，请修正后只输出补足缺失的 ${payload.totalCount - accepted.length} 道题（不要重复已通过的题干 ${[...stemSet].join('；')}）：\n- ${check.errors.join('\n- ')}`,
        }
      );
    }
  }
  return { questions: accepted.slice(0, payload.totalCount), issues };
}

async function reviewCandidates(ctx, candidates) {
  if (!candidates.length) return new Map();
  const messages = [{
    role: 'user',
    content: JSON.stringify({
      questions: candidates.map((q, index) => ({
        index,
        knowledgePointId: q.knowledgePointId,
        knowledgePoint: taxonomy.getPoint(q.knowledgePointId),
        type: q.type,
        stem: q.stem,
        options: q.options,
        correctOptionId: q.correctOptionId,
        canonical: q.privateAnswer.canonical,
        explanation: q.privateAnswer.explanation,
        rubric: q.privateAnswer.rubric,
        maxScore: q.privateAnswer.maxScore,
      })),
    }),
  }];
  for (let round = 0; round < 2; round++) {
    ctx.ensureActive();
    const raw = await LLMService.callLLMStructured(messages, REVIEW_PROMPT, 4096, {
      signal: ctx.signal,
      temperature: 0.1,
      taskType: 'learning-review',
      timeoutMs: LLM_TIMEOUT_MS(),
    });
    const parsed = parseModelJson(raw);
    if (!parsed.ok) throw new ApiError('LLM_INVALID_OUTPUT', '复核输出无法解析为 JSON', { details: { errors: [parsed.error] } });
    const check = validators.validateReviewOutput(parsed.value, candidates.length);
    if (check.ok) return check.value;
    if (round === 0) {
      messages.push({ role: 'assistant', content: raw }, { role: 'user', content: `复核输出存在以下校验问题，请修正后重新只输出 JSON：\n- ${check.errors.join('\n- ')}` });
      continue;
    }
    throw new ApiError('LLM_INVALID_OUTPUT', '复核输出未通过校验', { details: { errors: check.errors } });
  }
  throw new ApiError('LLM_INVALID_OUTPUT', '复核输出未通过校验');
}

// ==================== 出题任务 ====================

async function runGeneration(ctx, params) {
  ctx.setStage('preparing');
  const analysis = learningRepository.getAnalysis(params.analysisId);
  if (analysis.stale) {
    throw new ApiError('SOURCE_CHANGED', '分析报告已过期，请先更新分析后再生成训练');
  }
  const kps = [];
  for (const id of params.knowledgePointIds) {
    if (!taxonomy.isValidId(id)) throw new ApiError('INVALID_INPUT', `未知的知识点 ID：${id}`);
    const kp = analysis.knowledgePoints.find((k) => k.id === id);
    if (!kp) throw new ApiError('INVALID_INPUT', `知识点 ${id} 不在当前分析结果中`);
    const meta = taxonomy.getPoint(id);
    kps.push({ id, name: meta.name, path: meta.path, definition: meta.definition, boundary: meta.boundary, difficultyFocus: kp.reason, trainingGoal: kp.trainingGoal });
  }
  const quota = allocateQuota(params.knowledgePointIds, params.questionCount);

  // 历史原题精确指纹集合：禁止照抄历史原题。
  const conversations = analysis.scope.conversationIds.map((id) => conversationRepository.getConversation(id)).filter(Boolean);
  const historyStemSet = new Set(
    evidenceService.buildLearningSamples(conversations).samples.map((s) => evidenceService.stemFingerprint(s.questionText))
  );

  ctx.setStage('generating');
  const payload = { kps, quota, totalCount: params.questionCount, difficulty: params.difficulty, knowledgePointIds: params.knowledgePointIds, historyStemSet };
  const firstRound = await generateCandidates(ctx, payload);

  ctx.setStage('reviewing');
  const review = await reviewCandidates(ctx, firstRound.questions);
  const passed = firstRound.questions.filter((_, i) => review.get(i)?.status === 'passed');
  const reviewIssues = firstRound.questions.flatMap((_, i) => (review.get(i)?.issues || []));

  if (passed.length < params.questionCount) {
    // 最多补生成一次；仍不足则整组失败，不伪装成功。
    ctx.setStage('generating');
    const deficit = params.questionCount - passed.length;
    const missingQuota = params.knowledgePointIds.map((id, i) =>
      Math.max(0, quota[i] - passed.filter((q) => q.knowledgePointId === id).length));
    const retryIds = params.knowledgePointIds.filter((id, i) => missingQuota[i] > 0);
    const retryPayload = {
      ...payload,
      totalCount: deficit,
      kps: kps.filter((kp) => retryIds.includes(kp.id)),
      knowledgePointIds: retryIds,
      quota: missingQuota.filter((n) => n > 0),
      historyStemSet: new Set([...historyStemSet, ...passed.map((q) => evidenceService.stemFingerprint(q.stem))]),
    };
    const secondRound = await generateCandidates(ctx, retryPayload);
    ctx.setStage('reviewing');
    const review2 = await reviewCandidates(ctx, secondRound.questions);
    const passed2 = secondRound.questions.filter((_, i) => review2.get(i)?.status === 'passed');
    passed.push(...passed2);
    reviewIssues.push(...secondRound.questions.flatMap((_, i) => (review2.get(i)?.issues || [])));
  }

  if (passed.length < params.questionCount) {
    throw new ApiError('LLM_INVALID_OUTPUT', '生成的训练题未全部通过复核，整组生成失败', {
      details: { passed: passed.length, expected: params.questionCount, issues: reviewIssues.slice(0, 10) },
    });
  }

  ctx.ensureActive();
  ctx.setStage('saving');
  // 保存前确认来源仍然存在（删除级联由事件处理，这里兜底校验）。
  if (!learningRepository.findAnalysis(params.analysisId)) {
    throw new ApiError('SOURCE_CHANGED', '分析报告在生成期间被删除');
  }
  for (const id of analysis.scope.conversationIds) {
    if (!conversationRepository.getConversation(id)) throw new ApiError('SOURCE_CHANGED', `来源对话 ${id} 在生成期间被删除`);
  }

  const session = learningRepository.createSession({
    analysisId: params.analysisId,
    knowledgePointIds: params.knowledgePointIds,
    status: 'ready',
    difficulty: params.difficulty,
    count: params.questionCount,
    sourceSnapshotHash: analysis.sourceSnapshot.contentHash,
  });
  const questions = passed.slice(0, params.questionCount);
  for (const q of questions) {
    learningRepository.saveQuestion(session.id, {
      id: 'question_' + crypto.randomUUID(),
      sessionId: session.id,
      knowledgePointIds: [q.knowledgePointId],
      type: q.type,
      difficulty: params.difficulty,
      stem: q.stem,
      options: q.options,
      hints: q.hints,
      privateAnswer: {
        canonical: q.privateAnswer.canonical,
        acceptedVariants: q.privateAnswer.acceptedVariants || [],
        explanation: q.privateAnswer.explanation,
        rubric: q.privateAnswer.rubric,
        maxScore: q.privateAnswer.maxScore,
        correctOptionId: q.correctOptionId || null,
      },
      targetSkill: q.targetSkill,
      qualityCheck: { status: 'passed', method: 'model_review', notes: [] },
      state: { hintsRevealed: 0, revealed: false },
    });
  }
  session.questionIds = learningRepository.getQuestions(session.id).map((q) => q.id);
  session.status = 'ready';
  return { sessionId: session.id };
}

// ==================== 作答与辅助行为 ====================

// 同一道题的提示/揭晓/提交在锁内串行处理，独立性按服务端接受顺序判定。
const locks = new Map();
function withLock(key, fn) {
  const tail = (locks.get(key) || Promise.resolve()).catch(() => {});
  const run = tail.then(fn);
  locks.set(key, run.catch(() => {}));
  return run;
}

function releaseHint(session, question) {
  if (question.state.revealed) {
    throw new ApiError('ANSWER_ALREADY_REVEALED', '该题已揭晓答案，提示不再可用');
  }
  if (question.state.hintsRevealed >= question.hints.length) {
    throw new ApiError('HINTS_EXHAUSTED', '该题的提示已全部释放');
  }
  question.state.hintsRevealed += 1;
  return { hint: question.hints[question.state.hintsRevealed - 1], hintIndex: question.state.hintsRevealed - 1, hintsRevealed: question.state.hintsRevealed };
}

function revealAnswer(question) {
  question.state.revealed = true;
  return {
    canonical: question.privateAnswer.canonical,
    acceptedVariants: question.privateAnswer.acceptedVariants || [],
    explanation: question.privateAnswer.explanation,
  };
}

// 保存不可变提交；返回 {attempt, jobParams?}。规则可判的题立即批改，否则创建判题任务。
function acceptAttempt({ session, question, answer, reasoning, submissionKey }) {
  return withLock(`attempt:${session.id}:${question.id}`, () => {
    const existing = learningRepository.findAttemptBySubmissionKey(submissionKey);
    if (existing) return { attempt: existing, idempotent: true };

    const inFlight = learningRepository.listInFlightAttempts(session.id).find((a) => a.questionId === question.id);
    if (inFlight) {
      throw new ApiError('ATTEMPT_IN_PROGRESS', '该题上一次提交正在批改中，请等待完成后再提交');
    }

    const first = !learningRepository.getFirstAttempt(session.id, question.id);
    const hintedBeforeSubmit = first && question.state.hintsRevealed > 0;
    const revealedBeforeSubmit = first && question.state.revealed;
    const attempt = learningRepository.createAttempt({
      sessionId: session.id,
      questionId: question.id,
      submissionKey,
      answer,
      reasoning,
      status: 'grading',
      assistance: { hintedBeforeSubmit, revealedBeforeSubmit },
      isFirstAttempt: first,
      // 独立性由服务端根据首次提交与帮助记录判定，客户端无法声明。
      independent: first && !hintedBeforeSubmit && !revealedBeforeSubmit,
    });
    session.status = session.status === 'completed' ? 'completed' : 'in_progress';
    const ruleOutcome = gradingService.ruleGrade(question, attempt.answer);
    if (ruleOutcome) {
      gradingService.applyRuleOutcome(attempt, ruleOutcome);
      return { attempt, idempotent: false, jobParams: null };
    }
    return { attempt, idempotent: false, jobParams: { attempt, question } };
  });
}

// ==================== 整组结果（服务端统计） ====================

function buildSessionResult(session) {
  const questions = learningRepository.getQuestions(session.id);
  const attempts = learningRepository.listAttempts(session.id);
  const counts = { correct: 0, partially_correct: 0, incorrect: 0, uncertain: 0, unanswered: 0, grading_failed: 0, grading_in_progress: 0 };
  const independent = { total: 0, correct: 0, partial: 0, incorrect: 0 };
  let assistedCompleted = 0;
  let disputedCount = 0;
  const perKp = new Map(session.knowledgePointIds.map((id) => [id, { id, name: taxonomy.getPoint(id)?.name || id, attempts: 0, correct: 0, incorrect: 0, notes: [] }]));

  for (const q of questions) {
    const first = learningRepository.getFirstAttempt(session.id, q.id);
    if (!first) { counts.unanswered += 1; continue; }
    if (first.status === 'grading' || attempts.some((a) => a.questionId === q.id && a.status === 'grading')) {
      counts.grading_in_progress += 1;
      continue;
    }
    if (first.status === 'grading_failed') { counts.grading_failed += 1; continue; }
    const verdict = first.result?.verdict;
    const excluded = first.disputed || verdict === 'uncertain';
    if (first.disputed) disputedCount += 1;
    if (excluded) {
      counts.uncertain += 1;
    } else if (verdict) {
      counts[verdict] = (counts[verdict] || 0) + 1;
      if (first.independent) {
        independent.total += 1;
        if (verdict === 'correct') independent.correct += 1;
        else if (verdict === 'partially_correct') independent.partial += 1;
        else independent.incorrect += 1;
      } else if (verdict === 'correct') {
        assistedCompleted += 1;
      }
    }
    for (const id of q.knowledgePointIds) {
      const kp = perKp.get(id);
      if (!kp) continue;
      kp.attempts += 1;
      if (!excluded && verdict === 'correct') kp.correct += 1;
      if (!excluded && (verdict === 'incorrect' || verdict === 'partially_correct')) kp.incorrect += 1;
    }
  }

  const perKnowledgePoint = [...perKp.values()].map((kp) => ({
    ...kp,
    feedback: kp.attempts === 0
      ? '本题组未覆盖该知识点的作答。'
      : kp.incorrect > 0
        ? `作答中出现 ${kp.incorrect} 次错误或部分正确，建议按解析复习后重练。`
        : `已完成的作答均正确（${kp.correct} 次）；这只代表当前表现，不等于已掌握。`,
  }));

  return {
    sessionId: session.id,
    status: session.status,
    counts,
    independent,
    assistedPracticeCompleted: assistedCompleted,
    disputedCount,
    totalQuestions: questions.length,
    perKnowledgePoint,
    canUpdateAnalysis: attempts.some((a) => a.status === 'graded'),
    note: '统计由服务端按首次作答计算；争议、判定存疑和看答案后的重做不计入独立成绩。',
  };
}

module.exports = {
  allocateQuota,
  runGeneration,
  releaseHint,
  revealAnswer,
  acceptAttempt,
  buildSessionResult,
  withLock,
};
