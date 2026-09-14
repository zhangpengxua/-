import React from 'react';
import EvidenceList from './EvidenceList';
import MathMarkdown from '../MathMarkdown';
import { ASSESSMENT_LABELS, LEVEL_LABELS, PRIORITY_LABELS, formatTime } from './labels';

// 薄弱点分析报告：知识点卡片 + 原始证据 + 生成训练入口。
// 报告固定说明：分析依据为所选学习记录；未作答的历史题目只能用于提出复习建议。
export default function WeaknessReport({
  report, loading, error, analysesList, onSelectReport,
  onUpdateAnalysis, updateJob, pendingEvidence,
  selectedKpIds, onToggleKp, onOpenPracticeSetup, onOpenProblem,
}) {
  if (loading) return <div role="status" className="pane-status">正在加载分析报告…</div>;
  if (error) return <div role="alert" className="pane-error">{error}</div>;
  if (!report) {
    return (
      <div className="pane-empty">
        <h3>还没有分析报告</h3>
        <p>到「历史记录」选择题目并点击「分析所选记录」，报告会出现在这里。</p>
      </div>
    );
  }

  const stats = report.stats || {};
  const selectable = (report.knowledgePoints || []).filter((kp) => !kp.unmapped);

  return (
    <div className="report-pane">
      <div className="report-head">
        <div className="report-meta">
          <label className="report-switch">
            报告：
            <select value={report.id} onChange={(e) => onSelectReport(e.target.value)}>
              {analysesList.map((a) => (
                <option key={a.id} value={a.id}>{formatTime(a.createdAt)} · {a.scope?.conversationIds?.length || 0} 道题</option>
              ))}
            </select>
          </label>
          <span className="meta-chip">样本 {stats.selectedConversations ?? 0} 条</span>
          <span className="meta-chip">可分析 {stats.eligibleProblems ?? 0}</span>
          <span className="meta-chip">去重后 {stats.deduplicatedProblems ?? 0}</span>
          <span className="meta-chip">追问 {stats.followupCount ?? 0}</span>
          <span className="meta-chip">独立作答 {stats.independentAttempts ?? 0}</span>
        </div>
        <p className="report-disclaimer">分析依据为所选学习记录；未作答的历史题目只能用于提出复习建议，不等于不会。</p>
      </div>

      {report.stale && (
        <div role="alert" className="banner banner-stale">
          来源记录已更新，这份分析已过期；更新后才能生成新的专项训练。
          <button className="primary" onClick={onUpdateAnalysis} disabled={Boolean(updateJob)}>更新分析</button>
        </div>
      )}
      {!report.stale && (pendingEvidence || report.pendingEvidence?.hasNew) && (
        <div role="status" className="banner banner-evidence">
          有新的训练证据，可更新分析。
          <button className="primary" onClick={onUpdateAnalysis} disabled={Boolean(updateJob)}>更新分析</button>
        </div>
      )}
      {updateJob && <div role="status" className="job-bar"><span className="job-text">{updateJob.stageText}</span></div>}

      {report.summary && <MathMarkdown>{report.summary}</MathMarkdown>}

      {(report.limitations || []).length > 0 && (
        <ul className="limitation-list">
          {report.limitations.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}

      <div className="kp-grid">
        {report.knowledgePoints.map((kp) => {
          const badge = ASSESSMENT_LABELS[kp.assessment] || { text: kp.assessment, tone: 'muted' };
          const checked = selectedKpIds.includes(kp.id || kp.proposedName);
          const selectableKp = !kp.unmapped && !report.stale;
          return (
            <article className={`kp-card ${checked ? 'kp-selected' : ''}`} key={kp.id || kp.proposedName}>
              <header className="kp-head">
                <h3><MathMarkdown>{kp.unmapped ? `${kp.name}（暂未归类）` : kp.name}</MathMarkdown></h3>
                <span className={`badge tone-${badge.tone}`}>{badge.text}</span>
              </header>
              {kp.path && <p className="kp-path">{kp.path.join(' → ')}</p>}
              <div className="kp-chips">
                <span className="chip-sm">{LEVEL_LABELS[kp.evidenceLevel] || kp.evidenceLevel}</span>
                <span className={`chip-sm prio-${kp.priority}`}>{PRIORITY_LABELS[kp.priority] || kp.priority}</span>
                <span className="chip-sm">关联题目 {kp.relatedProblemCount}</span>
                <span className="chip-sm">独立作答 {kp.performance?.independent ?? 0}（全对 {kp.performance?.correct ?? 0} / 未全对 {kp.performance?.incorrect ?? 0}，其中部分正确 {kp.performance?.partial ?? 0}）</span>
              </div>
              <p className="kp-reason">{kp.reason}</p>
              <p className="kp-priority-reason">{kp.priorityReason}</p>
              {(kp.ruleNotes || []).map((n, i) => <p className="kp-rule-note" key={i}>※ {n}</p>)}
              {kp.reviewAdvice && <p className="kp-advice"><strong>复习动作：</strong>{kp.reviewAdvice}</p>}
              {kp.trainingGoal && <p className="kp-goal"><strong>训练目标：</strong>{kp.trainingGoal}</p>}
              <EvidenceList refs={kp.evidenceRefs} evidence={report.evidence} onOpenProblem={onOpenProblem} />
              <label className="kp-select">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!selectableKp}
                  onChange={() => onToggleKp(kp.id)}
                />
                {kp.unmapped ? '暂未归类，不能生成训练' : (report.stale ? '分析已过期，先更新再训练' : '选入专项训练')}
              </label>
            </article>
          );
        })}
      </div>

      {report.knowledgePoints.length === 0 && (
        <div className="pane-empty"><h3>没有得出具体知识点结论</h3><p>这是正常结果：材料不足时会明确说明，而不是编造薄弱点。</p></div>
      )}

      <div className="pane-footer">
        <span className="footer-note">选择 1～3 个知识点生成训练；每个知识点至少覆盖 1 题。</span>
        <button className="primary" disabled={report.stale || selectedKpIds.length === 0 || selectedKpIds.length > 3 || Boolean(updateJob)} onClick={onOpenPracticeSetup}>
          生成专项训练
        </button>
      </div>
    </div>
  );
}
