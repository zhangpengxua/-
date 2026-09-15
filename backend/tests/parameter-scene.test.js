const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate,prepareScene,evaluateScene}=require('../../frontend/src/utils/parameterScene.mjs');
const cone=()=>({planes:[{type:'disk',point:[0,0,3],normal:[0,0,1],radius:1.5,equation:'z=3',boundary:'x^2+y^2=2.25'}],interaction:{version:1,parameters:[{id:'h',label:'截面高度',min:0,max:6,step:.05,initial:3}],bindings:[{path:'planes.0.point.2',expr:'h'},{path:'planes.0.radius',expr:'3*(1-h/6)'},{path:'planes.0.equation',template:'z={{h}}'},{path:'planes.0.boundary',template:'x^2+y^2={{(3*(1-h/6))^2}}'}],metrics:[{label:'面积',expr:'pi*(3*(1-h/6))^2'}]}});
test('cone section follows similarity and degenerates to zero at apex without mutating source',()=>{
 const data=cone(), model=prepareScene(data);
 for(const h of [0,1.25,3,4,6]){const r=evaluateScene(model,{h});assert.equal(r.data.planes[0].point[2],h);assert.equal(r.data.planes[0].radius,3*(1-h/6));assert.ok(Math.abs(r.metrics[0].value-Math.PI*(3*(1-h/6))**2)<1e-9);}
 assert.equal(data.planes[0].radius,1.5);
});
test('moving point and function coefficient use the same parameter evaluator',()=>{
 const data={points:[{x:0,y:0,z:0}],functions:[{expr:'x^2'}],interaction:{version:1,parameters:[{id:'a',label:'系数',min:0,max:4,step:.1,initial:1}],bindings:[{path:'points.0.x',expr:'a'},{path:'points.0.y',expr:'a^2'},{path:'functions.0.expr',template:'{{a}}*x^2'}]}};
 const r=evaluateScene(prepareScene(data),{a:2});assert.equal(r.data.points[0].y,4);assert.equal(r.data.functions[0].expr,'(2)*x^2');
});
test('rejects code, unknown names, invalid ranges, dangerous paths and singularities',()=>{
 for(const expr of ['process.exit()','import("x")','a=3','sqrt(-1)','1/0','unknown','2;3'])assert.throws(()=>calculate(expr));
 const data=cone();data.interaction.bindings[0].path='__proto__.x';assert.throws(()=>prepareScene(data));
 const bad=cone();bad.interaction.bindings[0].expr='1/(h-3)';assert.throws(()=>prepareScene(bad));
 const range=cone();range.interaction.parameters[0].step=0;assert.throws(()=>prepareScene(range));
 assert.throws(()=>evaluateScene(prepareScene(cone()),{h:7}));
 assert.equal(calculate('-2^2+max(3,5)*2'),6);
});
test('LLM retries invalid interaction rather than passing it as working controls',async()=>{
 const LLM=require('../utils/llmService');const original=LLM.callLLMStructured;let calls=0;
 const bad=cone();bad.interaction.bindings[0].expr='bad';
 LLM.callLLMStructured=async()=>JSON.stringify({steps:[{id:1,description:'截面',needImage:true,imageType:'MATH_STATIC_EQUATION',drawingData:++calls===1?bad:cone()}]});
 try{const result=await LLM.firstLayerLLM('','截面移动');assert.equal(calls,2);assert.ok(prepareScene(result.steps[0].drawingData));}finally{LLM.callLLMStructured=original;}
});
