// 历史视图共享文案映射：不引入伪造的精确数值，只描述证据充分性与原因。
export const ASSESSMENT_LABELS = {
  review_suggestion: { text: '建议复习', tone: 'info' },
  suspected_weakness: { text: '疑似薄弱', tone: 'warn' },
  observed_error: { text: '训练中出现错误', tone: 'bad' },
  recent_success: { text: '近期独立作答正确', tone: 'good' },
  insufficient_evidence: { text: '证据不足', tone: 'muted' },
};

export const LEVEL_LABELS = {
  low: '支持程度：低',
  medium: '支持程度：中',
  high: '支持程度：高',
};

export const PRIORITY_LABELS = {
  high: '优先级：高',
  medium: '优先级：中',
  low: '优先级：低',
};

export const ANALYZABLE_REASONS = {
  ok: '可分析',
  empty: '空对话',
  demo_source: '示例内容',
  no_usable_text: '仅图片无文字',
  too_long: '题干超长',
  non_math: '暂不支持学科',
};

export const VERDICT_LABELS = {
  correct: { text: '正确', tone: 'good' },
  partially_correct: { text: '部分正确', tone: 'warn' },
  incorrect: { text: '错误', tone: 'bad' },
  uncertain: { text: '判定存疑', tone: 'muted' },
};

export const EVIDENCE_KIND_LABELS = {
  topic: '涉及主题',
  explicit_confusion: '明确困惑',
  student_reasoning: '学生推理',
  graded_attempt: '独立作答',
};

export const STAGE_LABELS = {
  reading: '正在整理记录…',
  extracting: '正在识别知识点…',
  summarizing: '正在汇总分析…',
  saving: '正在保存结果…',
  generating: '正在生成题目…',
  reviewing: '正在复核题目…',
  grading: '正在批改…',
};

export const DIFFICULTY_LABELS = {
  basic: '基础',
  standard: '标准',
  challenge: '挑战',
};

export const QUESTION_TYPE_LABELS = {
  single_choice: '单选题',
  fill_blank: '填空题',
  short_answer: '简答题',
};

export function jobStageText(job) {
  if (!job) return '';
  if (job.stage && STAGE_LABELS[job.stage]) {
    const p = job.progress;
    if (p && p.totalBatches && job.stage === 'extracting') {
      return `${STAGE_LABELS[job.stage]}（${p.completedBatches}/${p.totalBatches} 批）`;
    }
    return STAGE_LABELS[job.stage];
  }
  return '任务处理中…';
}

export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
