import React, { useEffect, useRef, useState } from 'react';
import MathMarkdown from '../MathMarkdown';
import learningApi, { uuid } from '../../api/learningApi';
import useLearningJobs from '../../hooks/useLearningJobs';
import { VERDICT_LABELS, QUESTION_TYPE_LABELS, DIFFICULTY_LABELS, STAGE_LABELS } from './labels';

// 专项训练答题视图：一题一提交、答案锁定、提示/揭晓影响独立性、草稿防抖保存。
export default function PracticeSession({ session, onSessionUpdate, onBackToList, onShowResult, onNewEvidence }) {
  const [idx, setIdx] = useState(0);
  const [error, setError] = useState('');
  const [busyQuestionId, setBusyQuestionId] = useState(null);
  const [gradingJob, setGradingJob] = useState(null); // {jobId, questionId}
  const [localAttempts, setLocalAttempts] = useState({});   // qid -> 最新一次作答（含重做）
  const [localHints, setLocalHints] = useState({});          // qid -> 已释放提示数组
  const [revealedInfo, setRevealedInfo] = useState({});      // qid -> {canonical, explanation}
  const [redoIds, setRedoIds] = useState(new Set());         // 允许重做的题目
  const [drafts, setDrafts] = useState({});                  // qid -> {text, version, dirty}
  const [picks, setPicks] = useState({});                    // qid -> 选中选项 ID
  const [reasonings, setReasonings] = useState({});          // qid -> 解题过程（可选，不作为主存储）
  const [disputeTarget, setDisputeTarget] = useState(null);  // attemptId
  const [disputeReason, setDisputeReason] = useState('');
  const jobs = useLearningJobs();
  const draftVersions = useRef({});
  const draftTimers = useRef({});
  const resumePolled = useRef(new Set());

  const questions = session?.questions || [];
  const question = questions[Math.min(idx, Math.max(0, questions.length - 1))];

  const attemptOf = (q) => localAttempts[q.id] || q.attempt || null;
  const revealedOf = (q) => Boolean(q.revealed || revealedInfo[q.id]);

  useEffect(() => () => {
    Object.values(draftTimers.current).forEach(clearTimeout);
  }, []);

  // 页面刷新/重进后恢复：仍在批改中的作答直接轮询作答状态（不依赖 jobId）。
  useEffect(() => {
    questions.forEach((q) => {
      const inFlight = q.hasInFlightGrading && q.attempt && q.attempt.status === 'grading';
      if (inFlight && !resumePolled.current.has(q.attempt.id)) {
        resumePolled.current.add(q.attempt.id);
        pollAttempt(q.attempt.id);
      }
    });
  }, [session?.id]);

  async function pollAttempt(attemptId) {
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      let attempt;
      try {
        attempt = await learningApi.getAttempt(attemptId);
      } catch {
        return; // 服务不可达时停止，用户刷新可恢复
      }
      if (attempt.status !== 'grading') {
        setLocalAttempts((prev) => ({ ...prev, [attempt.questionId]: attempt }));
        setBusyQuestionId(null);
        onSessionUpdate();
        return;
      }
    }
  }

  function saveDraft(qid, text, immediate = false) {
    setDrafts((prev) => ({ ...prev, [qid]: { ...(prev[qid] || { version: 0 }), text, dirty: true } }));
    clearTimeout(draftTimers.current[qid]);
    const doSave = async () => {
      const next = (draftVersions.current[qid] ?? questions.find((q) => q.id === qid)?.draft?.version ?? 0) + 1;
      draftVersions.current[qid] = next;
      try {
        await learningApi.saveDraft(session.id, { questionId: qid, text, draftVersion: next });
        setDrafts((prev) => ({ ...prev, [qid]: { ...(prev[qid] || {}), dirty: false, version: next } }));
      } catch { /* 草稿保存失败不打断作答；刷新后未保存内容不承诺恢复 */ }
    };
    if (immediate) doSave();
    else draftTimers.current[qid] = setTimeout(doSave, 900);
  }

  function draftText(q) {
    const local = drafts[q.id];
    if (local && local.text !== undefined) return local.text;
    if (attemptOf(q)) return attemptOf(q).answer || '';
    return q.draft?.text || '';
  }

  async function handleHint() {
    if (!question) return;
    setError('');
    try {
      const res = await learningApi.requestHint(session.id, question.id);
      setLocalHints((prev) => ({ ...prev, [question.id]: [...(prev[question.id] || []), res.hint] }));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleReveal() {
    if (!question || !window.confirm('查看答案后，这道题将不再计入独立作答表现。确定查看？')) return;
    setError('');
    try {
      const res = await learningApi.revealAnswer(session.id, question.id);
      setRevealedInfo((prev) => ({ ...prev, [question.id]: { canonical: res.canonical, explanation: res.explanation } }));
      onSessionUpdate();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSubmit(answer, reasoning) {
    if (!question || !answer || !answer.trim()) return;
    setError('');
    setBusyQuestionId(question.id);
    try {
      const res = await learningApi.submitAttempt(session.id, {
        questionId: question.id,
        answer,
        reasoning: reasoning || '',
        submissionKey: uuid(),
      });
      if (res.attempt) setLocalAttempts((prev) => ({ ...prev, [question.id]: res.attempt }));
      if (res.jobId) {
        setGradingJob({ jobId: res.jobId, questionId: question.id });
        jobs.poll(res.jobId, {
          onCompleted: async () => {
            setGradingJob(null);
            const attempt = await learningApi.getAttempt(res.attemptId);
            setLocalAttempts((prev) => ({ ...prev, [attempt.questionId]: attempt }));
            setBusyQuestionId(null);
            setRedoIds((prev) => { const n = new Set(prev); n.delete(question.id); return n; });
            onSessionUpdate();
            onNewEvidence?.();
          },
          onFailed: (job) => {
            setGradingJob(null);
            setBusyQuestionId(null);
            setError(job.error?.message || '批改失败，可重试');
            onSessionUpdate();
          },
          onCancelled: () => { setGradingJob(null); setBusyQuestionId(null); onSessionUpdate(); },
        });
      } else {
        // 规则判题已完成
        setBusyQuestionId(null);
        setRedoIds((prev) => { const n = new Set(prev); n.delete(question.id); return n; });
        onSessionUpdate();
        onNewEvidence?.();
      }
    } catch (e) {
      setBusyQuestionId(null);
      setError(e.message);
    }
  }

  async function handleRetryGrading(attempt) {
    setError('');
    setBusyQuestionId(attempt.questionId);
    try {
      const res = await learningApi.retryGrading(attempt.id);
      setGradingJob({ jobId: res.jobId, questionId: attempt.questionId });
      jobs.poll(res.jobId, {
        onCompleted: async () => {
          setGradingJob(null);
          const fresh = await learningApi.getAttempt(attempt.id);
          setLocalAttempts((prev) => ({ ...prev, [fresh.questionId]: fresh }));
          setBusyQuestionId(null);
          onSessionUpdate();
        },
        onFailed: (job) => {
          setGradingJob(null);
          setBusyQuestionId(null);
          setError(job.error?.message || '批改仍失败，可稍后重试');
          onSessionUpdate();
        },
      });
    } catch (e) {
      setBusyQuestionId(null);
      setError(e.message);
    }
  }

  async function handleDispute() {
    if (!disputeReason.trim()) return;
    try {
      const attempt = await learningApi.disputeAttempt(disputeTarget, { reason: disputeReason.trim() });
      setLocalAttempts((prev) => ({ ...prev, [attempt.questionId]: attempt }));
      setDisputeTarget(null);
      setDisputeReason('');
      onSessionUpdate();
    } catch (e) {
      setError(e.message);
    }
  }

  function switchTo(nextIdx) {
    if (question && drafts[question.id]?.dirty) saveDraft(question.id, drafts[question.id].text, true);
    setIdx(nextIdx);
    setError('');
  }

  function submitCurrent() {
    if (!question) return;
    if (question.type === 'single_choice') {
      if (!picks[question.id]) return;
      handleSubmit(picks[question.id], '');
    } else {
      const answer = draftText(question);
      if (!answer.trim()) return;
      handleSubmit(answer, reasonings[question.id] || '');
      saveDraft(question.id, answer, true);
    }
  }

  if (!question) return <div className="pane-empty"><h3>训练组为空</h3></div>;
  const attempt = attemptOf(question);
  const revealed = revealedOf(question);
  const answerRelease = attempt?.answerRelease || revealedInfo[question.id] || question.answerRelease;
  const canRedo = attempt?.status === 'graded' && redoIds.has(question.id);
  const locked = Boolean(attempt && attempt.status !== 'grading_failed' && !canRedo);
  const inFlight = busyQuestionId === question.id || (question.hasInFlightGrading && attempt?.status === 'grading');
  const hintsShown = [...(question.hints || []), ...(localHints[question.id] || [])];

  return (
    <div className="practice-pane">
      <div className="practice-head">
        <button className="text-button" onClick={onBackToList}>‹ 训练列表</button>
        <span className="practice-progress">第 {idx + 1} / {questions.length} 题 · {DIFFICULTY_LABELS[session.difficulty] || session.difficulty}</span>
        <button className="text-button" onClick={onShowResult}>查看整组结果</button>
      </div>

      {error && <div role="alert" className="pane-error">{error}</div>}

      <article className="question-card">
        <header className="question-head">
          <span className="badge">{QUESTION_TYPE_LABELS[question.type]}</span>
          {question.knowledgePointIds.map((id) => <span className="chip-sm" key={id}>{id}</span>)}
          {revealed && <span className="badge tone-warn">已揭晓</span>}
        </header>
        <div className="question-stem"><MathMarkdown>{question.stem}</MathMarkdown></div>

        {question.type === 'single_choice' && (
          <div className="option-list" role="radiogroup" aria-label="选项">
            {question.options.map((opt) => (
              <label key={opt.id} className={`option ${picks[question.id] === opt.id ? 'option-picked' : ''} ${locked ? 'option-locked' : ''}`}>
                <input
                  type="radio"
                  name={`opt-${question.id}`}
                  disabled={locked || inFlight}
                  checked={picks[question.id] === opt.id}
                  onChange={() => setPicks((prev) => ({ ...prev, [question.id]: opt.id }))}
                />
                <strong>{opt.id}</strong>
                <MathMarkdown>{opt.text}</MathMarkdown>
              </label>
            ))}
            {!locked && (
              <button className="primary" disabled={!picks[question.id] || inFlight} onClick={submitCurrent}>
                {inFlight ? '批改中…' : '提交答案'}
              </button>
            )}
          </div>
        )}

        {(question.type === 'fill_blank' || question.type === 'short_answer') && (
          <div className="answer-area">
            <textarea
              aria-label="你的答案"
              placeholder={question.type === 'fill_blank' ? '在此输入填空答案…' : '在此输入你的解答…'}
              value={draftText(question)}
              disabled={locked || inFlight}
              onChange={(e) => saveDraft(question.id, e.target.value)}
              rows={question.type === 'short_answer' ? 4 : 2}
            />
            {question.type === 'short_answer' && !locked && (
              <textarea
                aria-label="解题过程（可选）"
                placeholder="解题过程（可选）：写下你的思路，批改会参考但不会替你补全步骤。"
                rows={3}
                disabled={inFlight}
                value={reasonings[question.id] || ''}
                onChange={(e) => setReasonings((prev) => ({ ...prev, [question.id]: e.target.value }))}
              />
            )}
            {!locked && (
              <button className="primary" disabled={inFlight || !draftText(question).trim()} onClick={submitCurrent}>
                {inFlight ? '批改中…' : '提交答案'}
              </button>
            )}
          </div>
        )}

        {inFlight && <div role="status" className="job-bar"><span className="job-text">{gradingJob ? STAGE_LABELS.grading : '批改中…'}</span></div>}

        {hintsShown.length > 0 && (
          <div className="hint-box">
            {hintsShown.map((h, i) => <p key={i}><strong>提示 {i + 1}：</strong><MathMarkdown>{h}</MathMarkdown></p>)}
          </div>
        )}
        {!attempt && !revealed && (
          <div className="assist-row">
            <button onClick={handleHint} disabled={question.hintsAvailable <= hintsShown.length || inFlight}>
              给我提示（{hintsShown.length}/{question.hintsAvailable}）
            </button>
            <button className="danger-text" onClick={handleReveal} disabled={inFlight}>直接看答案</button>
            <span className="assist-note">使用提示或看答案后，本题将按辅助练习记录，不计入独立表现。</span>
          </div>
        )}

        {revealed && answerRelease && !(attempt?.status === 'graded' && attempt.result) && (
          <section className="feedback-card" aria-label="已揭晓的答案">
            <p className="assist-note">已查看答案，后续作答按辅助练习记录，不计入独立表现。</p>
            <AnswerRelease release={answerRelease} />
          </section>
        )}
        {attempt && attempt.status === 'graded' && attempt.result && (
          <FeedbackCard
            attempt={attempt}
            release={answerRelease}
            onDispute={() => { setDisputeTarget(attempt.id); }}
          />
        )}
        {attempt && attempt.status === 'grading_failed' && (
          <div className="feedback-card tone-bad" role="alert">
            <p>批改失败：{attempt.gradingError?.message || '服务暂时不可用'}。已保留你提交的内容，可重试，不会重复计数。</p>
            <button className="primary" onClick={() => handleRetryGrading(attempt)}>重试批改</button>
          </div>
        )}
        {disputeTarget && (
          <div className="dispute-box">
            <textarea aria-label="争议原因" placeholder="说明你认为批改有误的地方…" rows={2} value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} />
            <div className="setup-actions">
              <button onClick={() => setDisputeTarget(null)}>取消</button>
              <button className="primary" disabled={!disputeReason.trim()} onClick={handleDispute}>提交争议</button>
            </div>
            <p className="assist-note">争议成绩不再计入确认错题，可重新评估。</p>
          </div>
        )}

        {attempt?.status === 'graded' && !canRedo && (
          <div className="redo-row">
            <button className="text-button" onClick={() => setRedoIds((prev) => { const n = new Set(prev); n.add(question.id); return n; })}>
              追加重做（记录为练习，不改变首次成绩）
            </button>
          </div>
        )}
      </article>

      <footer className="step-nav">
        <button disabled={idx === 0} onClick={() => switchTo(idx - 1)}>‹ 上一题</button>
        <button className="primary" disabled={idx >= questions.length - 1} onClick={() => switchTo(idx + 1)}>下一题 ›</button>
      </footer>
    </div>
  );
}

function FeedbackCard({ attempt, release, onDispute }) {
  const verdict = VERDICT_LABELS[attempt.result.verdict] || { text: attempt.result.verdict, tone: 'muted' };
  return (
    <div className={`feedback-card tone-${verdict.tone}`}>
      <div className="feedback-head">
        <span className={`badge tone-${verdict.tone}`}>{verdict.text}</span>
        <span className="feedback-score">{attempt.result.score === null ? '—' : attempt.result.score} / {attempt.result.maxScore}</span>
        {attempt.independent ? <span className="chip-sm">独立作答</span> : <span className="chip-sm">辅助练习</span>}
        {attempt.isFirstAttempt ? <span className="chip-sm">首次</span> : <span className="chip-sm">重做</span>}
        {attempt.disputed && <span className="chip-sm">已标记争议</span>}
      </div>
      <p className="feedback-text">{attempt.result.feedback}</p>
      {(attempt.result.rubricScores || []).length > 0 && (
        <ul className="rubric-list">
          {attempt.result.rubricScores.map((r) => (
            <li key={r.rubricId}>{r.rubricId}：{r.score === null ? '待确认' : `${r.score} 分`}</li>
          ))}
        </ul>
      )}
      {release && <AnswerRelease release={release} />}
      {attempt.result.verdict === 'uncertain' && attempt.result.uncertaintyReason && (
        <p className="kp-rule-note">判定存疑原因：{attempt.result.uncertaintyReason}</p>
      )}
      {!attempt.disputed && (
        <button className="text-button" onClick={onDispute}>我认为批改有误</button>
      )}
    </div>
  );
}

function AnswerRelease({ release }) {
  return (
    <div className="release-box">
      <p><strong>标准答案：</strong></p>
      <MathMarkdown>{release.canonical}</MathMarkdown>
      <p><strong>解析：</strong></p>
      <MathMarkdown>{release.explanation}</MathMarkdown>
    </div>
  );
}
