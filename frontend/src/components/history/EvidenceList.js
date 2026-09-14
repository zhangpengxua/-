import React, { useState } from 'react';
import { EVIDENCE_KIND_LABELS, formatTime } from './labels';

// 证据列表：短摘录 + 跳回原题。摘录由后端从真实记录提供，前端不展示无法定位的引用。
export default function EvidenceList({ refs, evidence, onOpenProblem }) {
  const [expanded, setExpanded] = useState(false);
  const items = (refs || []).map((id) => (evidence || []).find((e) => e.id === id)).filter(Boolean);
  if (!items.length) return <p className="evidence-empty">暂无可展示的原始证据。</p>;
  const visible = expanded ? items : items.slice(0, 2);

  return (
    <div className="evidence-list">
      <div className="evidence-head">原始证据（{items.length}）</div>
      <ul>
        {visible.map((e) => (
          <li key={e.id} className="evidence-item">
            <span className={`ev-kind kind-${e.evidenceKind}`}>{EVIDENCE_KIND_LABELS[e.evidenceKind] || e.evidenceKind}</span>
            <blockquote>{e.excerpt}</blockquote>
            <span className="ev-time">{formatTime(e.occurredAt)}</span>
            {e.sourceType === 'history_message' && e.conversationId && (
              <button className="text-button" onClick={() => onOpenProblem(e.conversationId)}>查看原题</button>
            )}
          </li>
        ))}
      </ul>
      {items.length > 2 && (
        <button className="text-button" onClick={() => setExpanded(!expanded)}>{expanded ? '收起证据' : `展开全部 ${items.length} 条证据`}</button>
      )}
    </div>
  );
}
