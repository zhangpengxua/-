// 测试辅助：mock 结构化模型调用（不依赖付费接口与真实网络）。
const LLMService = require('../../utils/llmService');

// handler({ systemPrompt, messages, callIndex, options }) => string
// 返回 { calls, restore }。
function installMockLLM(handler) {
  const original = LLMService.callLLMStructured;
  const calls = [];
  LLMService.callLLMStructured = async (messages, systemPrompt, maxTokens, options = {}) => {
    calls.push({ messages, systemPrompt, maxTokens, options, callIndex: calls.length });
    return handler({ messages, systemPrompt, maxTokens, options, callIndex: calls.length - 1 });
  };
  return {
    calls,
    restore() {
      LLMService.callLLMStructured = original;
    },
  };
}

// 依据系统提示词识别任务类型。
function promptKind(systemPrompt) {
  if (systemPrompt.includes('训练题设计助手')) return 'generation';
  if (systemPrompt.includes('审校助手')) return 'review';
  if (systemPrompt.includes('作答评估助手')) return 'grading';
  if (systemPrompt.includes('学习诊断助手')) return 'analysis';
  return 'unknown';
}

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true; // 谓词可能为 async，必须等待其结果
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function json(value) {
  return JSON.stringify(value);
}

module.exports = { installMockLLM, promptKind, waitFor, json };
