const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRegistry } = require('../repositories/knowledgeRegistry');
const { createResolver } = require('../services/knowledgeResolutionService');

const point = { name: '补码加法溢出判定', path: ['计算机科学', '数据表示'], aliases: ['有符号整数加法溢出'],
  definition: '固定字长的补码加法中，同号相加结果异号时发生溢出。', boundary: '与无符号进位、截断和浮点溢出分别处理。' };
const context = () => ({ ensureActive() {}, setStage() {}, signal: new AbortController().signal });

test('知识点编号、定义和别名在重新加载后保持一致', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-test-'));
  try {
    const file = path.join(dir, 'registry.json');
    const a = createRegistry([], file);
    const kp = a.register(point);
    a.addAlias(kp.id, '补码有符号加法越界');
    const b = createRegistry([], file);
    assert.equal(b.findByName('补码有符号加法越界').id, kp.id);
    assert.equal(b.register(point).id, kp.id);
    assert.equal(b.points.length, 1);
    assert.equal(b.getPoint(kp.id).boundary, point.boundary);
    assert.equal(b.version, a.version);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('并发分析的不同名称先看最新目录，归并到同一编号', async () => {
  const registry = createRegistry([], null);
  const resolver = createResolver(registry, async (messages) => {
    const input = JSON.parse(messages[0].content);
    return JSON.stringify(input.knowledgeTaxonomy.length
      ? { existingId: input.knowledgeTaxonomy[0].id, reason: '不同题型考查同一补码溢出规则' }
      : { newPoint: point, reason: '目录尚无计算机数据表示知识点' });
  });
  const [a, b] = await Promise.all([
    resolver.resolve(context(), '补码加法溢出', { questionText: '一道选择题' }),
    resolver.resolve(context(), '带符号整数相加越界', { questionText: '一道简答题' }),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(registry.points.length, 1);
  assert.equal(registry.findByName('带符号整数相加越界').id, a.id);
});

test('同名但跨学科不同定义的概念不会被名称匹配强行合并', async () => {
  const registry = createRegistry([], null);
  registry.register({ ...point, name: '树', path: ['计算机科学', '数据结构'] });
  const biology = { name: '树', path: ['生物学', '植物'], aliases: [], definition: '具有木质主干及多年生长特征的植物类群。', boundary: '描述植物特征，不是计算机数据结构。' };
  const resolver = createResolver(registry, async () => JSON.stringify({ newPoint: biology, reason: '上下文为植物学中的树' }));
  const b = await resolver.resolve(context(), '树', { questionText: '树的年轮如何形成？' });
  assert.equal(b.path[0], '生物学');
  assert.equal(registry.points.length, 2);
  assert.equal(registry.findByName('树'), null);
});

test('伪造 ID 修复失败时不写入分类；取消的晚返回也不写入', async () => {
  const registry = createRegistry([], null);
  const bad = createResolver(registry, async () => JSON.stringify({ existingId: 'fake', reason: '假的引用' }));
  await assert.rejects(bad.resolve(context(), '新概念', {}), { code: 'LLM_INVALID_OUTPUT' });
  let cancelled = false;
  const ctx = { ...context(), ensureActive() { if (cancelled) throw new Error('cancelled'); } };
  const late = createResolver(registry, async () => { cancelled = true; return JSON.stringify({ newPoint: point, reason: '新增分类' }); });
  await assert.rejects(late.resolve(ctx, '新概念', {}), /cancelled/);
  assert.equal(registry.points.length, 0);
});

test('存储损坏时明确失败，不用空目录覆盖既有分类', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-test-'));
  try {
    const file = path.join(dir, 'registry.json');
    fs.writeFileSync(file, '{broken');
    assert.throws(() => createRegistry([], file));
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
