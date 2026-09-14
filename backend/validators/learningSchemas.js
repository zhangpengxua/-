// 学习功能的所有输入与模型输出结构校验。
// 输入校验失败 → INVALID_INPUT；模型输出校验失败 → 用于一次修复重试，仍失败则 LLM_INVALID_OUTPUT。
const taxonomy = require('../config/knowledgeTaxonomy');

const ASSESSMENTS = ['review_suggestion', 'suspected_weakness', 'observed_error', 'recent_success', 'insufficient_evidence'];
const EVIDENCE_LEVELS = ['low', 'medium', 'high'];
const QUESTION_TYPES = ['single_choice', 'fill_blank', 'short_answer'];
const DIFFICULTIES = ['basic', 'standard', 'challenge'];
const VERDICTS = ['correct', 'partially_correct', 'incorrect', 'uncertain'];
const TARGET_SKILLS = ['conceptual', 'direct_application', 'near_transfer', 'application'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function checkString(v, { max = Infinity, min = 0 } = {}) {
  if (typeof v !== 'string') return false;
  const t = v.trim();
  return t.length >= min && t.length <= max;
}

// 必填字符串：非空且不超过 max。
function requireString(v, max) {
  return checkString(v, { min: 1, max });
}

// ==================== 接口输入校验 ====================

function validateCreateAnalysis(body) {
  const errors = [];
  if (!isPlainObject(body)) return { ok: false, error: '请求体必须是 JSON 对象' };
  const ids = body.conversationIds;
  if (!Array.isArray(ids) || ids.length === 0) errors.push('conversationIds 必须是非空数组');
  else {
    if (ids.length > 50) errors.push('单次分析最多选择 50 条记录');
    if (ids.some((id) => !checkString(id, { max: 64 }))) errors.push('conversationIds 中存在非法 ID');
    if (new Set(ids).size !== ids.length) errors.push('conversationIds 存在重复项');
  }
  if (body.includePracticeResults !== undefined && typeof body.includePracticeResults !== 'boolean') errors.push('includePracticeResults 必须是布尔值');
  if (body.forceRefresh !== undefined && typeof body.forceRefresh !== 'boolean') errors.push('forceRefresh 必须是布尔值');
  if (!requireString(body.requestKey, 100)) errors.push('requestKey 必填（客户端生成的幂等键）');
  if (errors.length) return { ok: false, error: errors.join('；') };
  return {
    ok: true,
    value: {
      conversationIds: ids,
      includePracticeResults: body.includePracticeResults !== false,
      forceRefresh: body.forceRefresh === true,
      requestKey: body.requestKey.trim(),
    },
  };
}

function validateCreatePractice(body) {
  const errors = [];
  if (!isPlainObject(body)) return { ok: false, error: '请求体必须是 JSON 对象' };
  if (!requireString(body.analysisId, 64)) errors.push('analysisId 必填');
  if (!Array.isArray(body.knowledgePointIds) || body.knowledgePointIds.length < 1 || body.knowledgePointIds.length > 3) {
    errors.push('knowledgePointIds 必须选择 1～3 个知识点');
  } else if (body.knowledgePointIds.some((id) => !checkString(id, { max: 100 }))) {
    errors.push('knowledgePointIds 中存在非法 ID');
  }
  if (body.questionCount !== 3 && body.questionCount !== 5) errors.push('questionCount 只支持 3 或 5');
  if (!DIFFICULTIES.includes(body.difficulty)) errors.push('difficulty 必须是 basic/standard/challenge');
  if (!requireString(body.requestKey, 100)) errors.push('requestKey 必填（客户端生成的幂等键）');
  if (errors.length) return { ok: false, error: errors.join('；') };
  return {
    ok: true,
    value: {
      analysisId: body.analysisId.trim(),
      knowledgePointIds: body.knowledgePointIds,
      questionCount: body.questionCount,
      difficulty: body.difficulty,
      requestKey: body.requestKey.trim(),
    },
  };
}

function validateDraftPatch(body) {
  if (!isPlainObject(body)) return { ok: false, error: '请求体必须是 JSON 对象' };
  const errors = [];
  if (!requireString(body.questionId, 64)) errors.push('questionId 必填');
  if (typeof body.text !== 'string' || body.text.length > 20000) errors.push('text 必须是不超过 20000 字符的字符串');
  if (!Number.isInteger(body.draftVersion) || body.draftVersion < 1) errors.push('draftVersion 必须是正整数');
  if (errors.length) return { ok: false, error: errors.join('；') };
  return { ok: true, value: { questionId: body.questionId.trim(), text: body.text, draftVersion: body.draftVersion } };
}

function validateSubmitAttempt(body) {
  if (!isPlainObject(body)) return { ok: false, error: '请求体必须是 JSON 对象' };
  const errors = [];
  if (!requireString(body.questionId, 64)) errors.push('questionId 必填');
  if (!checkString(body.answer, { min: 1, max: 8000 })) errors.push('answer 必填且不超过 8000 字符');
  if (body.reasoning !== undefined && (typeof body.reasoning !== 'string' || body.reasoning.length > 8000)) errors.push('reasoning 不超过 8000 字符');
  if (!requireString(body.submissionKey, 100)) errors.push('submissionKey 必填（客户端生成的幂等键）');
  if (errors.length) return { ok: false, error: errors.join('；') };
  return {
    ok: true,
    value: {
      questionId: body.questionId.trim(),
      answer: body.answer.trim(),
      reasoning: typeof body.reasoning === 'string' ? body.reasoning.trim() : '',
      submissionKey: body.submissionKey.trim(),
    },
  };
}

function validateDispute(body) {
  if (!isPlainObject(body)) return { ok: false, error: '请求体必须是 JSON 对象' };
  if (!checkString(body.reason, { min: 1, max: 500 })) return { ok: false, error: 'reason 必填且不超过 500 字符' };
  return { ok: true, value: { reason: body.reason.trim() } };
}

// ==================== 模型输出校验 ====================
// 统一返回 {ok:true, value} 或 {ok:false, errors:[...]}，errors 用于一次修复重试。

function checkEvidenceRefs(refs, evidenceIds, ctx, errors) {
  if (!Array.isArray(refs)) {
    errors.push(`${ctx}: evidenceRefs 必须是数组`);
    return [];
  }
  const valid = [];
  for (const ref of refs) {
    if (evidenceIds.has(ref)) valid.push(ref);
    else errors.push(`${ctx}: 引用了不存在的证据 ID "${ref}"`);
  }
  return valid;
}

// 分批提取阶段输出：{problems:[{problemId, knowledgePoints:[...], difficulties:[...]}], unmappedTopics:[]}
function validateBatchExtraction(parsed, batchSamples, evidenceIds) {
  const errors = [];
  if (!isPlainObject(parsed) || !Array.isArray(parsed.problems)) {
    return { ok: false, errors: ['输出必须包含 problems 数组'] };
  }
  const sampleIds = new Set(batchSamples.map((s) => s.problemId));
  const validKpIds = new Set(taxonomy.points.map((p) => p.id));
  const problems = [];
  for (const [i, p] of parsed.problems.entries()) {
    const ctx = `problems[${i}]`;
    if (!isPlainObject(p) || !sampleIds.has(p.problemId)) {
      errors.push(`${ctx}: problemId "${p?.problemId}" 不在本次输入样本中`);
      continue;
    }
    const knowledgePoints = [];
    if (Array.isArray(p.knowledgePoints)) {
      for (const [j, kp] of p.knowledgePoints.entries()) {
        const kpCtx = `${ctx}.knowledgePoints[${j}]`;
        if (!isPlainObject(kp)) { errors.push(`${kpCtx}: 必须是对象`); continue; }
        const entry = {
          id: null,
          proposedName: null,
          evidenceRefs: checkEvidenceRefs(kp.evidenceRefs, evidenceIds, kpCtx, errors),
          note: checkString(kp.note, { max: 300 }) ? kp.note.trim() : '',
        };
        if (kp.id === null || kp.id === undefined || kp.id === '') {
          if (!checkString(kp.proposedName, { min: 2, max: 60 })) errors.push(`${kpCtx}: 未归类知识点必须提供 proposedName`);
          else entry.proposedName = kp.proposedName.trim();
        } else if (validKpIds.has(kp.id)) {
          entry.id = kp.id;
        } else {
          errors.push(`${kpCtx}: 未知的知识点 ID "${kp.id}"，只能使用输入字典中的 ID 或提交 proposedName`);
        }
        if (entry.id || entry.proposedName) knowledgePoints.push(entry);
      }
    } else {
      errors.push(`${ctx}: knowledgePoints 必须是数组`);
    }
    const difficulties = [];
    if (Array.isArray(p.difficulties)) {
      for (const [j, d] of p.difficulties.entries()) {
        const dCtx = `${ctx}.difficulties[${j}]`;
        if (!isPlainObject(d)) { errors.push(`${dCtx}: 必须是对象`); continue; }
        const strength = ['explicit_confusion', 'general_question', 'observed_error'].includes(d.strength) ? d.strength : null;
        if (!strength) { errors.push(`${dCtx}: strength 必须是 explicit_confusion/general_question/observed_error`); continue; }
        const refs = checkEvidenceRefs(d.evidenceRefs, evidenceIds, dCtx, errors);
        if (!refs.length) { errors.push(`${dCtx}: 至少引用一条真实证据`); continue; }
        difficulties.push({
          knowledgePointId: validKpIds.has(d.knowledgePointId) ? d.knowledgePointId : null,
          proposedName: checkString(d.proposedName, { min: 2, max: 60 }) ? d.proposedName.trim() : null,
          strength,
          description: checkString(d.description, { min: 2, max: 400 }) ? d.description.trim() : '',
          evidenceRefs: refs,
        });
        if (!difficulties[difficulties.length - 1].knowledgePointId && !difficulties[difficulties.length - 1].proposedName) {
          errors.push(`${dCtx}: 必须提供合法 knowledgePointId 或 proposedName`);
        }
      }
    }
    problems.push({ problemId: p.problemId, knowledgePoints, difficulties });
  }
  const unmappedTopics = Array.isArray(parsed.unmappedTopics)
    ? parsed.unmappedTopics.filter((t) => checkString(t, { min: 2, max: 60 })).map((t) => t.trim())
    : [];
  if (errors.length) return { ok: false, errors: errors.slice(0, 12) };
  return { ok: true, value: { problems, unmappedTopics } };
}

// 汇总阶段输出：{summary, knowledgePoints:[...], limitations:[]}
function validateSummaryOutput(parsed, evidenceIds, validKpIdSet) {
  const errors = [];
  if (!isPlainObject(parsed) || !Array.isArray(parsed.knowledgePoints)) {
    return { ok: false, errors: ['输出必须包含 knowledgePoints 数组'] };
  }
  const knowledgePoints = [];
  const seen = new Set();
  for (const [i, kp] of parsed.knowledgePoints.entries()) {
    const ctx = `knowledgePoints[${i}]`;
    if (!isPlainObject(kp)) { errors.push(`${ctx}: 必须是对象`); continue; }
    const id = validKpIdSet.has(kp.id) ? kp.id : null;
    if (!id) {
      if (kp.id !== null && kp.id !== undefined && kp.id !== '') { errors.push(`${ctx}: 未知的知识点 ID "${kp.id}"`); continue; }
      if (!checkString(kp.proposedName, { min: 2, max: 60 })) { errors.push(`${ctx}: 未归类知识点必须提供 proposedName`); continue; }
    }
    if (!ASSESSMENTS.includes(kp.assessment)) { errors.push(`${ctx}: assessment 非法`); continue; }
    const refs = checkEvidenceRefs(kp.evidenceRefs, evidenceIds, ctx, errors);
    if (!refs.length) { errors.push(`${ctx}: 至少引用一条真实证据`); continue; }
    const key = id || `unmapped:${kp.proposedName}`;
    if (seen.has(key)) { errors.push(`${ctx}: 知识点重复`); continue; }
    seen.add(key);
    knowledgePoints.push({
      id,
      proposedName: id ? null : kp.proposedName.trim(),
      assessment: kp.assessment,
      reason: checkString(kp.reason, { min: 2, max: 500 }) ? kp.reason.trim() : '',
      evidenceRefs: refs,
      reviewAdvice: checkString(kp.reviewAdvice, { min: 2, max: 400 }) ? kp.reviewAdvice.trim() : '',
      trainingGoal: checkString(kp.trainingGoal, { min: 2, max: 200 }) ? kp.trainingGoal.trim() : '',
    });
  }
  const summary = checkString(parsed.summary, { min: 2, max: 1000 }) ? parsed.summary.trim() : '';
  if (!summary) errors.push('summary 必填且不超过 1000 字符');
  if (errors.length) return { ok: false, errors: errors.slice(0, 12) };
  return { ok: true, value: { summary, knowledgePoints } };
}

// 出题阶段输出：{questions:[...]}
function validateGenerationOutput(parsed, knowledgePointIds, historyStemSet) {
  const errors = [];
  if (!isPlainObject(parsed) || !Array.isArray(parsed.questions)) {
    return { ok: false, errors: ['输出必须包含 questions 数组'] };
  }
  const kpSet = new Set(knowledgePointIds);
  const questions = [];
  const seenStems = new Set();
  for (const [i, q] of parsed.questions.entries()) {
    const ctx = `questions[${i}]`;
    if (!isPlainObject(q)) { errors.push(`${ctx}: 必须是对象`); continue; }
    const issue = (msg) => errors.push(`${ctx}: ${msg}`);
    if (!kpSet.has(q.knowledgePointId)) { issue(`knowledgePointId "${q.knowledgePointId}" 不在本次目标知识点内`); continue; }
    if (!QUESTION_TYPES.includes(q.type)) { issue('type 必须是 single_choice/fill_blank/short_answer'); continue; }
    if (!checkString(q.stem, { min: 10, max: 2000 })) { issue('stem 必须是 10～2000 字符'); continue; }
    if (/如图|见图|如下图/.test(q.stem)) { issue('首版训练题不允许依赖图片（题干含“如图”）'); continue; }
    const stemFp = q.stem.replace(/\s+/g, '');
    if (seenStems.has(stemFp)) { issue('题干与其他候选题重复'); continue; }
    seenStems.add(stemFp);
    if (historyStemSet && historyStemSet.has(stemFp)) { issue('题干与历史原题完全相同，不允许照抄'); continue; }
    const options = [];
    let correctOptionId = null;
    if (q.type === 'single_choice') {
      if (!Array.isArray(q.options) || q.options.length < 3 || q.options.length > 5) { issue('单选题必须提供 3～5 个选项'); continue; }
      const ids = new Set();
      const texts = new Set();
      for (const [j, opt] of q.options.entries()) {
        if (!isPlainObject(opt) || !/^[A-E]$/.test(opt.id) || !checkString(opt.text, { min: 1, max: 300 })) {
          issue(`options[${j}] 必须是 {id: A-E, text}`);
          ids.add(`__bad_${j}`);
          continue;
        }
        ids.add(opt.id);
        texts.add(opt.text.trim());
        options.push({ id: opt.id, text: opt.text.trim() });
      }
      if (ids.size !== q.options.length || texts.size !== q.options.length) { issue('选项 ID 或文本存在重复'); continue; }
      if (!/^[A-E]$/.test(q.correctOptionId) || !ids.has(q.correctOptionId)) { issue('correctOptionId 必须指向一个真实选项'); continue; }
      correctOptionId = q.correctOptionId;
    } else if (q.options !== undefined && q.options !== null) {
      issue('非选择题不应携带 options');
      continue;
    }
    const hints = Array.isArray(q.hints) ? q.hints.filter((h) => checkString(h, { min: 2, max: 300 })).map((h) => h.trim()) : [];
    if (!hints.length) { issue('每题至少提供 1 条提示'); continue; }
    if (!checkString(q.canonical, { min: 1, max: 500 })) { issue('canonical（标准答案）必填'); continue; }
    if (!checkString(q.explanation, { min: 5, max: 4000 })) { issue('explanation（解析）必填'); continue; }
    const acceptedVariants = Array.isArray(q.acceptedVariants)
      ? q.acceptedVariants.filter((v) => checkString(v, { min: 1, max: 200 })).map((v) => v.trim()).slice(0, 10)
      : [];
    if (!Array.isArray(q.rubric) || q.rubric.length < 1 || q.rubric.length > 6) { issue('rubric 必须包含 1～6 个评分点'); continue; }
    const rubric = [];
    const rubricIds = new Set();
    let maxScore = 0;
    for (const [j, r] of q.rubric.entries()) {
      if (!isPlainObject(r) || !checkString(r.id, { max: 32 }) || !checkString(r.description, { min: 2, max: 200 }) || !Number.isInteger(r.points) || r.points < 0 || r.points > 10) {
        issue(`rubric[${j}] 结构非法`);
        continue;
      }
      if (rubricIds.has(r.id)) { issue(`rubric[${j}] id 重复`); continue; }
      rubricIds.add(r.id);
      rubric.push({ id: r.id, description: r.description.trim(), points: r.points });
      maxScore += r.points;
    }
    if (rubric.length !== q.rubric.length) continue;
    if (maxScore < 1) { issue('总分必须 ≥ 1'); continue; }
    const targetSkill = TARGET_SKILLS.includes(q.targetSkill) ? q.targetSkill : 'direct_application';
    questions.push({
      knowledgePointId: q.knowledgePointId,
      type: q.type,
      stem: q.stem.trim(),
      options,
      correctOptionId,
      hints,
      privateAnswer: { canonical: q.canonical.trim(), acceptedVariants, explanation: q.explanation.trim(), rubric, maxScore },
      targetSkill,
    });
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 12), partial: questions };
  return { ok: true, value: questions };
}

// 复核阶段输出：{reviews:[{index, status, issues}]}
function validateReviewOutput(parsed, expectedCount) {
  const errors = [];
  if (!isPlainObject(parsed) || !Array.isArray(parsed.reviews)) {
    return { ok: false, errors: ['输出必须包含 reviews 数组'] };
  }
  const reviews = new Map();
  for (const [i, r] of parsed.reviews.entries()) {
    const ctx = `reviews[${i}]`;
    if (!isPlainObject(r) || !Number.isInteger(r.index) || r.index < 0 || r.index >= expectedCount) {
      errors.push(`${ctx}: index 必须是 0～${expectedCount - 1}`);
      continue;
    }
    const status = r.status === 'passed' ? 'passed' : (r.status === 'needs_review' ? 'needs_review' : null);
    if (!status) { errors.push(`${ctx}: status 必须是 passed 或 needs_review`); continue; }
    const issues = Array.isArray(r.issues) ? r.issues.filter((x) => checkString(x, { min: 2, max: 300 })).map((x) => x.trim()) : [];
    reviews.set(r.index, { status, issues });
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 12) };
  return { ok: true, value: reviews };
}

// 批改阶段输出：{verdict, rubricScores, feedback, errorKnowledgePointIds, confidence, needsReview, uncertaintyReason}
function validateGradingOutput(parsed, rubric, knowledgePointIds) {
  const errors = [];
  if (!isPlainObject(parsed)) return { ok: false, errors: ['输出必须是 JSON 对象'] };
  const verdict = VERDICTS.includes(parsed.verdict) ? parsed.verdict : null;
  if (!verdict) errors.push('verdict 必须是 correct/partially_correct/incorrect/uncertain');
  const confidence = ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : null;
  if (!confidence) errors.push('confidence 必须是 high/medium/low');
  const feedback = checkString(parsed.feedback, { min: 2, max: 2000 }) ? parsed.feedback.trim() : '';
  if (!feedback) errors.push('feedback 必填');
  const rubricMap = new Map(rubric.map((r) => [r.id, r]));
  const rubricScores = [];
  const seen = new Set();
  if (Array.isArray(parsed.rubricScores)) {
    for (const [i, rs] of parsed.rubricScores.entries()) {
      const ctx = `rubricScores[${i}]`;
      if (!isPlainObject(rs) || !rubricMap.has(rs.rubricId)) { errors.push(`${ctx}: rubricId "${rs?.rubricId}" 不在评分点列表中`); continue; }
      if (seen.has(rs.rubricId)) { errors.push(`${ctx}: rubricId 重复`); continue; }
      seen.add(rs.rubricId);
      const def = rubricMap.get(rs.rubricId);
      if (rs.score === null) {
        rubricScores.push({ rubricId: rs.rubricId, score: null });
        continue;
      }
      if (!Number.isInteger(rs.score) || rs.score < 0 || rs.score > def.points) {
        errors.push(`${ctx}: score 必须是 0～${def.points} 的整数或 null`);
        continue;
      }
      rubricScores.push({ rubricId: rs.rubricId, score: rs.score });
    }
  } else {
    errors.push('rubricScores 必须是数组');
  }
  if (verdict !== 'uncertain' && seen.size !== rubric.length) {
    errors.push('非 uncertain 结论必须覆盖每个评分点');
  }
  const errorKps = Array.isArray(parsed.errorKnowledgePointIds)
    ? parsed.errorKnowledgePointIds.filter((id) => knowledgePointIds.includes(id))
    : [];
  if (errors.length) return { ok: false, errors: errors.slice(0, 10) };
  return {
    ok: true,
    value: {
      verdict,
      rubricScores,
      feedback,
      errorKnowledgePointIds: [...new Set(errorKps)],
      confidence,
      needsReview: parsed.needsReview === true,
      uncertaintyReason: checkString(parsed.uncertaintyReason, { max: 500 }) ? parsed.uncertaintyReason.trim() : '',
    },
  };
}

module.exports = {
  ASSESSMENTS,
  EVIDENCE_LEVELS,
  QUESTION_TYPES,
  DIFFICULTIES,
  VERDICTS,
  validateCreateAnalysis,
  validateCreatePractice,
  validateDraftPatch,
  validateSubmitAttempt,
  validateDispute,
  validateBatchExtraction,
  validateSummaryOutput,
  validateGenerationOutput,
  validateReviewOutput,
  validateGradingOutput,
};
