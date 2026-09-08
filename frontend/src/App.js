import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import LearningWorkspace from './components/LearningWorkspace';
const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
export default function App() {
 const [conversations,setConversations]=useState([]),[current,setCurrent]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[ocr,setOcr]=useState(null);
 const currentRef=useRef(null),request=useRef(null);
 const update=c=>{currentRef.current=c;setCurrent(c);};
 const refresh=()=>axios.get(`${API}/conversations`,{timeout:5000}).then(r=>setConversations(r.data)).catch(()=>{});
 useEffect(()=>{axios.get(`${API}/conversations`,{timeout:5000}).then(r=>setConversations(r.data)).catch(()=>setError('暂时无法连接后端。你仍可操作交互示例。'));return()=>request.current?.abort();},[]);
 async function create(){try{const {data}=await axios.post(`${API}/conversations`);update(data);setOcr(null);setError('');refresh();return data;}catch{setError('无法创建题目，请检查后端是否启动。');return null;}}
 async function select(id){try{const {data}=await axios.get(`${API}/conversations/${id}`);update(data);setOcr(null);setError('');}catch{setError('题目读取失败，请重试。');}}
 async function remove(id){try{await axios.delete(`${API}/conversations/${id}`);if(currentRef.current?._id===id)update(null);refresh();}catch{setError('删除失败，请重试。');}}
 async function send(text,image,ocrText){
  if(busy)return;setBusy(true);setError('');const controller=new AbortController();request.current=controller;
  try{
   if(text==='__OCR_REQUEST__'){const r=await axios.post(`${API}/ocr`,{imageBase64:image?.split(',')[1]},{signal:controller.signal,timeout:60000});setOcr(r.data.text||'[未识别到文字，请手动输入]');return;}
   const follow=text.startsWith('针对题目追问：');
   let conv=follow || !currentRef.current?.messages?.length ? currentRef.current : null;
   if(!conv){const {data}=await axios.post(`${API}/conversations`,{},{signal:controller.signal});conv=data;}
   const content=ocrText?`${text}\n图片识别文字：${ocrText}`:text;
   // Show the submitted problem while retaining the original answer during follow-up.
   update({...conv,messages:[...(conv.messages||[]),{role:'user',content}]});
   const {data}=await axios.post(`${API}/conversations/${conv._id}/message`,{content,imageBase64:image?.split(',')[1]||null},{signal:controller.signal,timeout:240000});
   if(data.aborted)return;
   const answer=data.finalAnswer||'';
   if(answer.includes('服务暂时不可用')||answer.includes('服务调用失败')){setError('模型调用失败，请检查中转地址、模型配置或账户余额。');update(conv);return;}
   update(data.conversation);setOcr(null);refresh();
  }catch(e){if(!axios.isCancel(e))setError(e.response?.data?.error||'请求失败，请检查后端和模型连接后重试。');}
  finally{setBusy(false);request.current=null;}
 }
 async function stop(){request.current?.abort();const id=currentRef.current?._id;if(id)axios.post(`${API}/conversations/${id}/abort`).catch(()=>{});}
 return <LearningWorkspace conversations={conversations} currentConversation={current} onSelect={select} onNew={create} onDelete={remove} onSend={send} isLoading={busy} onStop={stop} ocrResult={ocr} error={error}/>;
}
