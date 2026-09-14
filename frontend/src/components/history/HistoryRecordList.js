import React from 'react';
import { Icon } from '../LearningWorkspace';
import { ANALYZABLE_REASONS, formatTime } from './labels';

// 历史记录页签：时间范围筛选、多选、分析入口。服务端返回可分析状态，前端不靠标题猜测。
export default function HistoryRecordList({
  records, loading, error, range, onRangeChange,
  selectedIds, onToggle, onToggleAll,
  onAnalyze, analysisJob, onCancelJob, onOpenProblem, onDeleteProblem, currentId,
}) {
  const analyzable = (records || []).filter((r) => r.analyzable);
  const allSelected = analyzable.length > 0 && analyzable.every((r) => selectedIds.includes(r.id));

  return (
    <div className="records-pane">
      <div className="pane-toolbar">
        <div className="range-chips" role="group" aria-label="时间范围">
          {[{ key: 7, label: '最近 7 天' }, { key: 30, label: '最近 30 天' }, { key: 'all', label: '全部记录' }].map((r) => (
            <button key={r.key} className={`chip ${String(range) === String(r.key) ? 'chip-active' : ''}`} onClick={() => onRangeChange(r.key)}>{r.label}</button>
          ))}
        </div>
        <span className="toolbar-note">默认选中最近 20 条可分析记录，单次最多 50 条</span>
      </div>

      {error && <div role="alert" className="pane-error">{error}</div>}
      {loading && <div role="status" className="pane-status">正在加载记录…</div>}
      {!loading && records && records.length === 0 && (
        <div className="pane-empty"><h3>这个时间范围还没有题目</h3><p>回到学习区完成一次解题，记录会出现在这里。</p></div>
      )}

      {!loading && records && records.length > 0 && (
        <ul className="record-list">
          <li className="record-head">
            <label className="check-cell">
              <input type="checkbox" checked={allSelected} onChange={() => onToggleAll(analyzable)} aria-label="全选可分析记录" />
              全选可分析（{analyzable.length}）
            </label>
            <span>题目</span><span>创建时间</span><span>消息</span><span>状态</span><span />
          </li>
          {records.map((r) => (
            <li key={r.id} className={`record-row ${r.id === currentId ? 'is-current' : ''}`}>
              <label className="check-cell">
                {r.analyzable ? (
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(r.id)}
                    onChange={() => onToggle(r.id)}
                    aria-label={`选择 ${r.title || '未命名题目'}`}
                  />
                ) : <span className="check-spacer" />}
              </label>
              <button className="record-title" title={r.title} onClick={() => onOpenProblem(r.id)}>{r.title || '未命名题目'}</button>
              <span className="record-time">{formatTime(r.createdAt)}</span>
              <span className="record-count">{r.messageCount}</span>
              <span className={`state-badge ${r.analyzable ? 'state-ok' : 'state-off'}`}>{ANALYZABLE_REASONS[r.analyzabilityReason] || r.analyzabilityReason}</span>
              <span className="record-actions">
                <button className="icon-btn" aria-label={`查看 ${r.title || ''}`} onClick={() => onOpenProblem(r.id)}><Icon name="expand" /></button>
                <button className="icon-btn danger" aria-label={`删除 ${r.title || ''}`} onClick={() => onDeleteProblem(r.id)}><Icon name="close" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="pane-footer">
        {analysisJob ? (
          <div className="job-bar" role="status">
            <span className="job-text">{analysisJob.stageText}</span>
            <button onClick={onCancelJob}>停止</button>
          </div>
        ) : (
          <>
            <span className="footer-note">已选 {selectedIds.length} 条；分析会读取所选题目的完整对话记录。</span>
            <button className="primary" disabled={selectedIds.length === 0} onClick={onAnalyze}>分析所选记录</button>
          </>
        )}
      </div>
      <p className="storage-note">记录与报告保存在后端内存中，服务重启后清空；页面刷新后可重新加载未过期的分析。</p>
    </div>
  );
}
