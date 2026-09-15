// Small arithmetic grammar shared with the server. No JavaScript execution or object access.
const functions = { sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, log: Math.log, min: Math.min, max: Math.max };
function calculate(source, scope = {}, syntaxOnly = false) {
  if (typeof source !== 'string' || source.length > 240) throw new Error('公式过长或格式错误');
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|[()+\-*/^,]/gi) || [];
  if (tokens.join('') !== source.replace(/\s/g, '') || tokens.length > 120) throw new Error('公式包含不支持的字符');
  let i = 0;
  function expr(min = 0) {
    const t = tokens[i++];
    let value;
    if (t === '+' || t === '-') value = (t === '-' ? -1 : 1) * expr(3);
    else if (t === '(') { value = expr(); if (tokens[i++] !== ')') throw new Error('括号不匹配'); }
    else if (/^(?:\d|\.)/.test(t || '')) value = Number(t);
    else if (Object.hasOwn(functions, t) && tokens[i] === '(') {
      i++; const args = [expr()];
      while (tokens[i] === ',') { i++; args.push(expr()); }
      if (tokens[i++] !== ')' || args.length > 4) throw new Error('函数参数错误');
      value = functions[t](...args);
    } else if (t === 'pi') value = Math.PI;
    else if (t === 'e') value = Math.E;
    else if (Object.hasOwn(scope, t)) value = scope[t];
    else throw new Error(`未知变量：${t || ''}`);
    while (i < tokens.length) {
      const op = tokens[i], prec = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 }[op];
      if (!prec || prec < min) break;
      i++; const right = expr(op === '^' ? prec : prec + 1);
      value = op === '+' ? value + right : op === '-' ? value - right : op === '*' ? value * right : op === '/' ? value / right : value ** right;
    }
    if (!syntaxOnly && (!Number.isFinite(value) || Math.abs(value) > 1e8)) throw new Error('当前参数下公式无有效数值');
    return value;
  }
  const result = expr();
  if (i !== tokens.length) throw new Error('公式不完整');
  return result;
}
const numericPath = /^(points\.\d+\.[xyz]|planes\.\d+\.(radius|point\.[012]|normal\.[012]|bounds\.[01]\.[01])|functions\.\d+\.(param[UV]\.[12]|[xyz]Range\.[01]))$/;
const formulaPath = /^(functions\.\d+\.(expr|exprU|exprV|exprW)|planes\.\d+\.(equation|boundary)|surfaceEquation)$/;
function target(data, path) {
  const parts = path.split('.'); let node = data;
  for (const key of parts.slice(0, -1)) {
    if (!node || !Object.hasOwn(node, key)) throw new Error('联动目标不存在');
    node = node[key];
  }
  const key = parts.at(-1);
  if (!node || !Object.hasOwn(node, key)) throw new Error('联动字段不存在');
  return [node, key];
}
function prepareScene(data) {
  const spec = data?.interaction;
  if (!spec) return null;
  if (spec.version !== 1 || !Array.isArray(spec.parameters) || !spec.parameters.length || spec.parameters.length > 3 || !Array.isArray(spec.bindings) || !spec.bindings.length || spec.bindings.length > 80) throw new Error('交互数据格式错误');
  const names = new Set(['x', 'y', 'z', 'u', 'v', 'pi', 'e', ...Object.keys(functions)]);
  for (const p of spec.parameters) {
    if (p.unit != null && typeof p.unit !== 'string') throw new Error('参数单位格式错误');
    if (!/^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(p.id) || names.has(p.id) || typeof p.label !== 'string' || !p.label.trim() || ![p.min,p.max,p.initial,p.step].every(Number.isFinite) || p.min >= p.max || p.initial < p.min || p.initial > p.max || p.step <= 0 || p.step > p.max-p.min || Math.max(Math.abs(p.min),Math.abs(p.max)) > 1e5) throw new Error('参数名称或范围无效');
    names.add(p.id);
  }
  if (spec.metrics && (!Array.isArray(spec.metrics) || spec.metrics.length > 6)) throw new Error('数值指标过多');
  for (const m of spec.metrics || []) if (typeof m.label !== 'string' || (m.unit != null && typeof m.unit !== 'string')) throw new Error('指标名称或单位格式错误');
  const paths = new Set();
  for (const b of spec.bindings) {
    if (paths.has(b.path) || !(numericPath.test(b.path) || formulaPath.test(b.path))) throw new Error('不支持的联动字段');
    paths.add(b.path); target(data,b.path);
    if (numericPath.test(b.path) ? typeof b.expr !== 'string' : typeof b.template !== 'string' || b.template.length > 500 || !b.template.includes('{{')) throw new Error('联动公式缺失');
  }
  const model = { data, spec, initial: Object.fromEntries(spec.parameters.map(p => [p.id,p.initial])) };
  // Probe the full one-dimensional range and all multi-parameter corners.
  evaluateScene(model, model.initial);
  for (const p of spec.parameters) for (let i=0;i<=20;i++) evaluateScene(model,{...model.initial,[p.id]:p.min+(p.max-p.min)*i/20});
  for(let mask=0;mask<2**spec.parameters.length;mask++) evaluateScene(model,Object.fromEntries(spec.parameters.map((p,i)=>[p.id,mask & (1<<i)?p.max:p.min])));
  return model;
}
function evaluateScene(model, values) {
  const scope = {};
  for (const p of model.spec.parameters) {
    const value = values[p.id] ?? p.initial;
    if (!Number.isFinite(value) || value < p.min || value > p.max) throw new Error('参数超出范围');
    scope[p.id] = value;
  }
  const data = JSON.parse(JSON.stringify(model.data)); delete data.interaction;
  for (const b of model.spec.bindings) {
    if (b.path.startsWith('planes.')) data.planes[Number(b.path.split('.')[1])].interactive = true;
    const [node,key] = target(data,b.path);
    if (numericPath.test(b.path)) {
      const value = calculate(b.expr,scope);
      if (key === 'radius' && value < 0) throw new Error('半径不能为负数');
      node[key] = value;
    } else {
      node[key] = b.template.replace(/\{\{([^{}]+)\}\}/g,(_,expr)=>`(${calculate(expr,scope)})`);
      if (/[{}]/.test(node[key])) throw new Error('公式占位符错误');
      const sides = node[key].split('=');
      if(sides.length>2) throw new Error('公式等号过多');
      for(const side of sides) calculate(side,{x:1,y:1,z:1,u:1,v:1},true);
    }
  }
  for (const plane of data.planes || []) if (plane.normal && Math.hypot(...plane.normal) === 0) throw new Error('平面法向量不能为零');
  return { data, metrics: (model.spec.metrics || []).map(m=>({label:m.label,unit:m.unit || '',value:calculate(m.expr,scope)})) };
}
export { calculate, prepareScene, evaluateScene };
