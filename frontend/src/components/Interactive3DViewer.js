import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line, Text } from '@react-three/drei';

function tryParseFloat(s) {
  // Handle expressions like "√3+1", "√2", "2√3", "1+√3"
  let cleaned = s.trim();
  // Replace \sqrt{X} and √X with numeric approximations
  cleaned = cleaned.replace(/\\sqrt\{(\d+)\}/g, (_, n) => Math.sqrt(parseFloat(n)).toFixed(6));
  cleaned = cleaned.replace(/√(\d+)/g, (_, n) => Math.sqrt(parseFloat(n)).toFixed(6));
  // Evaluate simple + - * expressions
  try {
    const val = Function('"use strict"; return (' + cleaned + ')')();
    if (typeof val === 'number' && !isNaN(val)) return val;
  } catch (e) { /* fall through */ }
  return parseFloat(cleaned);
}

function parseGeometry(description) {
  const result = { points: [], lines: [] };
  if (!description) return result;

  // 1.5. NEW: Parse subscript-style coordinate assignments like "x₀ = 1", "y₀ = √2", "z₀ = 0"
  // These come from AI describing point O or similar without using O(x,y,z) format.
  const subscriptCoordRegex = /([xyz])\s*[₀₁₂₃₄₅₆₇₈₉\d]*\s*=\s*(-?[^\s,，;]+)/gi;
  const coordAssignments = { x: [], y: [], z: [] };
  let sm;
  while ((sm = subscriptCoordRegex.exec(description)) !== null) {
    const axis = sm[1].toLowerCase();
    const val = tryParseFloat(sm[2]);
    if (!isNaN(val)) coordAssignments[axis].push(val);
  }
  // If we found at least one set of {x, y, z} assignments and haven't parsed any points yet, create one
  if (result.points.length === 0 && coordAssignments.x.length > 0 && coordAssignments.y.length > 0 && coordAssignments.z.length > 0) {
    // Look for point names near these coordinates
    const pointNameRegex = /([A-Z][\d]*)\s*(?:的|的?坐标|点)\s*(?:为|是|：|:)/g;
    let pn;
    const pointNames = [];
    while ((pn = pointNameRegex.exec(description)) !== null) {
      if (!pointNames.includes(pn[1]) && pn[1].length <= 3) pointNames.push(pn[1]);
    }
    // If no explicit point name found, look for single capital letters
    if (pointNames.length === 0) {
      const singleCapitalRegex = /\b([A-Z])(?!\w)/g;
      let sc;
      while ((sc = singleCapitalRegex.exec(description)) !== null) {
        if (!['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'].includes(sc[1])) continue;
        if (!pointNames.includes(sc[1])) pointNames.push(sc[1]);
      }
    }
    // Use the last x,y,z assignment (most likely the fully resolved values)
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

  // 1. First pass: extract ALL coordinate-like patterns in the text
  // Match patterns like: A(0,0,0), C(2,√2,0), P(0,0,√2), D(√3+1, 0, 0)
  // More permissive regex: name followed by (x, y, z) where x/y/z may contain √, \, etc
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

  // 2. Extract edges from the description text
  const edgeRegex = /([A-Z][\d]*\d?)\s*[-–—→→]+\s*([A-Z][\d]*)/g;
  let em;
  while ((em = edgeRegex.exec(description)) !== null) {
    if (!result.lines.find(l => l[0] === em[1] && l[1] === em[2])) {
      result.lines.push([em[1], em[2]]);
    }
  }

  // 3. Also try semicolon-separated format (legacy)
  const semiParts = description.split(/[;；]/).map(s => s.trim()).filter(Boolean);
  for (const part of semiParts) {
    const clean = part.replace(/^[-*•]\s*/, '').trim();
    if (!clean) continue;
    // Also try vertex in semicolon format
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
    // Edge
    const edgeMatch = clean.match(/^([A-Z][\d]*)\s*[-–—→]+\s*([A-Z][\d]*)$/);
    if (edgeMatch) {
      if (!result.lines.find(l => l[0] === edgeMatch[1] && l[1] === edgeMatch[2])) {
        result.lines.push([edgeMatch[1], edgeMatch[2]]);
      }
    }
  }

  // 4. Auto-connect if we have points but no edges
  if (result.lines.length === 0 && result.points.length >= 2) {
    const names = result.points.map(p => p.name);

    // Heuristic 1: points ending with '1' are top layer, matching base layer
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
        // Connect each ring and verticals between consecutive levels
        for (const lv of levels) {
          const pts = groups[lv].sort();
          for (let i = 0; i < pts.length; i++) {
            result.lines.push([pts[i], pts[(i + 1) % pts.length]]);
          }
        }
        // Connect between levels: match by base name (strip suffix)
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

    // Heuristic 2: still no edges? Connect all points pairwise by proximity for small sets
    if (result.lines.length === 0 && result.points.length <= 6) {
      const pts = result.points;
      // Connect all pairs (complete graph) — simple and always shows something
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          result.lines.push([pts[i].name, pts[j].name]);
        }
      }
    }

    // Heuristic 3: chain + close ring for any number of points if still no edges
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
      // Convert from math (x,y,z) to Three.js (x,z,y)
      return { key: `${a}-${b}`, start: [pa[0], pa[2], pa[1]], end: [pb[0], pb[2], pb[1]] };
    }).filter(Boolean),
  [geoData.lines, pointMap]);

  // Bright visible colors for edges
  const edgeColors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff922b', '#cc5de8'];
  const sphereColors = ['#ff4757', '#ff6348', '#ffa502', '#eccc68', '#7bed9f', '#70a1ff'];

  return (
    <group>
      {linePairs.map(({ key, start, end }, idx) => (
        <Line key={key} points={[start, end]} color={edgeColors[idx % edgeColors.length]} lineWidth={3} />
      ))}
      {geoData.points.map((pt, idx) => (
        <group key={pt.name}>
          {/* Math: X=right, Y=forward, Z=up → Three.js: X=right, Y=up, Z=back */}
          <mesh position={[pt.x, pt.z, pt.y]}>
            <sphereGeometry args={[0.12, 16, 16]} />
            <meshStandardMaterial color={sphereColors[idx % sphereColors.length]} />
          </mesh>
          <Text position={[pt.x + 0.2, pt.z + 0.2, pt.y + 0.2]} fontSize={0.28} color="#ffffff" fontWeight="bold">
            {pt.name}
          </Text>
        </group>
      ))}
    </group>
  );
}

function Axes() {
  return (
    <group>
      {/* X: right → (+1, 0, 0) — same in both math and Three.js */}
      <Line points={[[0,0,0],[5,0,0]]} color="#ff4444" lineWidth={2} />
      <Text position={[5.3, 0, 0]} fontSize={0.4} color="#ff4444" fontWeight="bold">X</Text>
      {/* Y: math-forward → Three.js +Z (into screen). Draw as (0, 0, +5) */}
      <Line points={[[0,0,0],[0,0,5]]} color="#44ff44" lineWidth={2} />
      <Text position={[0, 0, 5.3]} fontSize={0.4} color="#44ff44" fontWeight="bold">Y</Text>
      {/* Z: UP → Three.js +Y. Math-Z (up) = Three-Y (up) */}
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

const Interactive3DViewer = ({ description }) => {
  const geoData = useMemo(() => parseGeometry(description), [description]);

  if (geoData.points.length < 2) {
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
      <Canvas camera={{ position: [5, 6, 8], fov: 55 }} style={{ background: '#1a1a2e' }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[8, 10, 4]} intensity={1.0} />
        <directionalLight position={[-4, -2, -4]} intensity={0.4} />
        <GridPlane />
        <Axes />
        <ThreeGeometry geoData={geoData} />
        <OrbitControls enableDamping dampingFactor={0.1} minDistance={2} maxDistance={30} />
      </Canvas>
      <div style={{
        padding: '10px 16px', backgroundColor: '#111122',
        borderTop: '1px solid #2a2a4a', color: '#aaa', fontSize: '13px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>Drag to rotate | Scroll to zoom | Right-drag to pan</span>
      </div>
    </div>
  );
};

export default Interactive3DViewer;
