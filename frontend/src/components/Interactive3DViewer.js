import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line, Text } from '@react-three/drei';
import * as THREE from 'three';
import { create, all } from 'mathjs';

const math = create(all, {});

// ============ 数值计算工具 ============

/** 编译数学表达式为可调用函数 */
function compileExpr(expr, vars) {
  try {
    const parsed = math.parse(expr);
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

  // 1. 如果 drawingData 有 functions，尝试提取
  if (drawingData?.functions?.length > 0) {
    for (const f of drawingData.functions) {
      const expr = f.expr || f.equation || '';
      if (expr.includes('z') || expr.includes('=')) {
        info.equation = expr;
        break;
      }
    }
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
      if (f.type === 'parametric' && f.exprU && f.exprV) {
        info.type = 'parametric';
        info.exprU = f.exprU;
        info.exprV = f.exprV;
        info.exprW = f.exprW || '';
        info.paramU = f.paramU || ['u', 0, Math.PI * 2];
        info.paramV = f.paramV || ['v', 0, Math.PI * 2];
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
function ExplicitSurface({ equation, xRange, yRange, resolution = 40 }) {
  const meshRef = useRef();

  // 标准化方程：去掉 "z = " 前缀
  let expr = equation.replace(/^z\s*=\s*/i, '').trim();
  // 转换 ^ 为 **
  expr = expr.replace(/\^/g, '**');

  const compiled = useMemo(() => compileExpr(expr, ['x', 'y']), [expr]);

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

  if (!geometry) return null;

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial
        color="#4d96ff"
        side={THREE.DoubleSide}
        transparent
        opacity={0.75}
        wireframe={false}
        roughness={0.3}
        metalness={0.1}
      />
    </mesh>
  );
}

/** 隐式曲面 — 检测球面等已知模式，用 mathjs 数值采样 */
function ImplicitSurface({ equation, xRange, yRange, zRange, resolution = 30 }) {
  // 标准化方程
  let eq = equation.replace(/\s/g, '');
  // 转换 ^ 为 **
  eq = eq.replace(/\^/g, '**');

  // 尝试检测球面
  const sphere = detectSphere(eq);
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

  // 尝试检测圆柱面
  const cylinder = detectCylinder(eq);
  if (cylinder) {
    const { axis, radius } = cylinder;
    const [xMin, xMax] = xRange || [-3, 3];
    const [yMin, yMax] = yRange || [-3, 3];
    const [zMin, zMax] = zRange || [-3, 3];
    // 根据轴线方向确定高度
    let height, rotation;
    if (axis === 'z') {
      height = Math.max(yMax - yMin, zMax - zMin);
      rotation = [0, 0, 0];
    } else if (axis === 'y') {
      height = Math.max(xMax - xMin, zMax - zMin);
      rotation = [Math.PI / 2, 0, 0];
    } else { // x-axis
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

  // 尝试检测平面并用有边界网格渲染
  const plane = detectPlane(eq);
  if (plane) {
    const { a, b, c, d } = plane;
    const [xMin, xMax] = xRange || [-3, 3];
    const [yMin, yMax] = yRange || [-3, 3];
    const size = Math.max(xMax - xMin, yMax - yMin);

    // 取平面上一点
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

  // 通用隐式曲面：网格采样 + 阈值过滤（简化版）
  // 使用粒子云方式可视化
  const points = useMemo(() => {
    const [xMin, xMax] = xRange || [-3, 3];
    const [yMin, yMax] = yRange || [-3, 3];
    const [zMin, zMax] = zRange || [-3, 3];
    const res = Math.max(10, Math.min(40, resolution));

    // 构建表达式
    let expr = eq
      .replace(/=\s*0\s*$/, '')
      .replace(/==\s*0\s*$/, '');
    if (!expr.trim()) expr = eq;

    // 替换 x,y,z → 变量名用于 eval
    // 使用 mathjs compile
    const compiled = compileExpr(expr, ['x', 'y', 'z']);
    if (!compiled) return [];

    const pts = [];
    const stepX = (xMax - xMin) / res;
    const stepY = (yMax - yMin) / res;
    const stepZ = (zMax - zMin) / res;

    for (let i = 0; i <= res; i++) {
      const x = xMin + i * stepX;
      for (let j = 0; j <= res; j++) {
        const y = yMin + j * stepY;
        for (let k = 0; k <= res; k++) {
          const z = zMin + k * stepZ;
          try {
            const val = compiled({ x, y, z });
            if (typeof val === 'number' && isFinite(val) && Math.abs(val) < 0.15) {
              // 坐标系转换
              pts.push(x, z, -y);
            }
          } catch (e) { /* skip */ }
        }
      }
    }

    return pts;
  }, [eq, xRange, yRange, zRange, resolution]);

  if (points.length === 0) {
    return (
      <Text position={[0, 0, 0]} fontSize={0.5} color="#ff6b6b">
        无法渲染隐式曲面
      </Text>
    );
  }

  const positions = new Float32Array(points);
  const pointGeo = new THREE.BufferGeometry();
  pointGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  return (
    <points geometry={pointGeo}>
      <pointsMaterial size={0.08} color="#4d96ff" transparent opacity={0.7} sizeAttenuation />
    </points>
  );
}

/** 参数曲面：x=f(u,v), y=g(u,v), z=h(u,v) — 用 mathjs 数值计算 */
function ParametricSurface({ exprU, exprV, exprW, paramU, paramV, color = '#4d96ff', opacity = 0.7 }) {
  const [uName, uMin, uMax] = paramU || ['u', 0, Math.PI * 2];
  const [vName, vMin, vMax] = paramV || ['v', 0, Math.PI * 2];
  const res = 40;

  const compiledU = useMemo(() => compileExpr(exprU, [uName, vName]), [exprU, uName, vName]);
  const compiledV = useMemo(() => compileExpr(exprV, [uName, vName]), [exprV, uName, vName]);
  const compiledW = useMemo(() => compileExpr(exprW, [uName, vName]), [exprW, uName, vName]);

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

  if (!geometry) return null;

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

/** 平面几何体（从 drawingData.planes）— 带边界矩形渲染，支持 points[] 或 normal+point */
function ThreePlanes({ planes, defaultBounds, pointLookup = {} }) {
  if (!planes || planes.length === 0) return null;

  // 默认范围：用 xRange（若提供）或 [-4, 4]
  const defSize = (defaultBounds && Array.isArray(defaultBounds) && defaultBounds.length === 2)
    ? Math.max(Math.abs(defaultBounds[0]), Math.abs(defaultBounds[1]))
    : 4;

  return (
    <group>
      {planes.map((pl, idx) => {
        let { normal, point, bounds } = pl;

        // 如果 planes 是 {points: ["A","B","C"]} 格式，从坐标计算法向量
        if ((!normal || !point) && pl.points && pl.points.length >= 3) {
          const pNames = pl.points.slice(0, 3);
          const pts = pNames.map(n => pointLookup[n]).filter(Boolean);
          if (pts.length === 3) {
            // math 坐标系 (X右, Y前, Z上)
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

        // 转换 math 坐标 → three.js 坐标
        if (!normal || !point) return null;
        const finalBounds = bounds || [[-defSize, defSize], [-defSize, defSize]];
        return <BoundedPlaneMesh key={idx} normal={normal} point={point} bounds={finalBounds} idx={idx} />;
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
    if (drawingData && drawingData.points && drawingData.points.length > 0) {
      return {
        points: drawingData.points,
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

  // 判断是否是曲面/隐式类型
  const isSurface = imageType === 'MATH_STATIC_SURFACE' || imageType === 'MATH_STATIC_IMPLICIT';
  const hasSurfaceEquation = surfaceInfo.equation && isSurface;
  const isParametric = surfaceInfo.type === 'parametric' && surfaceInfo.exprU && surfaceInfo.exprV;
  const hasPlanes = (drawingData?.planes?.length > 0) || (geoData?.planes?.length > 0);

  if (!hasSurfaceEquation && !isParametric && !hasPlanes && geoData.points.length < 2) {
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

        {/* 曲面渲染（mathjs 数值计算） */}
        {hasSurfaceEquation && surfaceInfo.type === 'explicit' && (
          <AutoRotate speed={0.003}>
            <ExplicitSurface
              equation={surfaceInfo.equation}
              xRange={surfaceInfo.xRange}
              yRange={surfaceInfo.yRange}
              resolution={surfaceInfo.resolution}
            />
          </AutoRotate>
        )}
        {hasSurfaceEquation && (surfaceInfo.type === 'implicit' || surfaceInfo.type === 'unknown') && (
          <AutoRotate speed={0.003}>
            <ImplicitSurface
              equation={surfaceInfo.equation}
              xRange={surfaceInfo.xRange}
              yRange={surfaceInfo.yRange}
              zRange={surfaceInfo.zRange}
              resolution={surfaceInfo.resolution}
            />
          </AutoRotate>
        )}

        {/* 参数曲面渲染 */}
        {isParametric && (
          <AutoRotate speed={0.003}>
            <ParametricSurface
              exprU={surfaceInfo.exprU}
              exprV={surfaceInfo.exprV}
              exprW={surfaceInfo.exprW}
              paramU={surfaceInfo.paramU}
              paramV={surfaceInfo.paramV}
              color={surfaceInfo.color}
              opacity={surfaceInfo.opacity}
            />
          </AutoRotate>
        )}

        {/* 点线几何体 */}
        <ThreeGeometry geoData={geoData} />

        {/* 平面 */}
        <ThreePlanes planes={drawingData?.planes || geoData?.planes} defaultBounds={surfaceInfo.xRange} pointLookup={pointLookup} />

        <OrbitControls enableDamping dampingFactor={0.1} minDistance={2} maxDistance={30} target={[0, 0, 0]} />
      </Canvas>
      <div style={{
        padding: '10px 16px', backgroundColor: '#111122',
        borderTop: '1px solid #2a2a4a', color: '#aaa', fontSize: '13px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>Drag to rotate | Scroll to zoom | Right-drag to pan</span>
        {hasSurfaceEquation && <span style={{ color: '#4d96ff', fontSize: '11px' }}>Numerical rendering</span>}
      </div>
    </div>
  );
};

export default Interactive3DViewer;