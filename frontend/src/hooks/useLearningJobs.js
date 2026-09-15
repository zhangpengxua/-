import { useCallback, useEffect, useMemo, useRef } from 'react';
import learningApi from '../api/learningApi';

// 学习任务轮询：1.5s 间隔、失败退避、卸载清理；离开视图停止轮询但不自动取消任务。
export default function useLearningJobs() {
  const mountedRef = useRef(true);
  const timersRef = useRef(new Map());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };
  }, []);

  const stop = useCallback((jobId) => {
    const timer = timersRef.current.get(jobId);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(jobId);
  }, []);

  const poll = useCallback((jobId, handlers = {}, { intervalMs = 1500, maxIntervalMs = 6000 } = {}) => {
    let failures = 0;
    let stopped = false;
    const tick = async () => {
      if (stopped || !mountedRef.current) return;
      try {
        const job = await learningApi.getJob(jobId);
        if (stopped || !mountedRef.current) return;
        failures = 0;
        handlers.onUpdate?.(job);
        if (job.status === 'completed') { stop(jobId); handlers.onCompleted?.(job); return; }
        if (job.status === 'failed') { stop(jobId); handlers.onFailed?.(job); return; }
        if (job.status === 'cancelled') { stop(jobId); handlers.onCancelled?.(job); return; }
      } catch (err) {
        failures += 1;
        handlers.onError?.(err);
        if (failures >= 5) {
          stop(jobId);
          handlers.onFailed?.({ id: jobId, status: 'failed', error: { code: 'NETWORK', message: '任务状态查询失败，请稍后刷新', retryable: true } });
          return;
        }
      }
      const delay = failures > 0 ? Math.min(maxIntervalMs, intervalMs * 2 ** failures) : intervalMs;
      timersRef.current.set(jobId, setTimeout(tick, delay));
    };
    stop(jobId);
    timersRef.current.set(jobId, setTimeout(tick, 300));
    return () => { stopped = true; stop(jobId); };
  }, [stop]);

  const cancel = useCallback(async (jobId) => {
    try { return await learningApi.cancelJob(jobId); } catch { return null; }
  }, []);

  return useMemo(() => ({ poll, stop, cancel }), [poll, stop, cancel]);
}
