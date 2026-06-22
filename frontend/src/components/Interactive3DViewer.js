import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line, Text } from '@react-three/drei';
import * as THREE from 'three';
import { create, all } from 'mathjs';
import { latexToMathJS } from '../utils/latexToMathJS';

const math = create(all, {});

// ============ 数值计算工具 ============

/** 编译数学表达式为可调用函数，自动处理 LaTeX */
function compileExpr(expr) {
  try {
    let cleanExpr = latexToMathJS(String(expr));
    // 含等号的方程（如 x^2+y^2=4）须重排为 f(x,y,z)=0 形式，否则 mathjs 无法解析
    if (cleanExpr.includes('=')) {
      const rearranged = rearrangeToImplicitForm(cleanExpr);
      if (rearranged) cleanExpr = rearranged;
    }
    const parsed = math.parse(cleanExpr);
    const compiled = parsed.compile();
    return (scope) => compiled.evaluate(scope);
  } catch (e) {
    console.warn('[compileExpr] 编译失败:', expr, e.message);
    return null;
  }
}

/** 从描述或 drawingData 提取曲面方程 */
function extractSurfaceInfo(description, drawingData, imageType) {
  const info = { type: 'unknown', equation: '', xRange: [-3, 3], yRange: [-3, 3], zRange: [-3, 3], resolution: 40 };

  // 1. 如果 drawingData 有 functions，提取第一个函数作为主曲面
  if (drawingData?.functions?.length > 0) {
    const f = drawingData.functions[0];
    info.equation = f.expr || f.equation || '';
    info.type = f.type || (imageType === 'MATH_STATIC_IMPLICIT' ? 'implicit' : 'explicit');
    if (f.xRange) info.xRange = f.xRange;
    if (f.yRange) info.yRange = f.yRange;
    if (f.zRange) info.zRange = f.zRange;
    if (f.resolution) info.resolution = f.resolution;
    if (f.color) info.color = f.color;
    if (f.opacity != null) info.opacity = f.opacity;
  }

  // 2. 如果 drawingData 有 surfaceEquation
  if (drawingData?.surfaceEquation) {
    info.equation = drawingData.surfaceEquation;
  }
  if (drawingData?.surfaceType) {
    info.type = drawingData.surfaceType;
  }

  // 3. 从 description 中提取
  if (!info.equation) {
    // 匹配 LaTeX 内联公式 $$...$$ 或 $...$
    const latexEq = description?.match(/\$\$([^$]+)\$\$|\$([^$]+)\$/);
    if (latexEq) {
      info.equation = (latexEq[1] || latexEq[2] || '').trim();
    }
  }

  // 4. 范围提取
  if (drawingData?.xRange) info.xRange = drawingData.xRange;
  if (drawingData?.yRange) info.yRange = drawingData.yRange;
  if (drawingData?.zRange) info.zRange = drawingData.zRange;
  if (drawingData?.resolution) info.resolution = drawingData.resolution;

  // 5. 类型推断
  if (imageType === 'MATH_STATIC_SURFACE') info.type = info.type || 'explicit';
  else if (imageType === 'MATH_STATIC_IMPLICIT') info.type = info.type || 'implicit';

  // 6. 参数曲面数据（从 drawingData.functions）
  if (drawingData?.functions?.length > 0) {
    for (const f of drawingData.functions) {
      const p = getParametricExprs(f);
      if (p.exprU && p.exprV) {
        info.type = 'parametric';
        info.exprU = p.exprU;
        info.exprV = p.exprV;
        info.exprW = p.exprW;
        info.paramU = p.paramU || ['u', 0, Math.PI * 2];
        info.paramV = p.paramV || ['v', 0, 1];
        info.color = f.color || '#4d96ff';
        info.opacity = f.opacity != null ? f.opacity : 0.7;
        break;
      }
    }
  }

  return info;
}

/** 检测是否为球面方程: x² + y² + z² = r² */
function detectSphere(eq) {
  const clean = eq.replace(/\s/g, '');
  // x^2 + y^2 + z^2 = r^2
  const sphereMatch = clean.match(/^x(?:\*\*|\^)2\s*\+\s*y(?:\*\*|\^)2\s*\+\s*z(?:\*\*|\^)2\s*=\s*(\d+(?:\.\d+)?)$/);
  if (sphereMatch) {
    const r2 = parseFloat(sphereMatch[1]);
    return { r: Math.sqrt(r2) };
  }
  // x^2 + y^2 + z^2 - r^2 = 0
  const sphereMatch2 = clean.match(/^x(?:\*\*|\^)2\s*\+\s*y(?:\*\*|\^)2\s*\+\s*z(?:\*\*|\^)2\s*[-]\s*(\d+(?:\.\d+)?)\s*=\s*0$/);
  if (sphereMatch2) {
    const r2 = parseFloat(sphereMatch2[1]);
    return { r: Math.sqrt(r2) };
  }
  return null;
}

/** 检测圆柱面：x^2 + y^2 = r^2（沿z轴）等 */
function detectCylinder(eq) {
  const clean = eq.replace(/\s/g, '');
  // x^2 + y^2 = r^2 (z-axis cylinder)
  let m = clean.match(/^x(?:\*\*|\^)2\s*\+\s*y(?:\*\*|\^)2\s*=\s*(\d+(?:\.\d+)?)$/);
  if (m) return { axis: 'z', radius: Math.sqrt(parseFloat(m[1])) };
  m = clean.match(/^x(?:\*\*|\^)2\s*\+\s*y(?:\*\*|\^)2\s*[-]\s*(\d+(?:\.\d+)?)\s*=\s*0$/);
  if (m) return { axis: 'z', radius: Math.sqrt(parseFloat(m[1])) };

  // x^2 + z^2 = r^2 (y-axis cylinder)
  m = clean.match(/^x(?:\*\*|\^)2\s*\+\s*z(?:\*\*|\^)2\s*=\s*(\d+(?:\.\d+)?)$/);
  if (m) return { axis: 'y', radius: Math.sqrt(parseFloat(m[1])) };
  m = clean.match(/^x(?:\*\*|\^)2\s*\+\s*z(?:\*\*|\^)2\s*[-]\s*(\d+(?:\.\d+)?)\s*=\s*0$/);
  if (m) return { axis: 'y', radius: Math.sqrt(parseFloat(m[1])) };

  // y^2 + z^2 = r^2 (x-axis cylinder)
  m = clean.match(/^y(?:\*\*|\^)2\s*\+\s*z(?:\*\*|\^)2\s*=\s*(\d+(?:\.\d+)?)$/);
  if (m) return { axis: 'x', radius: Math.sqrt(parseFloat(m[1])) };
  m = clean.match(/^y(?:\*\*|\^)2\s*\+\s*z(?:\*\*|\^)2\s*[-]\s*(\d+(?:\.\d+)?)\s*=\s*0$/);
  if (m) return { axis: 'x', radius: Math.sqrt(parseFloat(m[1])) };

  return null;
}

/** 检测是否为平面方程: ax + by + cz = d, z = d, x = d 等 */
function detectPlane(eq) {
  const clean = eq.replace(/\s/g, '');

  // 1. z = d  （水平面）
  let m = clean.match(/^z\s*=\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { a: 0, b: 0, c: 1, d: parseFloat(m[1]) };

  // 2. x = d
  m = clean.match(/^x\s*=\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { a: 1, b: 0, c: 0, d: parseFloat(m[1]) };

  // 3. y = d
  m = clean.match(/^y\s*=\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { a: 0, b: 1, c: 0, d: parseFloat(m[1]) };

  // 4. ax + by + cz = d (完整三项，系数可能缺省)
  m = clean.match(/^([+-]?\d*\.?\d*?)x([+-]\d*\.?\d*?)y([+-]\d*\.?\d*?)z=(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const parseCoef = (s) => {
      if (s === '' || s === '+') return 1;
      if (s === '-') return -1;
      return parseFloat(s);
    };
    return { a: parseCoef(m[1]), b: parseCoef(m[2]), c: parseCoef(m[3]), d: parseFloat(m[4]) };
  }

  return null;
}

/** 解析圆盘边界方程 x^2+y^2=R */
function parseDiskRadius(eq) {
  if (!eq || typeof eq !== 'string') return null;
  const clean = eq.replace(/\s/g, '');
  const m = clean.match(/^x(?:\*\*|\^)2\+y(?:\*\*|\^)2=(-?\d+(?:\.\d+)?)$/);
  if (m) return Math.sqrt(parseFloat(m[1]));
  return null;
}

/** 从 equation 解析平面参数（flat / disk / implicit） */
function parsePlaneFromEquation(equation) {
  if (!equation || typeof equation !== 'string') return null;
  const clean = equation.replace(/\s/g, '');

  const diskR = parseDiskRadius(clean);
  if (diskR != null) {
    return { kind: 'disk', radius: diskR, normal: [0, 0, 1], point: [0, 0, 0] };
  }

  const flat = detectPlane(clean);
  if (flat) {
    const { a, b, c, d } = flat;
    let px = 0, py = 0, pz = 0;
    if (Math.abs(c) > 1e-10) pz = d / c;
    else if (Math.abs(b) > 1e-10) py = d / b;
    else if (Math.abs(a) > 1e-10) px = d / a;
    return { kind: 'flat', normal: [a, b, c], point: [px, py, pz] };
  }

  if (clean.includes('=')) {
    return { kind: 'implicit', equation };
  }
  return null;
}

/** 合并 plane 条目上的各种字段，得到可渲染数据 */
function resolvePlaneRenderData(pl, pointLookup, defSize) {
  let { normal, point, bounds, equation, radius, opacity, color } = pl;
  const xRange = pl.xRange || [-defSize, defSize];
  const yRange = pl.yRange || [-defSize, defSize];
  const zRange = pl.zRange || [-defSize, defSize];

  if ((!normal || !point) && pl.points && pl.points.length >= 3) {
    const pNames = pl.points.slice(0, 3);
    const pts = pNames.map(n => pointLookup[n]).filter(Boolean);
    if (pts.length === 3) {
      const p1 = new THREE.Vector3(pts[0].x, pts[0].z, -pts[0].y);
      const p2 = new THREE.Vector3(pts[1].x, pts[1].z, -pts[1].y);
      const p3 = new THREE.Vector3(pts[2].x, pts[2].z, -pts[2].y);
      const ab = new THREE.Vector3().copy(p2).sub(p1);
      const ac = new THREE.Vector3().copy(p3).sub(p1);
      const n = new THREE.Vector3().crossVectors(ab, ac).normalize();
      normal = [pl.normal?.[0] ?? n.x, pl.normal?.[1] ?? n.z, pl.normal?.[2] ?? -n.y];
      point = [pts[0].x, pts[0].y, pts[0].z];
    }
  }

  if (pl.boundary && !radius) {
    const r = parseDiskRadius(pl.boundary);
    if (r != null) radius = r;
  }

  if (equation && (!normal || !point)) {
    const parsed = parsePlaneFromEquation(equation);
    if (parsed) {
      if (parsed.kind === 'implicit') {
        return { kind: 'implicit', equation: parsed.equation, xRange, yRange, zRange, color, opacity };
      }
      normal = normal || parsed.normal;
      point = point || parsed.point;
      if (parsed.kind === 'disk' && !radius) radius = parsed.radius;
    }
  }

  if (!normal || !point) {
    console.warn('[ThreePlanes] 无法解析平面:', pl);
    return null;
  }

  const finalBounds = bounds || [[-defSize, defSize], [-defSize, defSize]];
  const isDisk = pl.type === 'disk' || radius > 0;

  if (isDisk) {
    if (!radius) {
      const [uMin, uMax] = finalBounds[0];
      const [vMin, vMax] = finalBounds[1];
      radius = Math.max(uMax - uMin, vMax - vMin) / 2;
    }
    return { kind: 'disk', normal, point, radius, color, opacity };
  }

  return { kind: 'flat', normal, point, bounds: finalBounds, color, opacity };
}

/**
 * 将隐式方程重排为 f(x,y,z) 形式（用于数值计算）
 * 使用函数计算方式：检测 = 号，将 left=right 重排为 left-(right)
 * 例如: "x^2+y^2+z^2=4" → "x^2+y^2+z^2-(4)"
 *       "x^2+y^2+z^2-4=0" → "x^2+y^2+z^2-4"
 */
function rearrangeToImplicitForm(equation) {
  if (!equation) return null;
  const s = equation.trim();
  // 找到最外层的 =（不在括号内的）
  let depth = 0;
  let eqPos = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(' || s[i] === '{' || s[i] === '[') depth++;
    else if (s[i] === ')' || s[i] === '}' || s[i] === ']') depth--;
    else if (s[i] === '=' && depth === 0) {
      eqPos = i;
      break;
    }
  }
  if (eqPos < 0) return null;

  const left = s.slice(0, eqPos).trim();
  const right = s.slice(eqPos + 1).trim();

  // 如果 right 是 "0"，直接返回 left
  if (right === '0') return left;

  // 否则：left - (right)
  return left + ' - (' + right + ')';
}

/** 从 z=f(x,y) 形式提取右侧表达式 */
function extractExplicitZExpr(equation) {
  if (!equation) return equation;
  const m = String(equation).trim().match(/^z\s*=\s*(.+)$/i);
  return m ? m[1].trim() : equation;
}

/** 解析参数范围 [name, min, max] */
function parseParamRange(param, defName, defMin, defMax) {
  if (!Array.isArray(param) || param.length < 3) return [defName, defMin, defMax];
  return [String(param[0]), Number(param[1]), Number(param[2])];
}

/** 获取参数曲面三分量（兼容多种字段名） */
function getParametricExprs(func) {
  return {
    exprU: func.exprU || func.exprX || func.x || '',
    exprV: func.exprV || func.exprY || func.y || '',
    exprW: func.exprW || func.exprZ || func.z || '0',
    paramU: func.paramU || func.uRange,
    paramV: func.paramV || func.vRange,
  };
}

/** 自动判断函数渲染类型（不依赖 LLM 严格填写 type） */
function resolveFunctionType(func) {
  const { exprU, exprV } = getParametricExprs(func);
  if (exprU && exprV) return 'parametric';

  const type = String(func.type || '').toLowerCase();
  const expr = (func.expr || func.equation || '').trim();
  if (/parametric|参数/.test(type)) return 'parametric';
  if (/implicit|隐式|隐/.test(type)) return 'implicit';
  if (/explicit|显式|显/.test(type)) return 'explicit';
  // 含等号且不是 z=... → 隐式
  if (/=/.test(expr) && !/^z\s*=/i.test(expr)) return 'implicit';
  return 'explicit';
}

/** 沿 z 轴扫描，求隐式曲面 f(x,y,z)=0 与竖直线的交点（用于网格化） */
function findZOnSurface(compiled, x, y, zMin, zMax, steps = 80) {
  let prevF = null;
  let prevZ = null;
  const roots = [];

  for (let k = 0; k <= steps; k++) {
    const z = zMin + (zMax - zMin) * k / steps;
    let f;
    try {
      f = compiled({ x, y, z });
    } catch {
      continue;
    }
    if (typeof f !== 'number' || !isFinite(f)) continue;
    if (Math.abs(f) < 0.12) roots.push(z);
    if (prevF !== null && prevF * f <= 0) {
      const denom = Math.abs(prevF) + Math.abs(f);
      if (denom > 1e-12) {
        roots.push(prevZ + (Math.abs(prevF) / denom) * (z - prevZ));
      }
    }
    prevF = f;
    prevZ = z;
  }

  if (roots.length === 0) return null;
  // 多根时取最接近区间中点的那个（避免随机跳面）
  const mid = (zMin + zMax) / 2;
  roots.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  return roots[0];
}

/** 由隐式方程生成三角网格（逐列求 z） */
function buildImplicitMesh(compiled, xRange, yRange, zRange, resolution) {
  const [xMin, xMax] = xRange || [-3, 3];
  const [yMin, yMax] = yRange || [-3, 3];
  const [zMin, zMax] = zRange || [-3, 3];
  const res = Math.max(12, Math.min(60, resolution));

  const stepX = (xMax - xMin) / res;
  const stepY = (yMax - yMin) / res;
  const zGrid = [];

  for (let j = 0; j <= res; j++) {
    const row = [];
    for (let i = 0; i <= res; i++) {
      const x = xMin + i * stepX;
      const y = yMin + j * stepY;
      row.push(findZOnSurface(compiled, x, y, zMin, zMax, res * 2));
    }
    zGrid.push(row);
  }

  const vertices = [];
  const indices = [];
  const idx = (i, j) => j * (res + 1) + i;
  const vertIndex = Array.from({ length: res + 1 }, () => Array(res + 1).fill(-1));

  for (let j = 0; j <= res; j++) {
    for (let i = 0; i <= res; i++) {
      const z = zGrid[j][i];
      if (z === null) continue;
      const x = xMin + i * stepX;
      const y = yMin + j * stepY;
      vertIndex[j][i] = vertices.length / 3;
      vertices.push(x, z, -y);
    }
  }

  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = vertIndex[j][i];
      const b = vertIndex[j][i + 1];
      const c = vertIndex[j + 1][i];
      const d = vertIndex[j + 1][i + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  if (vertices.length < 9) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ============ 原始几何体 (点线) ============

function tryParseFloat(s) {
  let cleaned = s.trim();
  cleaned = cleaned.replace(/\\sqrt\{(\d+)\}/g, (_, n) => Math.sqrt(parseFloat(n)).toFixed(6));
  cleaned = cleaned.replace(/√(\d+)/g, (_, n) => Math.sqrt(parseFloat(n)).toFixed(6));
  try {
    const val = Function('"use strict"; return (' + cleaned + ')')();
    if (typeof val === 'number' && !isNaN(val)) return val;
  } catch (e) { /* fall through */ }
  return parseFloat(cleaned);
}

function parseGeometry(description) {
  const result = { points: [], lines: [] };
  if (!description) return result;

  const subscriptCoordRegex = /([xyz])\s*[₀₁₂₃₄₅₆₇₈₉\d]*\s*=\s*(-?[^\s,，;]+)/gi;
  const coordAssignments = { x: [], y: [], z: [] };
  let sm;
  while ((sm = subscriptCoordRegex.exec(description)) !== null) {
    const axis = sm[1].toLowerCase();
    const val = tryParseFloat(sm[2]);
    if (!isNaN(val)) coordAssignments[axis].push(val);
  }
  if (result.points.length === 0 && coordAssignments.x.length > 0 && coordAssignments.y.length > 0 && coordAssignments.z.length > 0) {
    const pointNameRegex = /([A-Z][\d]*)\s*(?:的|的?坐标|点)\s*(?:为|是|：|:)/g;
    let pn;
    const pointNames = [];
    while ((pn = pointNameRegex.exec(description)) !== null) {
      if (!pointNames.includes(pn[1]) && pn[1].length <= 3) pointNames.push(pn[1]);
    }
    if (pointNames.length === 0) {
      const singleCapitalRegex = /\b([A-Z])(?!\w)/g;
      let sc;
      while ((sc = singleCapitalRegex.exec(description)) !== null) {
        if (!pointNames.includes(sc[1])) pointNames.push(sc[1]);
      }
    }
    const x = coordAssignments.x[coordAssignments.x.length - 1];
    const y = coordAssignments.y[coordAssignments.y.length - 1];
    const z = coordAssignments.z[coordAssignments.z.length - 1];
    if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
      const name = pointNames.length > 0 ? pointNames[0] : 'O';
      if (!result.points.find(p => p.name === name)) {
        result.points.push({ name, x, y, z });
      }
    }
  }

  const coordRegex = /([A-Z][\d]*)\s*[=(]?\s*\(\s*(-?[^,，)]+?)\s*[,，]\s*(-?[^,，)]+?)\s*[,，]\s*(-?[^,，)]+?)\s*\)/g;
  let m;
  while ((m = coordRegex.exec(description)) !== null) {
    const name = m[1];
    const x = tryParseFloat(m[2]);
    const y = tryParseFloat(m[3]);
    const z = tryParseFloat(m[4]);
    if (!isNaN(x) && !isNaN(y) && !isNaN(z) && !result.points.find(p => p.name === name)) {
      result.points.push({ name, x, y, z });
    }
  }

  const edgeRegex = /([A-Z][\d]*\d?)\s*[-–—→→]+\s*([A-Z][\d]*)/g;
  let em;
  while ((em = edgeRegex.exec(description)) !== null) {
    if (!result.lines.find(l => l[0] === em[1] && l[1] === em[2])) {
      result.lines.push([em[1], em[2]]);
    }
  }

  const semiParts = description.split(/[;；]/).map(s => s.trim()).filter(Boolean);
  for (const part of semiParts) {
    const clean = part.replace(/^[-*•]\s*/, '').trim();
    if (!clean) continue;
    const ptMatch = clean.match(/([A-Z][\d]*)\s*\(\s*(-?[^,，()]+)\s*[,，]\s*(-?[^,，()]+)\s*[,，]\s*(-?[^,，)]+)\s*\)/);
    if (ptMatch) {
      const name = ptMatch[1];
      const x = tryParseFloat(ptMatch[2]);
      const y = tryParseFloat(ptMatch[3]);
      const z = tryParseFloat(ptMatch[4]);
      if (!isNaN(x) && !isNaN(y) && !isNaN(z) && !result.points.find(p => p.name === name)) {
        result.points.push({ name, x, y, z });
      }
    }
    const edgeMatch = clean.match(/^([A-Z][\d]*)\s*[-–—→]+\s*([A-Z][\d]*)$/);
    if (edgeMatch) {
      if (!result.lines.find(l => l[0] === edgeMatch[1] && l[1] === edgeMatch[2])) {
        result.lines.push([edgeMatch[1], edgeMatch[2]]);
      }
    }
  }

  if (result.lines.length === 0 && result.points.length >= 2) {
    const names = result.points.map(p => p.name);
    const hasNumbered = names.some(n => /\d$/.test(n));
    if (hasNumbered) {
      const groups = {};
      for (const n of names) {
        const suffix = n.match(/(\d+)$/);
        const key = suffix ? suffix[1] : '0';
        if (!groups[key]) groups[key] = [];
        groups[key].push(n);
      }
      const levels = Object.keys(groups).sort();
      if (levels.length >= 2) {
        for (const lv of levels) {
          const pts = groups[lv].sort();
          for (let i = 0; i < pts.length; i++) {
            result.lines.push([pts[i], pts[(i + 1) % pts.length]]);
          }
        }
        const base = groups[levels[0]].sort();
        for (let li = 1; li < levels.length; li++) {
          const upper = groups[levels[li]].sort();
          const count = Math.min(base.length, upper.length);
          for (let i = 0; i < count; i++) {
            result.lines.push([base[i], upper[i]]);
          }
        }
      }
    }
    if (result.lines.length === 0 && result.points.length <= 6) {
      const pts = result.points;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          result.lines.push([pts[i].name, pts[j].name]);
        }
      }
    }
    if (result.lines.length === 0) {
      const ptNames = result.points.map(p => p.name);
      for (let i = 0; i < ptNames.length - 1; i++) {
        result.lines.push([ptNames[i], ptNames[i + 1]]);
      }
      if (ptNames.length >= 3) {
        result.lines.push([ptNames[ptNames.length - 1], ptNames[0]]);
      }
    }
  }

  return result;
}

// ============ Three.js 组件 ============

/** 点线几何体 */
function ThreeGeometry({ geoData }) {
  const pointMap = useMemo(() => {
    const map = {};
    for (const pt of geoData.points) map[pt.name] = [pt.x, pt.y, pt.z];
    return map;
  }, [geoData.points]);

  const linePairs = useMemo(() =>
    geoData.lines.map(([a, b]) => {
      const pa = pointMap[a], pb = pointMap[b];
      if (!pa || !pb) return null;
      return { key: `${a}-${b}`, start: [pa[0], pa[2], -pa[1]], end: [pb[0], pb[2], -pb[1]] };
    }).filter(Boolean),
  [geoData.lines, pointMap]);

  const edgeColors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff922b', '#cc5de8'];
  const sphereColors = ['#ff4757', '#ff6348', '#ffa502', '#eccc68', '#7bed9f', '#70a1ff'];

  return (
    <group>
      {linePairs.map(({ key, start, end }, idx) => (
        <Line key={key} points={[start, end]} color={edgeColors[idx % edgeColors.length]} lineWidth={3} />
      ))}
      {geoData.points.map((pt, idx) => (
        <group key={pt.name}>
          <mesh position={[pt.x, pt.z, -pt.y]}>
            <sphereGeometry args={[0.12, 16, 16]} />
            <meshStandardMaterial color={sphereColors[idx % sphereColors.length]} />
          </mesh>
          <Text position={[pt.x + 0.2, pt.z + 0.2, -pt.y + 0.2]} fontSize={0.28} color="#ffffff" fontWeight="bold">
            {pt.name}
          </Text>
        </group>
      ))}
    </group>
  );
}

/** 显式曲面 z = f(x,y) — 用 mathjs 数值计算生成网格 */
function ExplicitSurface({ equation, xRange, yRange, resolution = 40, color = '#4d96ff', opacity = 0.75 }) {
  const meshRef = useRef();
  const zExpr = extractExplicitZExpr(equation);
  const compiled = useMemo(() => compileExpr(zExpr), [zExpr]);

  const geometry = useMemo(() => {
    if (!compiled) return null;

    const [xMin, xMax] = xRange || [-3, 3];
    const [yMin, yMax] = yRange || [-3, 3];
    const res = Math.max(10, Math.min(80, resolution));
    const stepX = (xMax - xMin) / res;
    const stepY = (yMax - yMin) / res;

    const vertices = [];
    const indices = [];

    // 生成网格顶点
    for (let j = 0; j <= res; j++) {
      const y = yMin + j * stepY;
      for (let i = 0; i <= res; i++) {
        const x = xMin + i * stepX;
        let z = 0;
        try {
          const val = compiled({ x, y });
          z = (typeof val === 'number' && isFinite(val) && !isNaN(val)) ? val : 0;
        } catch (e) {
          z = 0;
        }
        // 坐标系转换: math (X右, Y前, Z上) → Three.js (X右, Y上, Z后)
        vertices.push(x, z, -y);
      }
    }

    // 生成三角形索引
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = j * (res + 1) + i;
        const b = j * (res + 1) + i + 1;
        const c = (j + 1) * (res + 1) + i;
        const d = (j + 1) * (res + 1) + i + 1;
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [compiled, xRange, yRange, resolution]);

  if (!compiled) {
    return (
      <Text position={[0, 0, 0]} fontSize={0.4} color="#ff6b6b">
        无法编译显式曲面: {String(equation).slice(0, 40)}
      </Text>
    );
  }
  if (!geometry) return null;

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial
        color={color}
        side={THREE.DoubleSide}
        transparent
        opacity={opacity}
        wireframe={false}
        roughness={0.3}
        metalness={0.1}
      />
    </mesh>
  );
}

/** 隐式曲面 — 检测球面等已知模式，用 mathjs 数值采样 */
function ImplicitSurface({ equation, xRange, yRange, zRange, resolution = 30 }) {
  const eq = useMemo(() => equation.replace(/\s/g, ''), [equation]);
  const sphere = useMemo(() => detectSphere(eq), [eq]);
  const cylinder = useMemo(() => detectCylinder(eq), [eq]);
  const plane = useMemo(() => detectPlane(eq), [eq]);

  const points = useMemo(() => {
    if (sphere || cylinder || plane) return null;

    let expr = rearrangeToImplicitForm(equation);
    if (!expr) {
      expr = eq.replace(/=\s*0\s*$/, '').replace(/==\s*0\s*$/, '');
      if (!expr.trim()) expr = eq;
    }

    const compiled = compileExpr(expr);
    if (!compiled) return null;

    return buildImplicitMesh(
      compiled,
      xRange || [-3, 3],
      yRange || [-3, 3],
      zRange || [-3, 3],
      resolution
    );
  }, [sphere, cylinder, plane, eq, equation, xRange, yRange, zRange, resolution]);

  if (sphere) {
    const r = sphere.r;
    return (
      <mesh>
        <sphereGeometry args={[r, 48, 48]} />
        <meshStandardMaterial
          color="#4d96ff"
          transparent
          opacity={0.55}
          roughness={0.2}
          metalness={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>
    );
  }

  if (cylinder) {
    const { axis, radius } = cylinder;
    const [xMin, xMax] = xRange || [-3, 3];
    const [yMin, yMax] = yRange || [-3, 3];
    const [zMin, zMax] = zRange || [-3, 3];
    let height, rotation;
    if (axis === 'z') {
      height = Math.max(yMax - yMin, zMax - zMin);
      rotation = [0, 0, 0];
    } else if (axis === 'y') {
      height = Math.max(xMax - xMin, zMax - zMin);
      rotation = [Math.PI / 2, 0, 0];
    } else {
      height = Math.max(yMax - yMin, zMax - zMin);
      rotation = [0, 0, Math.PI / 2];
    }
    return (
      <mesh rotation={rotation}>
        <cylinderGeometry args={[radius, radius, height, 48, 1, true]} />
        <meshStandardMaterial
          color="#4d96ff"
          transparent
          opacity={0.35}
          roughness={0.3}
          metalness={0.2}
          side={THREE.DoubleSide}
          wireframe={false}
        />
      </mesh>
    );
  }

  if (plane) {
    const { a, b, c, d } = plane;
    const [xMin, xMax] = xRange || [-3, 3];
    const [yMin, yMax] = yRange || [-3, 3];
    const size = Math.max(xMax - xMin, yMax - yMin);

    let px, py, pz;
    if (Math.abs(c) > 1e-10) {
      px = 0; py = 0; pz = d / c;
    } else if (Math.abs(b) > 1e-10) {
      px = 0; py = d / b; pz = 0;
    } else if (Math.abs(a) > 1e-10) {
      px = d / a; py = 0; pz = 0;
    } else {
      px = 0; py = 0; pz = 0;
    }

    const halfSize = size / 2;
    return (
      <BoundedPlaneMesh
        normal={[a, b, c]}
        point={[px, py, pz]}
        bounds={[[-halfSize, halfSize], [-halfSize, halfSize]]}
        idx={0}
      />
    );
  }

  if (!points) {
    return (
      <Text position={[0, 0, 0]} fontSize={0.4} color="#ff6b6b">
        无法渲染隐式曲面: {String(equation).slice(0, 50)}
      </Text>
    );
  }

  return (
    <mesh geometry={points}>
      <meshStandardMaterial
        color="#4d96ff"
        side={THREE.DoubleSide}
        transparent
        opacity={0.7}
        roughness={0.3}
        metalness={0.1}
      />
    </mesh>
  );
}

/** 参数曲面：x=f(u,v), y=g(u,v), z=h(u,v) — 用 mathjs 数值计算 */
function ParametricSurface({ exprU, exprV, exprW, paramU, paramV, color = '#4d96ff', opacity = 0.7 }) {
  const [uName, uMin, uMax] = parseParamRange(paramU, 'u', 0, Math.PI * 2);
  const [vName, vMin, vMax] = parseParamRange(paramV, 'v', 0, 1);
  const res = 40;

  const compiledU = useMemo(() => compileExpr(exprU), [exprU]);
  const compiledV = useMemo(() => compileExpr(exprV), [exprV]);
  const compiledW = useMemo(() => compileExpr(exprW), [exprW]);

  const geometry = useMemo(() => {
    if (!compiledU || !compiledV) return null;

    const vertices = [];
    const indices = [];
    const stepU = (uMax - uMin) / res;
    const stepV = (vMax - vMin) / res;

    const evalSafe = (fn, scope) => {
      try {
        const val = fn(scope);
        return (typeof val === 'number' && isFinite(val)) ? val : 0;
      } catch { return 0; }
    };

    for (let j = 0; j <= res; j++) {
      const v = vMin + j * stepV;
      for (let i = 0; i <= res; i++) {
        const u = uMin + i * stepU;
        const scope = { [uName]: u, [vName]: v };
        // math: (X right, Y forward, Z up) → three: (X right, Y up, Z back)
        // three.x = math.x, three.y = math.z, three.z = -math.y
        const mx = evalSafe(compiledU, scope);
        const my = compiledW ? evalSafe(compiledW, scope) : 0;
        const mz = evalSafe(compiledV, scope);
        vertices.push(mx, my, -mz);
      }
    }

    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = j * (res + 1) + i;
        const b = j * (res + 1) + i + 1;
        const c = (j + 1) * (res + 1) + i;
        const d = (j + 1) * (res + 1) + i + 1;
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [compiledU, compiledV, compiledW, uMin, uMax, vMin, vMax]);

  if (!geometry) {
    console.warn('[ParametricSurface] 编译失败:', { exprU, exprV, exprW });
    return (
      <Text position={[0, 0, 0]} fontSize={0.4} color="#ff6b6b">
        无法渲染参数曲面
      </Text>
    );
  }

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        side={THREE.DoubleSide}
        transparent
        opacity={opacity}
        roughness={0.3}
        metalness={0.1}
      />
    </mesh>
  );
}

/** 生成有边界的平面网格（矩形面片 + 边缘线框） */
function BoundedPlaneMesh({ normal, point, bounds, idx }) {
  const colors = ['#4d96ff', '#ff6b6b', '#6bcb77', '#ffd93d', '#ce93d8', '#ff8a65'];

  return useMemo(() => {
    if (!normal || !point) return null;

    const n = new THREE.Vector3(normal[0], normal[2], -normal[1]).normalize();
    const p = new THREE.Vector3(point[0], point[2], -point[1]);

    // 构造平面局部坐标系 u, v
    const up = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(n, up).normalize();
    const v = new THREE.Vector3().crossVectors(u, n).normalize();

    const segments = 16;
    const [uMin, uMax] = bounds ? bounds[0] : [-4, 4];
    const [vMin, vMax] = bounds ? bounds[1] : [-4, 4];
    const su = (uMax - uMin) / segments;
    const sv = (vMax - vMin) / segments;

    // --- 面片网格 ---
    const verts = [];
    const indices = [];
    for (let j = 0; j <= segments; j++) {
      const vv = vMin + j * sv;
      for (let i = 0; i <= segments; i++) {
        const uu = uMin + i * su;
        const pos = new THREE.Vector3().copy(p).add(u.clone().multiplyScalar(uu)).add(v.clone().multiplyScalar(vv));
        verts.push(pos.x, pos.y, pos.z);
      }
    }
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = j * (segments + 1) + i;
        const b = j * (segments + 1) + i + 1;
        const c = (j + 1) * (segments + 1) + i;
        const d = (j + 1) * (segments + 1) + i + 1;
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    const meshGeo = new THREE.BufferGeometry();
    meshGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    meshGeo.setIndex(indices);
    meshGeo.computeVertexNormals();

    // --- 边缘线框（四条边的线段点） ---
    const edgeVerts = [];
    // 左部(uMin, vMin→vMax), 右部(uMax, vMin→vMax)
    const edgePoints = [
      [uMin, vMin, uMax, vMin],
      [uMax, vMin, uMax, vMax],
      [uMax, vMax, uMin, vMax],
      [uMin, vMax, uMin, vMin],
    ];
    for (const [u1, v1, u2, v2] of edgePoints) {
      const steps = 20;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const uu = u1 + (u2 - u1) * t;
        const vv = v1 + (v2 - v1) * t;
        const pos = new THREE.Vector3().copy(p).add(u.clone().multiplyScalar(uu)).add(v.clone().multiplyScalar(vv));
        edgeVerts.push(pos.x, pos.y, pos.z);
      }
    }

    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgeVerts, 3));

    const color = colors[(idx || 0) % colors.length];

    return (
      <group>
        <mesh geometry={meshGeo}>
          <meshStandardMaterial
            color={color}
            transparent
            opacity={0.25}
            side={THREE.DoubleSide}
            roughness={0.5}
            metalness={0.0}
            depthWrite={false}
          />
        </mesh>
        <line geometry={edgeGeo}>
          <lineBasicMaterial color={color} transparent opacity={0.6} linewidth={1} />
        </line>
      </group>
    );
  }, [normal, point, bounds, idx]);
}

/** 圆盘面片（圆台上下底面等） */
function BoundedDiskMesh({ normal, point, radius, idx, color, opacity = 0.35 }) {
  const colors = ['#4d96ff', '#ff6b6b', '#6bcb77', '#ffd93d', '#ce93d8', '#ff8a65'];

  const geometry = useMemo(() => {
    if (!normal || !point || !radius) return null;

    const n = new THREE.Vector3(normal[0], normal[2], -normal[1]).normalize();
    const p = new THREE.Vector3(point[0], point[2], -point[1]);
    const up = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(n, up).normalize();
    const v = new THREE.Vector3().crossVectors(u, n).normalize();

    const segments = 48;
    const verts = [p.x, p.y, p.z];
    const indices = [];
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      const pos = new THREE.Vector3().copy(p)
        .add(u.clone().multiplyScalar(radius * Math.cos(t)))
        .add(v.clone().multiplyScalar(radius * Math.sin(t)));
      verts.push(pos.x, pos.y, pos.z);
    }
    for (let i = 1; i < segments; i++) {
      indices.push(0, i, i + 1);
    }
    indices.push(0, segments, 1);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [normal, point, radius]);

  if (!geometry) return null;
  const matColor = color || colors[(idx || 0) % colors.length];

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={matColor}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        roughness={0.4}
        metalness={0.05}
        depthWrite={false}
      />
    </mesh>
  );
}

/** 单个平面/曲面条目渲染 */
function PlaneEntry({ pl, idx, pointLookup, defSize }) {
  const resolved = resolvePlaneRenderData(pl, pointLookup, defSize);
  if (!resolved) return null;

  if (resolved.kind === 'implicit') {
    return (
      <ImplicitSurface
        key={idx}
        equation={resolved.equation}
        xRange={resolved.xRange}
        yRange={resolved.yRange}
        zRange={resolved.zRange}
        resolution={pl.resolution || 30}
      />
    );
  }
  if (resolved.kind === 'disk') {
    return (
      <BoundedDiskMesh
        key={idx}
        normal={resolved.normal}
        point={resolved.point}
        radius={resolved.radius}
        idx={idx}
        color={resolved.color || pl.color}
        opacity={resolved.opacity ?? pl.opacity ?? 0.35}
      />
    );
  }
  return (
    <BoundedPlaneMesh
      key={idx}
      normal={resolved.normal}
      point={resolved.point}
      bounds={resolved.bounds}
      idx={idx}
    />
  );
}

/** 平面几何体（从 drawingData.planes）— 支持 equation / disk / implicit */
function ThreePlanes({ planes, defaultBounds, pointLookup = {} }) {
  if (!planes || planes.length === 0) return null;

  const defSize = (defaultBounds && Array.isArray(defaultBounds) && defaultBounds.length === 2)
    ? Math.max(Math.abs(defaultBounds[0]), Math.abs(defaultBounds[1]))
    : 4;

  return (
    <group>
      {planes.map((pl, idx) => (
        <PlaneEntry key={idx} pl={pl} idx={idx} pointLookup={pointLookup} defSize={defSize} />
      ))}
    </group>
  );
}

/** 渲染 drawingData.functions 中所有函数（显式/隐式/参数） */
function ThreeFunctions({ functions, defaultXRange, defaultYRange, defaultZRange }) {
  if (!functions || functions.length === 0) return null;

  const colors = ['#4d96ff', '#ff6b6b', '#6bcb77', '#ffd93d', '#ce93d8', '#ff8a65'];

  return (
    <group>
      {functions.map((func, idx) => {
        const resolvedType = resolveFunctionType(func);
        const expr = func.expr || func.equation || '';
        const xRange = func.xRange || defaultXRange || [-3, 3];
        const yRange = func.yRange || defaultYRange || [-3, 3];
        const zRange = func.zRange || defaultZRange || [-3, 3];
        const color = func.color || colors[idx % colors.length];
        const opacity = func.opacity != null ? func.opacity : 0.7;
        const resolution = func.resolution || 40;

        // 参数曲面：有 exprU+exprV 即渲染（不依赖 type 字段是否准确）
        if (resolvedType === 'parametric') {
          const p = getParametricExprs(func);
          if (!p.exprU || !p.exprV) {
            console.warn('[ThreeFunctions] parametric 缺少 exprU/exprV:', func);
            return null;
          }
          console.log('[ThreeFunctions] parametric', func.name || idx, p.exprU?.slice(0, 40));
          return (
            <ParametricSurface
              key={idx}
              exprU={p.exprU}
              exprV={p.exprV}
              exprW={p.exprW}
              paramU={p.paramU}
              paramV={p.paramV}
              color={color}
              opacity={opacity}
            />
          );
        }

        if (!expr) return null;

        if (resolvedType === 'implicit') {
          console.log('[ThreeFunctions] implicit', func.name || idx, expr.slice(0, 40));
          return (
            <ImplicitSurface
              key={idx}
              equation={expr}
              xRange={xRange}
              yRange={yRange}
              zRange={zRange}
              resolution={resolution}
            />
          );
        }

        console.log('[ThreeFunctions] explicit z=', func.name || idx, expr.slice(0, 40));
        return (
          <ExplicitSurface
            key={idx}
            equation={expr}
            xRange={xRange}
            yRange={yRange}
            resolution={resolution}
            color={color}
            opacity={opacity}
          />
        );
      })}
    </group>
  );
}

function Axes() {
  const LABEL_OFFSET = 0.8;
  return (
    <group>
      <Line points={[[0,0,0],[5,0,0]]} color="#ff4444" lineWidth={2} />
      <Text position={[5.3, LABEL_OFFSET, 0]} fontSize={0.4} color="#ff4444" fontWeight="bold">X</Text>
      <Line points={[[0,0,0],[0,0,-5]]} color="#44ff44" lineWidth={2} />
      <Text position={[0, LABEL_OFFSET, -5.3]} fontSize={0.4} color="#44ff44" fontWeight="bold">Y</Text>
      <Line points={[[0,0,0],[0,5,0]]} color="#4488ff" lineWidth={2} />
      <Text position={[0, 5.3, 0]} fontSize={0.4} color="#4488ff" fontWeight="bold">Z</Text>
    </group>
  );
}

function GridPlane() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshBasicMaterial color="#2a2a4a" side={2} transparent opacity={0.3} />
      </mesh>
      <gridHelper args={[20, 20, '#444', '#333']} />
    </group>
  );
}

/** 环境自动旋转 */
function AutoRotate({ children, speed = 0.003 }) {
  const groupRef = useRef();
  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y += speed;
    }
  });
  return <group ref={groupRef}>{children}</group>;
}

// ============ 主组件 ============

const Interactive3DViewer = ({ description, drawingData, imageType }) => {
  const surfaceInfo = useMemo(() => extractSurfaceInfo(description, drawingData, imageType), [description, drawingData, imageType]);

  const geoData = useMemo(() => {
    if (drawingData && (drawingData.points?.length > 0 || drawingData.planes?.length > 0 || drawingData.functions?.length > 0)) {
      return {
        points: drawingData.points || [],
        lines: drawingData.lines || [],
        planes: drawingData.planes || [],
        functions: drawingData.functions || [],
      };
    }
    return parseGeometry(description);
  }, [description, drawingData]);

  // 从 geoData.points 建立名称→坐标映射（用于 points→normal 转换）
  const pointLookup = useMemo(() => {
    const map = {};
    if (geoData?.points) {
      for (const p of geoData.points) {
        if (p.name) map[p.name] = p;
      }
    }
    // 也解析 description 中的 A(x,y,z) 格式
    if (description) {
      const matches = description.matchAll(/([A-Za-z0-9_']+)\s*\(([^)]+)\)/g);
      for (const m of matches) {
        const [_, name, coords] = m;
        if (!map[name]) {
          const parts = coords.split(',').map(s => parseFloat(s.trim()));
          if (parts.length >= 3 && parts.every(v => isFinite(v))) {
            map[name] = { name, x: parts[0], y: parts[1], z: parts[2] };
          }
        }
      }
    }
    return map;
  }, [geoData, description]);

  // 判断是否有任何可渲染数据
  const isSurface = imageType === 'MATH_STATIC_SURFACE' || imageType === 'MATH_STATIC_IMPLICIT';
  const hasFunctions = (drawingData?.functions?.length > 0) || (geoData?.functions?.length > 0);
  const hasSurfaceEquation = surfaceInfo.equation && isSurface && !hasFunctions;
  const isParametric = !hasFunctions && surfaceInfo.type === 'parametric' && surfaceInfo.exprU && surfaceInfo.exprV;
  const hasPlanes = (drawingData?.planes?.length > 0) || (geoData?.planes?.length > 0);

  if (!hasSurfaceEquation && !isParametric && !hasPlanes && !hasFunctions && geoData.points.length < 2) {
    return (
      <div style={{
        width: '100%', maxWidth: '700px', margin: '16px auto',
        borderRadius: '12px', overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        backgroundColor: '#1a1a2e', padding: '32px',
        textAlign: 'center', color: '#888',
      }}>
        <p style={{ color: '#ff6b6b', fontWeight: 600 }}>Not enough 3D geometry data</p>
        <p style={{ fontSize: '12px', marginTop: '8px', wordBreak: 'break-all' }}>
          {description?.substring(0, 300)}
        </p>
      </div>
    );
  }

  return (
    <div style={{
      width: '100%', maxWidth: '700px', height: '520px',
      margin: '16px auto', borderRadius: '12px', overflow: 'hidden',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    }}>
      <Canvas camera={{ position: [7, 5, -7], fov: 55 }} style={{ background: '#1a1a2e' }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[8, 10, 4]} intensity={1.0} />
        <directionalLight position={[-4, -2, -4]} intensity={0.4} />
        <GridPlane />
        <Axes />

        {/* 所有 3D 元素放在同一个 AutoRotate 内，确保整体旋转（如圆台侧面+底面一起转） */}
        <AutoRotate speed={0.003}>
          {/* 显式曲面 */}
          {hasSurfaceEquation && surfaceInfo.type === 'explicit' && (
            <ExplicitSurface
              equation={surfaceInfo.equation}
              xRange={surfaceInfo.xRange}
              yRange={surfaceInfo.yRange}
              resolution={surfaceInfo.resolution}
            />
          )}
          {/* 隐式曲面 */}
          {hasSurfaceEquation && (surfaceInfo.type === 'implicit' || surfaceInfo.type === 'unknown') && (
            <ImplicitSurface
              equation={surfaceInfo.equation}
              xRange={surfaceInfo.xRange}
              yRange={surfaceInfo.yRange}
              zRange={surfaceInfo.zRange}
              resolution={surfaceInfo.resolution}
            />
          )}
          {/* 单参数曲面 */}
          {isParametric && (
            <ParametricSurface
              exprU={surfaceInfo.exprU}
              exprV={surfaceInfo.exprV}
              exprW={surfaceInfo.exprW}
              paramU={surfaceInfo.paramU}
              paramV={surfaceInfo.paramV}
              color={surfaceInfo.color}
              opacity={surfaceInfo.opacity}
            />
          )}
          {/* 点线几何体 */}
          <ThreeGeometry geoData={geoData} />
          {/* 平面（底面/顶面） */}
          <ThreePlanes planes={drawingData?.planes || geoData?.planes} defaultBounds={surfaceInfo.xRange} pointLookup={pointLookup} />
          {/* 多函数渲染（含参数曲面） */}
          <ThreeFunctions
            functions={drawingData?.functions || geoData?.functions}
            defaultXRange={surfaceInfo.xRange}
            defaultYRange={surfaceInfo.yRange}
            defaultZRange={surfaceInfo.zRange}
          />
        </AutoRotate>

        <OrbitControls enableDamping dampingFactor={0.1} minDistance={2} maxDistance={30} target={[0, 0, 0]} />
      </Canvas>
      <div style={{
        padding: '10px 16px', backgroundColor: '#111122',
        borderTop: '1px solid #2a2a4a', color: '#aaa', fontSize: '13px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>Drag to rotate | Scroll to zoom | Right-drag to pan</span>
        {(hasSurfaceEquation || hasFunctions) && <span style={{ color: '#4d96ff', fontSize: '11px' }}>Numerical rendering (mathjs)</span>}
      </div>
    </div>
  );
};

export default Interactive3DViewer;