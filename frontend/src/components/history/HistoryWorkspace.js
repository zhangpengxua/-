import React, { useCallback, useEffect, useRef, useState } from 'react';
import learningApi, { uuid } from '../../api/learningApi';
import useLearningJobs from '../../hooks/useLearningJobs';
import HistoryRecordList from './HistoryRecordList';
import WeaknessReport from './WeaknessReport';
import PracticeSetup from './PracticeSetup';
import PracticeSession from './PracticeSession';
import PracticeResult from './PracticeResult';
import { jobStageText } from './labels';

// 学习历史视图：历史记录 / 薄弱点分析 / 专项训练 三个页签的编排与任务流。
export default function HistoryWorkspace({ currentId, onOpenProblem, onDeleteProblem }) {
  const [tab, setTab] = useState('records');

  // 历史记录
  const [records, setRecords] = useState(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState('');
  const [range, setRange] = useState(30);
  const [selectedIds, setSelectedIds] = useState([]);

  // 分析
  const [analysisJob, setAnalysisJob] = useState(null);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [analysesList, setAnalysesList] = useState([]);
  const [updateJob, setUpdateJob] = useState(null);
  const [pendingEvidence, setPendingEvidence] = useState(false);

  // 训练
  const [selectedKpIds, setSelectedKpIds] = useState([]);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupCount, setSetupCount] = useState(3);
  const [setupDifficulty, setSetupDifficulty] = useState('basic');
  const [practiceJob, setPracticeJob] = useState(null);
  const [sessionList, setSessionList] = useState(null);
  const [session, setSession] = useState(null);
  const [sessionResult, setSessionResult] = useState(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState('');
  const [showResult, setShowResult] = useState(false);

  const jobs = useLearningJobs();
  const requestSeq = useRef(0);

  // ==================== 数据加载 ====================

  const rangeParams = useCallback((r) => {
    if (r === 'all') return {};
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (r - 1));
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1);
    return { from: start.toISOString(), to: end.toISOString() };
  }, []);

  const loadRecords = useCallback(async (r, { keepSelection = false } = {}) => {
    setRecordsLoading(true);
    setRecordsError('');
    try {
      const params = { limit: 50, ...rangeParams(r) };
      let all = [];
      let cursor = null;
      for (let page = 0; page < 4; page++) {
        const data = await learningApi.getHistory({ ...params, ...(cursor ? { cursor } : {}) });
        all = all.concat(data.items);
        if (!data.nextCursor || all.length >= 200) break;
        cursor = data.nextCursor;
      }
      setRecords(all);
      if (!keepSelection) {
        const defaults = all.filter((x) => x.analyzable).slice(0, 20).map((x) => x.id);
        setSelectedIds(defaults);
      } else {
        setSelectedIds((prev) => prev.filter((id) => all.some((x) => x.id === id && x.analyzable)));
      }
    } catch (e) {
      setRecordsError(e.message);
    } finally {
      setRecordsLoading(false);
    }
  }, [rangeParams]);

  const loadAnalysesList = useCallback(async () => {
    try {
      const data = await learningApi.listAnalyses({ limit: 20 });
      setAnalysesList(data.items);
      return data.items;
    } catch {
      return [];
    }
  }, []);

  const loadReport = useCallback(async (id) => {
    setReportLoading(true);
    setReportError('');
    try {
      const data = await learningApi.getAnalysis(id);
      setReport(data);
      setPendingEvidence(Boolean(data.pendingEvidence?.hasNew));
    } catch (e) {
      setReportError(e.code === 'NOT_FOUND' ? '分析报告不存在或已过期（服务重启会清空）。' : e.message);
      setReport(null);
    } finally {
      setReportLoading(false);
    }
  }, []);

  const loadSessionList = useCallback(async () => {
    try {
      const data = await learningApi.listPracticeSessions({ limit: 20 });
      setSessionList(data.items);
    } catch (e) {
      setSessionList([]);
    }
  }, []);

  const loadSession = useCallback(async (id) => {
    try {
      const data = await learningApi.getPracticeSession(id);
      setSession(data);
      return data;
    } catch (e) {
      setErrorTabMessage(e);
      return null;
    }
  }, []);

  function setErrorTabMessage(e) {
    setReportError(e.code === 'NOT_FOUND' ? '训练组不存在或已过期（服务重启会清空）。' : e.message);
  }

  useEffect(() => { loadRecords(30); }, []);
  useEffect(() => { loadAnalysesList(); loadSessionList(); }, []);

  // ==================== 分析任务 ====================

  const startAnalysis = useCallback(async ({ conversationIds, forceRefresh }) => {
    const seq = ++requestSeq.current;
    setAnalysisJob({ stageText: '正在创建分析任务…' });
    try {
      const res = await learningApi.createAnalysis({
        conversationIds,
        includePracticeResults: true,
        forceRefresh,
        requestKey: uuid(),
      });
      if (seq !== requestSeq.current) return;
      jobs.poll(res.jobId, {
        onUpdate: (job) => setAnalysisJob({ stageText: jobStageText(job), jobId: job.id }),
        onCompleted: async (job) => {
          setAnalysisJob(null);
          if (seq !== requestSeq.current) return;
          const items = await loadAnalysesList();
          await loadReport(job.result.analysisId);
          if (items.length) setTab('analysis');
        },
        onFailed: (job) => {
          setAnalysisJob(null);
          setReportError(job.error?.code === 'INSUFFICIENT_DATA'
            ? '所选范围内没有可分析的文字题目。图片题请先回原题确认文字后再试。'
            : (job.error?.message || '分析失败'));
          setTab('analysis');
          setReport(null);
        },
        onCancelled: () => setAnalysisJob(null),
      });
    } catch (e) {
      setAnalysisJob(null);
      setReportError(e.message);
    }
  }, [jobs, loadAnalysesList, loadReport]);

  const cancelAnalysisJob = useCallback(async () => {
    const id = analysisJob?.jobId;
    if (id) await jobs.cancel(id);
    setAnalysisJob(null);
    setUpdateJob(null);
  }, [analysisJob, jobs]);

  const cancelPracticeJob = useCallback(async () => {
    const id = practiceJob?.jobId;
    if (id) await jobs.cancel(id);
    setPracticeJob(null);
  }, [practiceJob, jobs]);

  const updateAnalysis = useCallback(async () => {
    if (!report) return;
    setTab('analysis');
    const seq = ++requestSeq.current;
    setUpdateJob({ stageText: '正在更新分析…' });
    try {
      const res = await learningApi.createAnalysis({
        conversationIds: report.scope.conversationIds,
        includePracticeResults: true,
        forceRefresh: true,
        requestKey: uuid(),
      });
      if (seq !== requestSeq.current) return;
      jobs.poll(res.jobId, {
        onUpdate: (job) => setUpdateJob({ stageText: jobStageText(job), jobId: job.id }),
        onCompleted: async (job) => {
          setUpdateJob(null);
          setPendingEvidence(false);
          await loadAnalysesList();
          await loadReport(job.result.analysisId);
        },
        onFailed: (job) => {
          setUpdateJob(null);
          setReportError(job.error?.message || '更新失败，可稍后重试');
        },
        onCancelled: () => setUpdateJob(null),
      });
    } catch (e) {
      setUpdateJob(null);
      setReportError(e.message);
    }
  }, [report, jobs, loadAnalysesList, loadReport]);

  // ==================== 训练任务 ====================

  const startPractice = useCallback(async () => {
    if (!report || !selectedKpIds.length) return;
    setSetupOpen(false);
    setTab('practice');
    setShowResult(false);
    const seq = requestSeq.current;
    setPracticeJob({ stageText: '正在创建训练任务…' });
    try {
      const res = await learningApi.createPractice({
        analysisId: report.id,
        knowledgePointIds: selectedKpIds,
        questionCount: setupCount,
        difficulty: setupDifficulty,
        requestKey: uuid(),
      });
      if (seq !== requestSeq.current) return;
      jobs.poll(res.jobId, {
        onUpdate: (job) => setPracticeJob({ stageText: jobStageText(job), jobId: job.id }),
        onCompleted: async (job) => {
          setPracticeJob(null);
          if (seq !== requestSeq.current) return;
          const s = await loadSession(job.result.sessionId);
          if (s) { setShowResult(false); loadSessionList(); }
          else setPracticeJob(null);
        },
        onFailed: (job) => {
          setPracticeJob(null);
          setReportError(job.error?.code === 'SOURCE_CHANGED'
            ? '分析已过期，请先更新分析，再生成训练。'
            : (job.error?.message || '生成失败：题目未全部通过复核，整组未保存。可重新尝试。'));
        },
        onCancelled: () => setPracticeJob(null),
      });
    } catch (e) {
      setPracticeJob(null);
      setReportError(e.message);
    }
  }, [report, selectedKpIds, setupCount, setupDifficulty, jobs, loadSession, loadSessionList]);

  const refreshSession = useCallback(async () => {
    if (session) await loadSession(session.id);
  }, [session, loadSession]);

  const showSessionResult = useCallback(async () => {
    if (!session) return;
    setShowResult(true);
    setResultLoading(true);
    setResultError('');
    try {
      const data = await learningApi.getSessionResult(session.id);
      setSessionResult(data);
    } catch (e) {
      setResultError(e.message);
      setShowResult(false);
    } finally {
      setResultLoading(false);
    }
  }, [session]);

  // ==================== 操作 ====================

  const toggleRecord = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAllAnalyzable = (analyzable) => {
    const ids = analyzable.map((r) => r.id);
    const allIn = ids.every((id) => selectedIds.includes(id));
    setSelectedIds(allIn ? selectedIds.filter((id) => !ids.includes(id)) : [...new Set([...selectedIds, ...ids])]);
  };
  const toggleKp = (id) => setSelectedKpIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const openProblem = async (id) => {
    const ok = await onOpenProblem(id);
    if (!ok) setRecordsError('题目读取失败，可能已被删除或服务已重启。');
    return ok;
  };

  const deleteProblem = async (id) => {
    if (!window.confirm('删除这道题的学习记录？关联的分析报告和训练也会一起删除。')) return;
    const ok = await onDeleteProblem(id);
    if (!ok) { setRecordsError('删除失败，请重试。'); return; }
    if (report?.scope?.conversationIds?.includes(id)) setReport(null);
    await Promise.all([loadRecords(range, { keepSelection: true }), loadAnalysesList(), loadSessionList()]);
  };

  const deleteReport = async (id) => {
    if (!window.confirm('删除这份分析报告？其派生的训练和作答也会删除。')) return;
    try {
      await learningApi.deleteAnalysis(id);
      if (report?.id === id) setReport(null);
      await loadAnalysesList();
    } catch (e) {
      setReportError(e.message);
    }
  };

  const deleteSession = async (id) => {
    if (!window.confirm('删除这个训练组及其作答记录？')) return;
    try {
      await learningApi.deletePracticeSession(id);
      if (session?.id === id) setSession(null);
      await loadSessionList();
    } catch (e) {
      setReportError(e.message);
    }
  };

  const tabs = [
    { key: 'records', label: '历史记录' },
    { key: 'analysis', label: '薄弱点分析', dot: pendingEvidence },
    { key: 'practice', label: '专项训练' },
  ];

  return (
    <div className="history-workspace">
      <div className="history-tabs" role="tablist" aria-label="学习历史">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`history-tab ${tab === t.key ? 'tab-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}{t.dot && <span className="dot-badge" aria-label="有新的训练证据" />}
          </button>
        ))}
      </div>

      <div className="history-body">
        {tab === 'records' && (
          <HistoryRecordList
            records={records}
            loading={recordsLoading}
            error={recordsError}
            range={range}
            onRangeChange={(r) => { setRange(r); loadRecords(r); }}
            selectedIds={selectedIds}
            onToggle={toggleRecord}
            onToggleAll={toggleAllAnalyzable}
            onAnalyze={() => startAnalysis({ conversationIds: selectedIds, forceRefresh: false })}
            analysisJob={analysisJob}
            onCancelJob={cancelAnalysisJob}
            onOpenProblem={openProblem}
            onDeleteProblem={deleteProblem}
            currentId={currentId}
          />
        )}

        {tab === 'analysis' && (
          <>
            {reportError && <div role="alert" className="pane-error">{reportError} <button className="text-button" onClick={() => setReportError('')}>关闭</button></div>}
            <WeaknessReport
              report={report}
              loading={reportLoading}
              error={reportError && !report ? reportError : ''}
              analysesList={analysesList}
              onSelectReport={(id) => loadReport(id)}
              onUpdateAnalysis={updateAnalysis}
              updateJob={updateJob}
              pendingEvidence={pendingEvidence}
              selectedKpIds={selectedKpIds}
              onToggleKp={toggleKp}
              onOpenPracticeSetup={() => { setSetupOpen(true); setTab('practice'); }}
              onOpenProblem={openProblem}
            />
            {setupOpen && (
              <PracticeSetup
                selectedKpNames={report?.knowledgePoints?.filter((kp) => selectedKpIds.includes(kp.id)).map((kp) => kp.name) || []}
                count={setupCount}
                difficulty={setupDifficulty}
                onCountChange={setSetupCount}
                onDifficultyChange={setSetupDifficulty}
                onStart={startPractice}
                onCancel={() => setSetupOpen(false)}
                job={practiceJob}
              />
            )}
          </>
        )}

        {tab === 'practice' && (
          practiceJob ? (
            <PracticeSetup
              selectedKpNames={[]}
              count={setupCount}
              difficulty={setupDifficulty}
              onCountChange={setSetupCount}
              onDifficultyChange={setSetupDifficulty}
              onStart={() => {}}
              onCancel={cancelPracticeJob}
              job={practiceJob}
            />
          ) : setupOpen ? (
            <PracticeSetup
              selectedKpNames={report?.knowledgePoints?.filter((kp) => selectedKpIds.includes(kp.id)).map((kp) => kp.name) || []}
              count={setupCount}
              difficulty={setupDifficulty}
              onCountChange={setSetupCount}
              onDifficultyChange={setSetupDifficulty}
              onStart={startPractice}
              onCancel={() => setSetupOpen(false)}
              job={null}
            />
          ) : session ? (
            showResult ? (
              <PracticeResult
                session={session}
                result={sessionResult}
                loading={resultLoading}
                error={resultError}
                onBack={() => setShowResult(false)}
                onUpdateAnalysis={() => { setSetupOpen(false); updateAnalysis(); }}
                updating={Boolean(updateJob)}
              />
            ) : (
              <PracticeSession
                key={session.id}
                session={session}
                onSessionUpdate={refreshSession}
                onBackToList={() => { setSession(null); loadSessionList(); }}
                onShowResult={showSessionResult}
                onNewEvidence={() => setPendingEvidence(true)}
              />
            )
          ) : (
            <SessionList
              items={sessionList}
              onOpen={async (id) => { const s = await loadSession(id); if (!s) setReportError('训练组不存在或已过期。'); }}
              onDelete={deleteSession}
              onRefresh={loadSessionList}
              onGoReport={() => setTab('analysis')}
            />
          )
        )}
      </div>
    </div>
  );
}

function SessionList({ items, onOpen, onDelete, onRefresh, onGoReport }) {
  return (
    <div className="sessions-pane">
      <div className="pane-toolbar">
        <h3>训练列表</h3>
        <button className="text-button" onClick={onRefresh}>刷新</button>
        <button className="text-button" onClick={onGoReport}>去分析页生成新训练</button>
      </div>
      {items === null && <div role="status" className="pane-status">正在加载训练列表…</div>}
      {items && items.length === 0 && (
        <div className="pane-empty"><h3>还没有专项训练</h3><p>先在「薄弱点分析」选择知识点并生成训练。</p></div>
      )}
      {items && items.length > 0 && (
        <ul className="session-list">
          {items.map((s) => (
            <li key={s.id} className="session-row">
              <div className="session-info">
                <strong>{(s.knowledgePointNames || []).join('、')}</strong>
                <span>{s.count} 题 · {s.difficulty === 'basic' ? '基础' : s.difficulty === 'standard' ? '标准' : '挑战'} · {s.status === 'completed' ? '已完成' : s.status === 'in_progress' ? '进行中' : '未开始'}</span>
              </div>
              <div className="record-actions">
                <button className="text-button" onClick={() => onOpen(s.id)}>{s.status === 'completed' ? '查看结果' : '继续训练'}</button>
                <button className="icon-btn danger" aria-label="删除训练" onClick={() => onDelete(s.id)}>✕</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="storage-note">训练与作答保存在后端内存中，服务重启后清空。</p>
    </div>
  );
}
