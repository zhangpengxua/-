import React, { useMemo, useState } from 'react';
import Interactive3DViewer from './Interactive3DViewer';
import FunctionPlot from './FunctionPlot';
import { prepareScene, evaluateScene } from '../utils/parameterScene.mjs';

export default function ParameterizedScene({ step, width, height, onAsk }) {
  const prepared = useMemo(() => {
    try { const model=prepareScene(step.drawingData); return { model, error: !model && step.drawingData?.interactionError }; }
    catch (e) { console.warn('[parameter-scene]', e.message); return { error: e.message }; }
  }, [step.drawingData]);
  const model = prepared.model;
  const [values,setValues] = useState(null);
  const [error,setError] = useState('');
  const current = values && values.model === model ? values.current : model?.initial;
  const rendered = useMemo(()=> model ? evaluateScene(model,current) : {data:step.drawingData,metrics:[]},[model,current,step.drawingData]);
  const change = (p,value) => {
    const next = {...current,[p.id]:value};
    try { evaluateScene(model,next); setValues({model,current:next}); setError(''); }
    catch(e) { setError('这个位置暂时无法计算，已保留上一个有效位置。'); }
  };
  const ask = text => onAsk?.(model ? `${text}\n当前图形探索参数：${model.spec.parameters.map(p=>`${p.label}（${p.id}）=${current[p.id]}${p.unit || ''}`).join('，')}。${rendered.metrics.map(m=>`${m.label}=${m.value.toFixed(3)}${m.unit}`).join('，')}。请结合这些探索值解释，与原题条件区分。` : text);
  const is2D = step.is2DPlot || (step.drawingData?.dimension === '2D' && step.drawingData?.functions?.length > 0) || ['MATH_STATIC_EQUATION','MATH_STATIC_2D_FUNCTION'].includes(step.imageType);
  return <div className="parameter-scene">
    <div className="parameter-viewport">{is2D ? <FunctionPlot drawingData={rendered.data} width={width} height={Math.max(200,height-(model?175:0))} onAsk={ask}/> : <Interactive3DViewer drawingData={rendered.data} description={step.description} imageType={step.imageType} onAsk={ask}/>}</div>
    {model && <section className="parameter-controls" aria-label="图形参数探索">
      {model.spec.parameters.map(p=><label className="parameter-row" key={p.id}><span>{p.label}</span><input aria-label={p.label} type="range" min={p.min} max={p.max} step={p.step} value={current[p.id]} onChange={e=>change(p,Number(e.target.value))}/><output>{Number(current[p.id].toFixed(3))}{p.unit || ''}</output></label>)}
      <div className="parameter-metrics">{rendered.metrics.map((m,i)=><span key={i}>{m.label} <strong>{Number(m.value.toFixed(3))}</strong> {m.unit}</span>)}</div>
      <div className="parameter-actions"><small>探索中 · 原题未修改</small><button onClick={()=>{setValues(null);setError('');}}>重置参数</button><button onClick={()=>ask('请解释当前图形中的变化及其数学关系。')}>按当前状态追问</button></div>
    </section>}
    {(prepared.error || error) && <div role="status" className="parameter-warning">{error || '交互关系校验未通过，当前展示原始图形。'}</div>}
  </div>;
}
