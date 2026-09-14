import React from 'react';
import { DIFFICULTY_LABELS } from './labels';

// 整组结果：服务端计算的统计与知识点反馈；辅助练习不混入独立成绩。
export default function PracticeResult({ session, result, loading, error, onBack, onUpdateAnalysis, updating }) {
  if (loading) return <div role="status" className="pane-status">正在汇总结果…</div>;
  if (error) return <div role="alert" className="pane-error">{error}</div>;
  if (!result) return null;

  const counts = result.counts || {};
  const ind = result.independent || {};

  return (
    <div className="result-pane">
      <div className="practice-head">
        <button className="text-button" onClick={onBack}>‹ 返回题目</button>
        <span className="practice-progress">整组结果 · {DIFFICULTY_LABELS[session.difficulty] || session.difficulty} · {result.totalQuestions} 题</span>
      </div>

      <div className="result-summary">
        <h3>首次作答汇总（含辅助练习）</h3>
        <div className="result-chips">
          <span className="chip-sm tone-good">正确 {counts.correct || 0}</span>
          <span className="chip-sm tone-warn">部分正确 {counts.partially_correct || 0}</span>
          <span className="chip-sm tone-bad">错误 {counts.incorrect || 0}</span>
          <span className="chip-sm">待确认 {counts.uncertain || 0}</span>
          <span className="chip-sm">未作答 {counts.unanswered || 0}</span>
          {counts.grading_failed > 0 && <span className="chip-sm tone-bad">批改失败 {counts.grading_failed}</span>}
        </div>
        <p className="result-line">
          独立作答 {ind.total || 0} 次：正确 {ind.correct || 0} · 部分正确 {ind.partial || 0} · 错误 {ind.incorrect || 0}；
          辅助练习完成 {result.assistedPracticeCompleted || 0} 次{result.disputedCount ? `；争议 ${result.disputedCount} 次（已排除）` : ''}。
          提示或解析后的做对只计为辅助练习，不影响独立正确率。
        </p>
      </div>

      <div className="result-kps">
        <h3>各知识点反馈</h3>
        {(result.perKnowledgePoint || []).map((kp) => (
          <article className="result-kp" key={kp.id}>
            <strong>{kp.name}</strong>
            <p>{kp.feedback}</p>
          </article>
        ))}
      </div>

      <p className="storage-note">{result.note}</p>

      <div className="pane-footer">
        <span className="footer-note">用真实作答更新分析，可以让复习建议更有依据。</span>
        <button className="primary" disabled={!result.canUpdateAnalysis || updating} onClick={onUpdateAnalysis}>更新薄弱点分析</button>
      </div>
    </div>
  );
}
