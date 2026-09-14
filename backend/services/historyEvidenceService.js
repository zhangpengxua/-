// 历史证据服务：把对话记录规范化为可分析样本，建立不可伪造的证据白名单。
// 核心原则：提问历史 ≠ 错题历史；只有学生本人明确表达的疑问/推理和真实独立作答才能用于学习表现判断。
const crypto = require('crypto');

const DEMO_EXAMPLE = '圆锥底面半径 R = 3，高 H = 6。截平面与底面平行，距底面的高度为 h。求截面面积与 h 的关系。';

const MATH_MARKER_RE = new RegExp(
  [
    '\\\\frac', '\\\\sqrt', '\\\\int', '\\\\sum', '\\\\lim', '\\\\sin', '\\\\cos', '\\\\tan', '\\\\log', '\\\\ln',
    '[∫∑√π≤≥≠±∞×÷]',
    '\\b(sin|cos|tan|cot|sec|csc|ln|log|lim|min|max|arcsin|arctan)\\b',
    '[a-zA-Z]\\s*[=+\\-*/^]\\s*[0-9a-zA-Z(]',
    '\\b[xyz]\\s*=',
    '\\d+\\s*[，,．.]\\s*\\d+',
    '(求|求解|解方程|解不等式|证明|计算|化简|求导|积分|方程|函数|定义域|值域|收敛|展开|级数|导数|微分|向量|矩阵|概率)',
  ].join('|'),
  'i'
);
const NON_MATH_MARKER_RE = /(英语|作文|语文|阅读理解|完形填空|背诵|默写|单词|翻译|古文)/;
const CONFUSION_RE = /(为什么|为啥|怎么|不会|不懂|不明白|没看懂|看不懂|不清楚|困惑|搞混|混淆|弄混|分不清|理解错|想不通|到底|区别|什么意思|含义|讲解|讲讲|解释)/;
const FIGURE_REF_RE = /(如图|见图|如下图|如图所示)/;
const OCR_MARKER = '图片识别文字：';

function normalizeText(text) {
  return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

// 保守指纹：只清理无意义空白与大小写，保留公式中的正负号、指数、上下标与参数。
function stemFingerprint(text) {
  return String(text || '').replace(/\s+/g, '').toLowerCase();
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// content 中可能已拼接 OCR 文本（App.send 行为）；与 ocrText 相同时去重，避免重复附加。
function stripEmbeddedOcr(content, ocrText, warnings) {
  const idx = content.lastIndexOf(OCR_MARKER);
  if (idx === -1) return content;
  const embedded = content.slice(idx + OCR_MARKER.length).trim();
  if (embedded && ocrText && stemFingerprint(embedded) === stemFingerprint(String(ocrText))) {
    return content.slice(0, idx).trim();
  }
  if (embedded) warnings.push('embedded_ocr_differs');
  return content;
}

// 追问抽取顺序：结构化 metadata.studentQuestion → 旧格式“学生问题：”拆分 → 原始消息（归属待判定）。
function extractStudentQuestion(message) {
  const meta = message.metadata || {};
  if (typeof meta.studentQuestion === 'string' && meta.studentQuestion.trim()) {
    return { text: meta.studentQuestion.trim(), origin: 'structured' };
  }
  const content = String(message.content || '');
  const idx = content.lastIndexOf('学生问题：');
  if (idx !== -1) {
    const student = content.slice(idx + '学生问题：'.length).trim();
    if (student) {
      const before = content.slice(0, idx);
      const problemMatch = before.match(/针对题目追问：([\s\S]*?)(?:当前步骤：|$)/);
      return {
        text: student,
        origin: 'legacy_text',
        context: {
          problemEcho: problemMatch ? problemMatch[1].trim() : '',
          stepEcho: (before.match(/当前步骤：([\s\S]*?)(?:$)/) || [])[1]?.trim() || '',
        },
      };
    }
  }
  return { text: content.trim(), origin: 'raw' };
}

function classifyFollowupEvidence(text) {
  return CONFUSION_RE.test(text) ? 'explicit_confusion' : 'topic';
}

// 单条对话的可分析性评估（不做模型调用），供历史列表与样本构建共用。
function assessConversation(conv) {
  const messages = Array.isArray(conv?.messages) ? conv.messages : [];
  if (!messages.length) return { analyzable: false, reason: 'empty' };
  const userMessages = messages.filter((m) => m.role === 'user');
  if (!userMessages.length) return { analyzable: false, reason: 'empty' };
  const source = conv.source || 'legacy_unknown';
  if (source === 'demo') return { analyzable: false, reason: 'demo_source' };
  const root = userMessages[0];
  const warnings = [];
  let stem = stripEmbeddedOcr(normalizeText(root.content), root.ocrText, warnings);
  if (!stem && root.ocrText) stem = normalizeText(root.ocrText);
  if (!stem) return { analyzable: false, reason: 'no_usable_text' };
  if (stemFingerprint(stem) === stemFingerprint(DEMO_EXAMPLE)) return { analyzable: false, reason: 'demo_source' };
  if (stem.length > 8000) return { analyzable: false, reason: 'too_long' };
  if (NON_MATH_MARKER_RE.test(stem) && !MATH_MARKER_RE.test(stem)) return { analyzable: false, reason: 'non_math' };
  return { analyzable: true, reason: 'ok', warnings };
}

function buildLearningSamples(conversations, options = {}) {
  const opts = {
    maxStemChars: 8000,
    maxFollowupChars: 4000,
    maxFollowupsPerSample: 8,
    maxAssistantExcerpts: 2,
    includeDemo: false,
    ...options,
  };
  const samples = [];
  const evidence = [];
  const exclusions = [];
  let evidenceSeq = 0;
  const fingerprintIndex = new Map();

  const addEvidence = ({ conversationId, messageId, attemptId = null, excerpt, evidenceKind, occurredAt, sourceType = 'history_message' }) => {
    evidenceSeq += 1;
    const id = 'ev_' + evidenceSeq;
    evidence.push({
      id,
      sourceType,
      conversationId: conversationId || null,
      messageId: messageId || null,
      attemptId: attemptId || null,
      excerpt: String(excerpt || '').slice(0, 240),
      evidenceKind,
      occurredAt: occurredAt instanceof Date ? occurredAt.toISOString() : (occurredAt || null),
    });
    return id;
  };

  for (const conv of conversations) {
    const convId = conv._id;
    const messages = Array.isArray(conv.messages) ? conv.messages : [];
    const userMessages = messages.filter((m) => m.role === 'user');
    const assessment = assessConversation(conv);
    if (!assessment.analyzable) {
      exclusions.push({ conversationId: convId, reason: assessment.reason });
      continue;
    }
    if (conv.source === 'legacy_unknown' && !opts.includeDemo) {
      // legacy 来源先尝试按文本识别示例：assessConversation 已处理精确匹配，这里记录不确定。
    }
    const warnings = [...(assessment.warnings || [])];
    if (conv.source === 'legacy_unknown') warnings.push('legacy_source_uncertain');

    const root = userMessages[0];
    const ow = [];
    let questionText = stripEmbeddedOcr(normalizeText(root.content), root.ocrText, ow);
    warnings.push(...ow);
    let stemSource = 'content';
    if (!questionText && root.ocrText) {
      questionText = normalizeText(root.ocrText);
      stemSource = 'ocr';
      warnings.push('stem_from_ocr');
    }
    if (FIGURE_REF_RE.test(questionText)) warnings.push('references_figure_without_image');

    const subject = MATH_MARKER_RE.test(questionText) ? 'math' : 'unknown';
    if (subject === 'unknown') warnings.push('subject_unverified');

    const sample = {
      problemId: convId,
      conversationRevision: conv.revision || 1,
      rootMessageId: root._id,
      questionText,
      stemSource,
      subject,
      textQuality: 'usable',
      followups: [],
      studentReasoning: [],
      assistantContext: [],
      evidenceRefs: [],
      duplicateOf: null,
      warnings,
    };

    sample.evidenceRefs.push(addEvidence({
      conversationId: convId,
      messageId: root._id,
      excerpt: questionText,
      evidenceKind: 'topic',
      occurredAt: root.timestamp,
    }));

    // 追问：同一题的多次追问只增加追问证据，不增加独立题目数量。
    let followupsTotal = 0;
    for (const m of userMessages.slice(1)) {
      followupsTotal += 1;
      if (sample.followups.length >= opts.maxFollowupsPerSample) continue;
      const extraction = extractStudentQuestion(m);
      const text = normalizeText(extraction.text).slice(0, opts.maxFollowupChars);
      if (!text) continue;
      const ref = addEvidence({
        conversationId: convId,
        messageId: m._id,
        excerpt: text,
        evidenceKind: classifyFollowupEvidence(text),
        occurredAt: m.timestamp,
      });
      sample.followups.push({ messageId: m._id, studentText: text, origin: extraction.origin, evidenceRef: ref });
    }
    if (followupsTotal > sample.followups.length) warnings.push('followups_truncated_for_analysis');

    // AI 解答仅作辅助理解题目，不能当学生表现证据；失败/降级解答记录 warning。
    const assistantMsgs = messages.filter((m) => m.role === 'assistant');
    const failedAssistant = assistantMsgs.some(
      (m) => m.status === 'fallback' || m.status === 'failed' || /服务暂时不可用|服务调用失败/.test(String(m.content || ''))
    );
    if (failedAssistant) warnings.push('assistant_generation_failed');
    for (const m of assistantMsgs.slice(0, opts.maxAssistantExcerpts)) {
      const excerpt = normalizeText(m.content).slice(0, 600);
      if (excerpt) sample.assistantContext.push({ messageId: m._id, excerpt, trusted: false });
    }

    // 精确去重：完全重复题合并计数，但保留原始来源引用；只因主题相似不合并。
    const fp = stemFingerprint(questionText);
    if (fingerprintIndex.has(fp)) {
      sample.duplicateOf = fingerprintIndex.get(fp);
      warnings.push('duplicate_of_existing');
    } else {
      fingerprintIndex.set(fp, convId);
    }

    samples.push(sample);
  }

  const stats = {
    selectedConversations: conversations.length,
    eligibleProblems: samples.length,
    deduplicatedProblems: samples.filter((s) => !s.duplicateOf).length,
    followupCount: samples.reduce((n, s) => n + s.followups.length, 0),
    independentAttempts: 0,
  };

  return { samples, evidence, exclusions, stats };
}

// 训练作答进入证据表：只有可靠（已批改、非争议、非 uncertain）的首次独立作答才登记。
function buildAttemptEvidence(attemptRows, existingEvidence, startSeq) {
  const evidence = [...existingEvidence];
  let seq = startSeq;
  for (const row of attemptRows) {
    seq += 1;
    evidence.push({
      id: 'ev_' + seq,
      sourceType: 'practice_attempt',
      conversationId: null,
      messageId: null,
      attemptId: row.attemptId,
      excerpt: `${row.knowledgePointNames.join('/')} 独立作答判定：${row.verdict}（${row.score}/${row.maxScore}）`,
      evidenceKind: 'graded_attempt',
      occurredAt: row.occurredAt,
    });
  }
  return evidence;
}

module.exports = {
  DEMO_EXAMPLE,
  MATH_MARKER_RE,
  NON_MATH_MARKER_RE,
  normalizeText,
  stemFingerprint,
  sha256,
  stripEmbeddedOcr,
  extractStudentQuestion,
  classifyFollowupEvidence,
  assessConversation,
  buildLearningSamples,
  buildAttemptEvidence,
};
