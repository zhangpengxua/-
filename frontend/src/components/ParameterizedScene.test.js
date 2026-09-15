import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import ParameterizedScene from './ParameterizedScene';
jest.mock('./Interactive3DViewer',()=>({drawingData})=><div data-testid="radius">{drawingData.planes[0].radius}</div>);
jest.mock('./FunctionPlot',()=>()=> <div data-testid="plot"/>);
let root,container;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();delete global.IS_REACT_ACT_ENVIRONMENT;});
const step={drawingData:{planes:[{radius:1.5}],interaction:{version:1,parameters:[{id:'h',label:'截面高度',min:0,max:6,step:.05,initial:3}],bindings:[{path:'planes.0.radius',expr:'3*(1-h/6)'}],metrics:[{label:'截面面积',expr:'pi*(3*(1-h/6))^2'}]}}};
test('slider updates actual renderer data, metrics, followup and resets',()=>{
 const onAsk=jest.fn();act(()=>root.render(<ParameterizedScene step={step} onAsk={onAsk}/>));
 const slider=container.querySelector('input');
 act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,'6');slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(container.querySelector('[data-testid="radius"]').textContent).toBe('0');expect(container.querySelector('.parameter-metrics strong').textContent).toBe('0');
 act(()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='按当前状态追问').click());expect(onAsk.mock.calls[0][0]).toContain('h）=6');
 act(()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='重置参数').click());expect(container.querySelector('[data-testid="radius"]').textContent).toBe('1.5');
});
test('invalid interaction preserves the original static scene with an explanation',()=>{
 const broken=JSON.parse(JSON.stringify(step));broken.drawingData.interaction.bindings[0].expr='1/0';
 act(()=>root.render(<ParameterizedScene step={broken}/>));expect(container.querySelector('input')).toBeNull();expect(container.querySelector('[role="status"]').textContent).toContain('校验未通过');expect(container.querySelector('[data-testid="radius"]').textContent).toBe('1.5');
});
test('2D dynamic function uses the 2D renderer even when AI selects dynamic geometry',()=>{
 act(()=>root.render(<ParameterizedScene step={{imageType:'MATH_DYNAMIC_GEOMETRY',drawingData:{dimension:'2D',functions:[{expr:'x^2'}]}}}/>));
 expect(container.querySelector('[data-testid="plot"]')).not.toBeNull();
});
