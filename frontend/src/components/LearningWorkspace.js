import React, { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import ParameterizedScene from './ParameterizedScene';
import InputArea from './InputArea';
import MathMarkdown from './MathMarkdown';
import HistoryWorkspace from './history/HistoryWorkspace';
import { hasStepVisualization } from '../utils/stepVisualization';
import 'katex/dist/katex.min.css';
import '../workspace.css';
import '../history.css';

const example = '圆锥底面半径 R = 3，高 H = 6。截平面与底面平行，距底面的高度为 h。求截面面积与 h 的关系。';
const demoSteps = [
 {title:'识别已知条件',description:'底面半径 $R=3$，高 $H=6$。截面高度 $h$ 从底面向上量取。'},
 {title:'用相似关系求截面半径',description:'截面到顶点的距离为 $H-h$。由相似三角形可得：\n\n$$\\frac{r}{R}=\\frac{H-h}{H}$$\n\n$$r=\\frac{3(6-h)}{6}$$'},
 {title:'计算截面面积',description:'将半径代入圆面积公式：\n\n$$S=\\pi r^2=\\frac{\\pi}{4}(6-h)^2$$\n\n拖动滑块，观察截面面积随高度变化。'},
 {title:'验证你的理解',description:'先预测：截面高度从 $h=3$ 变为 $h=4$，面积变为原来的多少？\n\n调整右侧高度验证，再用相似关系解释。'}
];
const Md = MathMarkdown;
export function Icon({name}) { const paths={book:'M3 4h6l3 2 3-2h6v15h-6l-3 2-3-2H3z M12 6v15',history:'M3 4v7h7 M3 11a9 9 0 1 1 2 7 M12 7v5l3 2',plus:'M12 5v14 M5 12h14',reset:'M3 4v7h7 M3 11a9 9 0 1 1 2 7',expand:'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5',send:'m3 3 18 9-18 9 4-9z M7 12h14',edit:'m15 4 5 5 M4 20l4-1L21 6l-5-5L3 14z',close:'m6 6 12 12 M18 6 6 18'};return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.book}/></svg>; }
function Cone({height,reset,onAsk,highlight}) {
 const r=(6-height)/2; const ring=(radius,y)=>Array.from({length:97},(_,i)=>[radius*Math.cos(i*Math.PI/48),y,radius*Math.sin(i*Math.PI/48)]);
 return <Canvas key={reset} camera={{position:[8,6.2,10],fov:40}}><color attach="background" args={['#f5f8f8']}/><ambientLight intensity={1.8}/><directionalLight position={[5,10,8]} intensity={2}/><gridHelper args={[24,24,'#dce6e7','#e8eeee']} position={[0,-0.02,0]}/>
 <mesh position={[0,3,0]}><coneGeometry args={[3,6,96,1,true]}/><meshStandardMaterial color="#58a8ae" transparent opacity={0.27} side={2} depthWrite={false}/></mesh>
 <Line points={ring(3,0)} color="#25818b" lineWidth={1.5}/><Line points={[[0,0,0],[0,6,0]]} color="#25818b" dashed dashSize={0.14} gapSize={0.12}/>
 <mesh position={[0,height,0]} rotation={[-Math.PI/2,0,0]} onClick={e=>{e.stopPropagation();onAsk();}}><circleGeometry args={[Math.max(r,0.001),96]}/><meshBasicMaterial color={highlight?'#ffbd3a':'#f8ce67'} transparent opacity={0.75} side={2}/></mesh>
 <Line points={ring(r,height)} color="#e5a325" lineWidth={2}/><Line points={[[0,height,0],[r,height,0]]} color="#bb8318" lineWidth={1.5}/>
 <Html position={[0,6.25,0]} center><span className="geometry-label">顶点 (0, 0, 6)</span></Html><Html position={[3.3,0,0]}><span className="geometry-label">R = 3</span></Html><Html position={[-3,3,0]} center><span className="geometry-label">H = 6</span></Html>
 <Html position={[r+0.3,height,0]}><button className="slice-label" onClick={onAsk}>截面 · 问问 AI<br/><small>r = {r.toFixed(2)}</small></button></Html><OrbitControls target={[0,2.8,0]} minDistance={7} maxDistance={24} enableDamping/></Canvas>;
}
export default function LearningWorkspace({conversations,currentConversation,onSelect,onNew,onDelete,onSend,isLoading,thinkingState,onStop,ocrResult,error}) {
 const [demo,setDemo]=useState(true),[active,setActive]=useState(1),[height,setHeight]=useState(3),[reset,setReset]=useState(0),[wide,setWide]=useState(false),[highlight,setHighlight]=useState(false);
 const [activeView,setActiveView]=useState('study'),[modal,setModal]=useState(false),[question,setQuestion]=useState(''),[split,setSplit]=useState(34),[size,setSize]=useState({width:600,height:450});
 const inputRef=useRef(),sceneRef=useRef(),layoutRef=useRef();
 const messages=currentConversation?.messages || [];
 const rootAnswer=messages.find(m=>m.role==='assistant');
 const steps=demo?demoSteps:(rootAnswer?.stepResults?.length?rootAnswer.stepResults:rootAnswer?[{description:rootAnswer.content}]:[]);
 const step=steps[Math.min(active,Math.max(0,steps.length-1))];
 const showScene=demo || hasStepVisualization(step);
 const problem=demo?example:messages.find(m=>m.role==='user')?.content || '输入题目，开始一次新的探索。';
 const followMessages=demo ? messages : messages.slice(rootAnswer?messages.indexOf(rootAnswer)+1:messages.length);
 useEffect(()=>{if(!showScene || !sceneRef.current)return;const observer=new ResizeObserver(([entry])=>setSize({width:Math.floor(entry.contentRect.width),height:Math.floor(entry.contentRect.height)}));observer.observe(sceneRef.current);return()=>observer.disconnect();},[showScene]);
 useEffect(()=>{if(!showScene)setWide(false);},[showScene]);
 useEffect(()=>{if (!demo) setActive(0);},[currentConversation?._id, demo]);
 useEffect(()=>{if(!modal)return;const old=document.activeElement;const box=document.querySelector('.problem-modal');const items=()=>Array.from(box.querySelectorAll('button:not(:disabled),textarea,input:not(:disabled)'));items()[0]?.focus();const key=e=>{if(e.key==='Escape')setModal(false);if(e.key==='Tab'){const list=items(),first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};box.addEventListener('keydown',key);return()=>{box.removeEventListener('keydown',key);old?.focus();};},[modal]);
 const ask=()=>{setActiveView('study');setWide(false);setQuestion('为什么截面半径会这样变化？');setHighlight(true);inputRef.current?.focus();};
 async function newProblem(){const created = await onNew(); if (!created) return; setDemo(false);setActive(0);setActiveView('study');setModal(true);}
 function sendFollow(e){e.preventDefault();if(!question.trim()||isLoading)return;onSend(`针对题目追问：${problem}\n当前步骤：${step?.description || ''}\n${demo?`当前截面高度 h=${height}，截面半径 r=${(6-height)/2}。`:''}\n学生问题：${question}`,null,null,{kind:'followup',source:demo?'demo':'user_problem',studentQuestion:question,activeStepId:demo?null:(step?.id ?? null)});setQuestion('');}
 const askAboutScene=(text)=>{setWide(false);setQuestion(text);requestAnimationFrame(()=>{inputRef.current?.focus();inputRef.current?.scrollIntoView({block:'nearest',behavior:'smooth'});});};
 const resizeMove=e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const rect=layoutRef.current.getBoundingClientRect();setSplit(Math.max(28,Math.min(52,(e.clientX-rect.left)/rect.width*100)));};
 async function openFromHistory(id){const ok=await onSelect(id);if(ok){setDemo(false);setActive(0);setActiveView('study');}return ok;}
 return <div className="learning-app"><header className="topbar"><div className="brand"><span className="brand-mark">∧</span>交互学习</div><span className="breadcrumb">→ <span>{activeView==='history'?'学习历史':'学习工作台'}</span>{activeView==='study'&&` / ${demo?'圆锥截面':'我的题目'}`}</span><button disabled={isLoading} onClick={newProblem}><Icon name="plus"/>新建题目</button><span className="avatar">我</span></header>
 <nav className="rail" aria-label="主导航"><button className={activeView==='study'?'selected':''} onClick={()=>setActiveView('study')}><Icon name="book"/>学习</button><button className={activeView==='history'?'selected':''} onClick={()=>setActiveView('history')}><Icon name="history"/>历史</button><button className="rail-demo" disabled={isLoading} onClick={async()=>{await onNew();setDemo(true);setActive(1);setActiveView('study');}}>示例</button></nav>
 <main className="workspace">
 <div className={`study-view${activeView==='history'?' view-hidden':''}`}>
 <section className="problem-bar"><div><div className="problem-title">{demo?'圆锥的截面面积如何变化？':'一起理解这道题'}{demo&&<span className="badge">交互示例</span>}</div><p title={problem}>{problem}</p></div><button disabled={isLoading} onClick={()=>setModal(true)}><Icon name="edit"/>修改条件</button></section>
 {(error||thinkingState?.phase==='error')&&<div role="alert" className="notice">{error || thinkingState.message}</div>}
 <div className={`panels ${showScene?(wide?'scene-wide':''):'no-scene'}`} ref={layoutRef} style={{'--study-width':`${split}%`}}><section className="study-panel"><div className="panel-heading"><h2>理解这道题</h2><span className="progress">{String(steps.length?active+1:0).padStart(2,'0')} <em>/ {String(steps.length).padStart(2,'0')}</em></span></div>
 <div className="study-scroll"><div className="steps">{steps.map((item,index)=><article className={`step ${active===index?'active':''}`} key={index}><button className="step-heading" aria-expanded={active===index} onClick={()=>setActive(index)}><span className="step-number">{index<active?'✓':String(index+1).padStart(2,'0')}</span><strong>{item.title||`步骤 ${index+1}`}</strong><span>{active===index?'⌃':'›'}</span></button>{active===index&&<div className="step-body"><Md>{item.description}</Md>{(demo||hasStepVisualization(item))&&<span className="sync-chip">↔ 与右侧场景同步</span>}</div>}</article>)}</div>
 {!steps.length&&<div className="empty"><h3>{isLoading?'正在分析题目…':'准备开始'}</h3><p>{isLoading?'解题完成后，步骤和图形会出现在这里。':'点击新建题目，输入文字或上传图片。'}</p></div>}
 <section className="follow-up"><h3>追问 · 第 {active+1} 步</h3>{demo&&<><div className="bubble user">为什么要用 H − h？</div><div className="bubble"><small>示例讲解</small><p>h 从底面量起。相似三角形的高度，需要从顶点量到截面。</p><button className="text-button" onClick={()=>setHighlight(!highlight)}>{highlight?'取消高亮':'在图中高亮'}</button></div></>}{followMessages.map((m,i)=><div key={i} className={`bubble ${m.role==='user'?'user':''}`}><Md>{m.role==='user'?(m.metadata?.studentQuestion||m.content.split('学生问题：').at(-1)):m.content}</Md></div>)}</section></div>
 <form className="question-form" onSubmit={sendFollow}><textarea ref={inputRef} aria-label="针对当前步骤追问" placeholder="针对这一步继续提问…" value={question} onChange={e=>setQuestion(e.target.value)} rows={2}/><button disabled={isLoading||!question.trim()} className="send-button" aria-label="发送追问"><Icon name="send"/></button></form>
 {isLoading&&<div className="busy" role="status">{thinkingState?.message||'正在处理，请稍候…'}<button onClick={onStop}>停止</button></div>}<footer className="step-nav"><button disabled={!steps.length||active===0} onClick={()=>setActive(active-1)}>‹ 上一步</button><button className="primary" disabled={active>=steps.length-1} onClick={()=>setActive(active+1)}>下一步 ›</button></footer></section>
 {showScene&&<><div className="divider" role="separator" aria-label="调整步骤区宽度" aria-orientation="vertical" aria-valuenow={split} aria-valuemin={28} aria-valuemax={52} tabIndex={0} onPointerDown={e=>e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={resizeMove} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();setSplit(v=>Math.max(28,Math.min(52,v+(e.key==='ArrowLeft'?-2:2))));}}}/>
 <section className="scene-column"><div className="scene-card"><div className="panel-heading"><h2>交互场景 <span className="badge">{demo?'3D':'随步骤联动'}</span></h2><div className="scene-actions"><button onClick={()=>setReset(reset+1)}><Icon name="reset"/>恢复视图</button><button aria-label={wide?'退出放大':'放大场景'} onClick={()=>setWide(!wide)}><Icon name="expand"/></button></div></div>
 <div className="scene-content" ref={sceneRef}>{demo?<Cone height={height} reset={reset} onAsk={ask} highlight={highlight}/>:step?.drawingData?<ParameterizedScene key={`${currentConversation?._id}-${active}-${reset}`} step={step} width={Math.max(200,size.width)} height={Math.max(200,size.height)} onAsk={askAboutScene}/>:<div className="scene-empty"><Icon name="book"/><h3>专注当前推理</h3><p>这一步暂无可视化数据。<br/>阅读左侧讲解，或针对不理解的地方追问。</p></div>}</div>{demo&&<div className="scene-hint">鼠标拖动旋转 · 滚轮缩放 · 点击截面追问</div>}</div>
 {demo?<div className="controls"><label htmlFor="height">探索截面高度</label><div className="slider-row"><span>0</span><input id="height" type="range" min="0" max="6" step="0.05" value={height} onChange={e=>setHeight(Number(e.target.value))}/><span>6</span><label className="number-field">h = <input aria-label="截面高度数值" type="number" min="0" max="6" step="0.05" value={height} onChange={e=>{if(e.target.value!=='')setHeight(Math.max(0,Math.min(6,Number(e.target.value))));}}/></label></div><div className="control-bottom"><div className="metric">截面半径 <strong>{((6-height)/2).toFixed(2)}</strong></div><div className="metric">截面面积 <strong>{(((6-height)/2)**2).toFixed(2)}π</strong></div><span className="explore-status">● 探索中 · 原题未修改</span><button onClick={()=>{setHeight(3);setHighlight(false);}}>重置</button><button className="primary" disabled={isLoading} onClick={()=>{onSend(`${example}\n请计算 h=${height} 时的截面半径和面积，并解释原因。`,null,null,{kind:'question',source:'user_problem'});setDemo(false);setActive(0);}}>按当前条件解题</button></div></div>:<div className="controls context-footer"><span>围绕当前步骤，继续探索与追问。</span><button onClick={()=>{setQuestion('请更详细地解释这一步。');inputRef.current?.focus();}}>这一步为什么？</button></div>}
 </section></>} </div>
 </div>
 {activeView==='history'&&<HistoryWorkspace currentId={currentConversation?._id||null} onOpenProblem={openFromHistory} onDeleteProblem={onDelete}/>}
 </main>
 {modal&&<div className="modal-backdrop"><section className="problem-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="panel-heading"><h2 id="modal-title">输入题目或修改条件</h2><button aria-label="关闭题目编辑" onClick={()=>setModal(false)}><Icon name="close"/></button></div><p>修改条件会创建新的解题过程。图片识别后，请先确认文字。</p><InputArea initialValue={demo?example:problem.startsWith('输入题目')?'':problem} onSendMessage={(...args)=>{onSend(...args);if(args[0]!=='__OCR_REQUEST__'){setDemo(false);setActive(0);setActiveView('study');setModal(false);}}} ocrResult={ocrResult} isLoading={isLoading} onStop={onStop}/></section></div>}
 </div>;
}
