const fs = require('fs');
const path = require('path');
const taxonomy = require('../config/knowledgeTaxonomy');
const LLMService = require('../utils/llmService');
const { ApiError } = require('../utils/apiError');
const PROMPT = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'knowledge-resolution.txt'), 'utf8');

const validText = (s, min, max) => typeof s === 'string' && s.trim().length >= min && s.trim().length <= max;
function validateResolution(value, registry) {
  if (!value || typeof value !== 'object' || !validText(value.reason, 2, 600)) return 'reason 必填';
  if (value.existingId && !value.newPoint) return registry.isValidId(value.existingId) ? null : 'existingId 不在当前目录中';
  const p = value.newPoint;
  if (value.existingId || !p || !validText(p.name, 1, 60) || !validText(p.definition, 10, 600) || !validText(p.boundary, 5, 600)) return '必须选择 existingId 或完整的 newPoint';
  if (/未分类|未归类|未知知识点|待分类/.test(p.name)) return '必须给出实际概念名称';
  if (!Array.isArray(p.path) || p.path.length < 2 || p.path.length > 5 || p.path.some((s) => !validText(s, 1, 60))) return 'path 应包含学科和领域';
  if (!Array.isArray(p.aliases) || p.aliases.length > 12 || p.aliases.some((s) => !validText(s, 2, 60))) return 'aliases 应为最多12个同义名称';
  const sameName = registry.points.find((q) => q.name === p.name && q.path[0] === p.path[0]);
  return sameName ? `目录已有同学科同名概念 ${sameName.id}，请复用；不同概念必须给出可区分的标准名称` : null;
}

function createResolver(registry, call = (...args) => LLMService.callLLMStructured(...args)) {
  let tail = Promise.resolve();
  function locked(fn) {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  }
  // 判定与入库串行：等待中的分析必须看到前一项刚创建的概念，防止并发另建同义词。
  function resolve(ctx, candidate, context) {
    return locked(async () => {
      ctx.ensureActive();
      const messages = [{ role: 'user', content: JSON.stringify({ candidate, context, knowledgeTaxonomy: registry.listForPrompt() }) }];
      for (let i = 0; i < 2; i++) {
        ctx.ensureActive();
        const raw = await call(messages, PROMPT, 2048, { signal: ctx.signal, temperature: 0, taskType: 'learning-classification', timeoutMs: Number(process.env.LEARNING_LLM_TIMEOUT_MS) || undefined });
        let value, error;
        try {
          value = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
          error = validateResolution(value, registry);
        } catch { error = '输出必须是合法 JSON'; }
        if (!error) {
          ctx.ensureActive();
          if (value.existingId) {
            // 归并决定通过之后才记住同义名称；不依靠字符串相似度盲目合并。
            registry.addAlias(value.existingId, candidate);
            return registry.getPoint(value.existingId);
          }
          const p = value.newPoint;
          return registry.register({ name: p.name.trim(), path: p.path.map((s) => s.trim()), aliases: [...new Set(p.aliases.map((s) => s.trim()))], definition: p.definition.trim(), boundary: p.boundary.trim() });
        }
        messages.push({ role: 'assistant', content: raw }, { role: 'user', content: `请修正：${error}，仅返回 JSON。` });
      }
      throw new ApiError('LLM_INVALID_OUTPUT', '知识点归并未完成，请重试分析', { retryable: true });
    });
  }
  async function resolveBatch(ctx, batch, samples, evidence) {
    // 深拷贝：缓存及其他任务不可观察到一半完成的归并。
    const result = JSON.parse(JSON.stringify(batch));
    for (const problem of result.problems) {
      const sample = samples.find((s) => s.problemId === problem.problemId);
      const known = new Map();
      const entries = [...problem.knowledgePoints.map((e) => [e, 'id']), ...problem.difficulties.map((e) => [e, 'knowledgePointId'])];
      for (const [entry, idField] of entries) {
        if (entry[idField]) continue;
        const name = entry.proposedName;
        let point = known.get(name);
        if (!point) {
          ctx.setStage('classifying');
          point = await resolve(ctx, name, {
            questionText: sample?.questionText,
            note: entry.note || entry.description,
            evidence: evidence.filter((e) => entry.evidenceRefs.includes(e.id)).map((e) => ({ excerpt: e.excerpt, kind: e.evidenceKind })),
          });
          known.set(name, point);
        }
        entry[idField] = point.id;
        entry.proposedName = null;
      }
      const merged = new Map();
      for (const kp of problem.knowledgePoints) {
        if (!merged.has(kp.id)) merged.set(kp.id, kp);
        else merged.get(kp.id).evidenceRefs = [...new Set([...merged.get(kp.id).evidenceRefs, ...kp.evidenceRefs])];
      }
      problem.knowledgePoints = [...merged.values()];
    }
    result.unmappedTopics = [];
    return result;
  }
  return { resolve, resolveBatch };
}
module.exports = { ...createResolver(taxonomy), createResolver, validateResolution };
