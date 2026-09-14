import React, { useState } from 'react';
import { DIFFICULTY_LABELS } from './labels';

// 生成训练前的配置：数量（3/5）与难度。混合知识点时配额由后端确定。
export default function PracticeSetup({ selectedKpNames, count, difficulty, onCountChange, onDifficultyChange, onStart, onCancel, job }) {
  const [confirmed, setConfirmed] = useState(false);

  if (job) {
    return (
      <div className="setup-card" role="status">
        <div className="job-bar"><span className="job-text">{job.stageText}</span><button onClick={onCancel}>停止</button></div>
        <p className="setup-note">生成后会逐题复核数学正确性，未全部通过的题目会触发一次补生成；仍失败则整组失败。</p>
      </div>
    );
  }

  return (
    <div className="setup-card">
      <h3>训练配置</h3>
      <p className="setup-note">知识点：{selectedKpNames.join('、')}</p>
      <div className="setup-row">
        <span className="setup-label">题量</span>
        <div className="range-chips" role="group" aria-label="题量">
          {[3, 5].map((n) => (
            <button key={n} className={`chip ${count === n ? 'chip-active' : ''}`} onClick={() => onCountChange(n)}>{n} 题</button>
          ))}
        </div>
      </div>
      <div className="setup-row">
        <span className="setup-label">难度</span>
        <div className="range-chips" role="group" aria-label="难度">
          {['basic', 'standard', 'challenge'].map((d) => (
            <button key={d} className={`chip ${difficulty === d ? 'chip-active' : ''}`} onClick={() => onDifficultyChange(d)}>{DIFFICULTY_LABELS[d]}</button>
          ))}
        </div>
      </div>
      <p className="setup-note">难度描述复杂程度（步骤与推理要求），基础默认 3 题；题干不依赖图片。</p>
      <div className="setup-actions">
        <button onClick={onCancel}>取消</button>
        <button className="primary" disabled={!confirmed} onClick={onStart}>开始生成（约需 1～2 分钟）</button>
        <label className="confirm-check">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          我知道本次会真实调用模型生成题目
        </label>
      </div>
    </div>
  );
}
