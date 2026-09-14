// 学习任务服务：内存队列、幂等（requestKey）、运行合并（mergeKey）、取消（AbortController）、总截止时间。
// 分析/出题/批改共用；任务 DTO 只返回结果引用，不返回原始模型输出。
const crypto = require('crypto');
const { ApiError } = require('../utils/apiError');
const LLMService = require('../utils/llmService');
const conversationRepository = require('../repositories/conversationRepository');

const num = (v, def) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};

const CONFIG = {
  maxConcurrent: num(process.env.LEARNING_MAX_CONCURRENT, 2),   // 全局最多 2 个正在执行的模型 HTTP 请求
  maxQueue: num(process.env.LEARNING_MAX_QUEUE, 10),
  taskDeadlineMs: num(process.env.LEARNING_TASK_DEADLINE_MS, 10 * 60 * 1000),
  jobTtlMs: num(process.env.LEARNING_JOB_TTL_MS, 24 * 3600 * 1000),
};

const jobs = new Map();
const requestRegistry = new Map(); // requestKey -> {jobId, requestHash}
const activeMerge = new Map();     // mergeKey -> jobId
const waiting = [];
let running = 0;
let lastPruneAt = 0;

function isoNow() {
  return new Date().toISOString();
}

function pruneExpiredJobs(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (job.expiresAt && new Date(job.expiresAt) <= now) {
      jobs.delete(id);
      if (job.requestKey && requestRegistry.get(job.requestKey)?.jobId === id) requestRegistry.delete(job.requestKey);
    }
  }
  for (const [key, jobId] of activeMerge) {
    const job = jobs.get(jobId);
    if (!job || job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') activeMerge.delete(key);
  }
}

function maybePrune() {
  const now = Date.now();
  if (now - lastPruneAt < 60 * 1000) return;
  lastPruneAt = now;
  pruneExpiredJobs(now);
}

// 创建任务。requestKey 幂等：同键同内容返回同一任务，同键不同内容抛 IDEMPOTENCY_CONFLICT；
// mergeKey 合并：相同内容且正在排队/运行的任务直接复用，不发起重复模型调用。
function createJob({ type, requestKey = null, requestHash = '', mergeKey = null, conversations = [], run }) {
  maybePrune();
  if (typeof run !== 'function') throw new ApiError('INTERNAL', '任务缺少执行函数');
  if (requestKey) {
    const reg = requestRegistry.get(requestKey);
    if (reg) {
      const prev = jobs.get(reg.jobId);
      if (!prev) requestRegistry.delete(requestKey);
      else {
        if (reg.requestHash !== requestHash) {
          throw new ApiError('IDEMPOTENCY_CONFLICT', '同一个 requestKey 被用于不同的请求内容', { details: { requestKey } });
        }
        return { job: toJobDto(prev), existing: true, merged: false };
      }
    }
  }
  if (mergeKey) {
    const activeId = activeMerge.get(mergeKey);
    const active = activeId ? jobs.get(activeId) : null;
    if (active && (active.status === 'queued' || active.status === 'running')) {
      return { job: toJobDto(active), existing: true, merged: true };
    }
  }
  if (waiting.length >= CONFIG.maxQueue) {
    throw new ApiError('CAPACITY_LIMIT', '学习任务队列已满，请稍后重试或取消进行中的任务');
  }
  const job = {
    id: 'job_' + crypto.randomUUID(),
    type,
    status: 'queued',
    stage: null,
    progress: null,
    result: null,
    error: null,
    conversations,
    requestKey,
    requestHash,
    mergeKey,
    run,
    abortController: null,
    createdAt: isoNow(),
    updatedAt: isoNow(),
    expiresAt: new Date(Date.now() + CONFIG.jobTtlMs).toISOString(),
  };
  jobs.set(job.id, job);
  if (requestKey) requestRegistry.set(requestKey, { jobId: job.id, requestHash });
  if (mergeKey) activeMerge.set(mergeKey, job.id);
  waiting.push(job);
  pump();
  return { job: toJobDto(job), existing: false, merged: false };
}

function pump() {
  while (running < CONFIG.maxConcurrent && waiting.length) {
    const next = waiting.shift();
    if (!next || next.status !== 'queued') continue;
    execute(next);
  }
}

async function execute(job) {
  running++;
  const controller = new AbortController();
  job.abortController = controller;
  job.status = 'running';
  job.updatedAt = isoNow();
  let deadlineHit = false;
  const deadline = setTimeout(() => {
    deadlineHit = true;
    try { controller.abort(); } catch (e) { /* already aborted */ }
  }, CONFIG.taskDeadlineMs);

  const ctx = {
    signal: controller.signal,
    get jobId() { return job.id; },
    setStage(stage) {
      if (job.status !== 'running') return;
      job.stage = stage;
      job.updatedAt = isoNow();
    },
    setProgress(progress) {
      if (job.status !== 'running') return;
      job.progress = { ...(job.progress || {}), ...progress };
      job.updatedAt = isoNow();
    },
    // 在关键写入口检查任务仍有效；取消/超时后抛出，避免写入半成品结果。
    ensureActive() {
      if (job.status === 'cancelled') throw new ApiError('CANCELLED', '任务已被取消');
      if (deadlineHit) throw new ApiError('TIMEOUT', '任务超过总时限被终止');
      if (controller.signal.aborted) throw new ApiError('CANCELLED', '任务已被取消');
    },
  };

  try {
    const result = await job.run(ctx);
    if (job.status === 'cancelled') return; // 取消后晚到的结果不覆盖终态
    job.status = 'completed';
    job.stage = null;
    job.result = result || null;
  } catch (e) {
    if (job.status === 'cancelled') return;
    if (deadlineHit) {
      job.status = 'failed';
      job.error = { code: 'TIMEOUT', message: '任务超过总时限被终止，可稍后重试', retryable: true, details: null };
    } else {
      const mapped = e instanceof ApiError ? e : mapUpstreamError(e);
      job.status = 'failed';
      job.error = { code: mapped.code, message: mapped.message, retryable: mapped.retryable, details: mapped.details ?? null };
    }
  } finally {
    clearTimeout(deadline);
    job.abortController = null;
    job.updatedAt = isoNow();
    running--;
    if (job.mergeKey && activeMerge.get(job.mergeKey) === job.id) activeMerge.delete(job.mergeKey);
    pump();
  }
}

function mapUpstreamError(e) {
  const classified = LLMService.classifyError ? LLMService.classifyError(e) : null;
  if (classified && classified.code !== 'CANCELLED') {
    return { code: classified.code, message: classified.message, retryable: classified.retryable, details: null };
  }
  if (e instanceof ApiError) return e;
  return new ApiError('INTERNAL', e?.message || '任务执行失败');
}

// 显式取消立即标记终态，并中止上游请求；写入结果前 run 内部会再次检查。
function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) throw new ApiError('NOT_FOUND', `任务 ${id} 不存在（可能服务已重启）`);
  if (job.status === 'queued' || job.status === 'running') {
    job.status = 'cancelled';
    job.error = { code: 'CANCELLED', message: '用户取消了任务', retryable: false, details: null };
    job.updatedAt = isoNow();
    if (job.mergeKey && activeMerge.get(job.mergeKey) === job.id) activeMerge.delete(job.mergeKey);
    try { job.abortController?.abort(); } catch (e) { /* noop */ }
  }
  return toJobDto(job);
}

function getJob(id) {
  maybePrune();
  const job = jobs.get(id);
  if (!job) throw new ApiError('NOT_FOUND', `任务 ${id} 不存在（可能服务已重启）`);
  return toJobDto(job);
}

function findJob(id) {
  return jobs.get(id) || null;
}

// 删除原对话时取消相关分析/出题任务；判题任务在批改服务内单独处理（保留已提交作答）。
function cancelJobsForConversations(conversationIds) {
  const set = new Set(conversationIds);
  for (const job of jobs.values()) {
    if (job.status !== 'queued' && job.status !== 'running') continue;
    if ((job.conversations || []).some((c) => set.has(c))) {
      try { cancelJob(job.id); } catch (e) { /* noop */ }
    }
  }
}

function toJobDto(job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
  };
}

conversationRepository.subscribe((event, payload) => {
  if (event === 'deleted') cancelJobsForConversations([payload.conversationId]);
});

module.exports = {
  CONFIG,
  createJob,
  cancelJob,
  getJob,
  findJob,
  cancelJobsForConversations,
  pruneExpiredJobs,
  __resetForTests() {
    jobs.clear();
    requestRegistry.clear();
    activeMerge.clear();
    waiting.length = 0;
    running = 0;
  },
};
