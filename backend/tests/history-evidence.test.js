const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const conversationRepository = require('../repositories/conversationRepository');
const evidenceService = require('../services/historyEvidenceService');

beforeEach(() => {
  conversationRepository.__resetForTests();
});

function seedConv(messages, source) {
  const conv = conversationRepository.createConversation({ source });
  for (const m of messages) {
    if (m.role === 'user') conversationRepository.appendUserMessage(conv, m);
    else conversationRepository.appendAssistantMessage(conv, m);
  }
  return conv;
}

test('根题与追问拆分：结构化 studentQuestion 优先，旧格式其次', () => {
  const conv = seedConv([
    { role: 'user', content: '圆锥底面半径 R=3，高 H=6，求截面面积与 h 的关系。', kind: 'question', source: 'user_problem' },
    { role: 'assistant', content: '由相似三角形……' },
    { role: 'user', content: '为什么要用 H-h？', kind: 'followup', source: 'user_problem', studentQuestion: '为什么要用 H-h？' },
    { role: 'user', content: '针对题目追问：圆锥题\n当前步骤：相似三角形\n学生问题：面积比怎么来的？', kind: 'followup', source: 'user_problem' },
  ]);
  const { samples, evidence, stats } = evidenceService.buildLearningSamples([conv]);
  assert.equal(samples.length, 1);
  assert.equal(stats.followupCount, 2);
  assert.equal(samples[0].followups[0].origin, 'structured');
  assert.equal(samples[0].followups[0].studentText, '为什么要用 H-h？');
  assert.equal(samples[0].followups[1].origin, 'legacy_text');
  assert.equal(samples[0].followups[1].studentText, '面积比怎么来的？');
  // 证据白名单：根题 topic + 两条追问（均含疑问词 → explicit_confusion）
  assert.deepEqual(evidence.map((e) => e.evidenceKind), ['topic', 'explicit_confusion', 'explicit_confusion']);
  assert.ok(evidence.every((e) => e.sourceType === 'history_message'));
});

test('重复追问不增加独立题目数量', () => {
  const messages = [
    { role: 'user', content: '求 f(x)=x^2 的导数。', kind: 'question', source: 'user_problem' },
  ];
  for (let i = 0; i < 10; i++) {
    messages.push({ role: 'user', content: `为什么要用公式？第${i}次`, kind: 'followup', source: 'user_problem', studentQuestion: `为什么要用公式？第${i}次` });
  }
  const conv = seedConv(messages);
  const { stats, samples } = evidenceService.buildLearningSamples([conv]);
  assert.equal(stats.eligibleProblems, 1);
  assert.equal(stats.followupCount, 8); // 单样本追问上限 8，超出记 warning
  assert.ok(samples[0].warnings.includes('followups_truncated_for_analysis'));
});

test('demo 来源与硬编码示例文本被排除', () => {
  const demo = seedConv([
    { role: 'user', content: evidenceService.DEMO_EXAMPLE, kind: 'question', source: 'demo' },
  ]);
  const { samples, exclusions } = evidenceService.buildLearningSamples([demo]);
  assert.equal(samples.length, 0);
  assert.ok(exclusions.some((e) => e.reason === 'demo_source'));
});

test('仅有图片无文字 → no_usable_text；OCR 去重不重复附加', () => {
  const noText = seedConv([
    { role: 'user', content: '', ocrText: null, kind: 'question', source: 'user_problem' },
  ]);
  const r1 = evidenceService.buildLearningSamples([noText]);
  assert.ok(r1.exclusions.some((e) => e.reason === 'no_usable_text'));

  const ocr = '求 y=x^2 在 x=1 处的导数。';
  const withOcr = seedConv([
    { role: 'user', content: `${ocr}\n图片识别文字：${ocr}`, ocrText: ocr, kind: 'question', source: 'user_problem' },
  ]);
  const r2 = evidenceService.buildLearningSamples([withOcr]);
  assert.equal(r2.samples[0].questionText, ocr); // 尾部重复 OCR 已剥离
  assert.ok(!r2.samples[0].warnings.includes('embedded_ocr_differs'));
});

test('完全重复题合并计数但保留来源；AI 失败解答只作主题参考', () => {
  const stem = '求 y=sin(2x) 的导数。';
  const a = seedConv([
    { role: 'user', content: stem, kind: 'question', source: 'user_problem' },
    { role: 'assistant', content: '抱歉，服务暂时不可用。', status: 'fallback' },
  ]);
  const b = seedConv([
    { role: 'user', content: stem, kind: 'question', source: 'user_problem' },
  ]);
  const { samples, stats } = evidenceService.buildLearningSamples([a, b]);
  assert.equal(stats.eligibleProblems, 2);
  assert.equal(stats.deduplicatedProblems, 1);
  assert.equal(samples[1].duplicateOf, a._id);
  assert.ok(samples[0].warnings.includes('assistant_generation_failed'));
});

test('非数学内容被排除；超长题干被排除', () => {
  const english = seedConv([{ role: 'user', content: '帮我翻译这段英语阅读理解。', kind: 'question', source: 'user_problem' }]);
  const long = seedConv([{ role: 'user', content: 'x'.repeat(8001), kind: 'question', source: 'user_problem' }]);
  const { exclusions } = evidenceService.buildLearningSamples([english, long]);
  assert.ok(exclusions.some((e) => e.reason === 'non_math'));
  assert.ok(exclusions.some((e) => e.reason === 'too_long'));
});

test('assessConversation 与样本构建结论一致', () => {
  const ok = seedConv([{ role: 'user', content: '求定积分 ∫₀¹ x dx。', kind: 'question', source: 'user_problem' }]);
  const demo = seedConv([{ role: 'user', content: evidenceService.DEMO_EXAMPLE, kind: 'question', source: 'demo' }]);
  assert.equal(evidenceService.assessConversation(ok).analyzable, true);
  assert.deepEqual(evidenceService.assessConversation(demo), { analyzable: false, reason: 'demo_source' });
});

test('conversationRepository：旧消息读取时补 ID/kind/status 且保留', () => {
  const conv = conversationRepository.createConversation({});
  // 模拟旧数据：手工注入无 ID 的消息
  conv.messages.push({ role: 'user', content: '旧题目', timestamp: new Date() });
  conv.messages.push({ role: 'assistant', content: '旧答案' });
  conv.messages.push({ role: 'user', content: '旧追问', timestamp: new Date() });
  const first = conversationRepository.getConversation(conv._id);
  assert.ok(first.messages.every((m) => m._id && m._id.startsWith('msg_')));
  assert.deepEqual(first.messages.map((m) => m.kind), ['question', 'assistant_answer', 'followup']);
  const ids = first.messages.map((m) => m._id);
  const second = conversationRepository.getConversation(conv._id);
  assert.deepEqual(second.messages.map((m) => m._id), ids); // 补完保留
});
