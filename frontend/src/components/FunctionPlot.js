import React, { useRef, useEffect, useCallback, useState } from 'react';
import { create, all } from 'mathjs';
import { latexToMathJS } from '../utils/latexToMathJS';

const math = create(all, {});

/** 解析函数表达式，自动处理 LaTeX 和纯数学表达式 */
function parseAndCompile(expr) {
  if (!expr) return null;
  return compileExpr(latexToMathJS(String(expr)));
}

/** 预编译表达式以提高性能 */
function compileExpr(expr) {
  try {
    const parsed = math.parse(expr);
    const compiled = parsed.compile();
    return (vars) => compiled.evaluate(vars);
  } catch (e) {
    console.warn('[FunctionPlot] compileExpr 失败:', expr, e.message);
    return null;
  }
}

const FunctionPlot = React.memo(({ drawingData, width = 600, height: availableHeight = 400, onAsk }) => {
  const height = Math.max(160, availableHeight - 106);
  const canvasRef = useRef(null);
  const [hidden,setHidden]=useState([]);
  const [cursor,setCursor]=useState(null);
  useEffect(()=>{setHidden([]);setCursor(null);},[drawingData]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !drawingData) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    const { functions, points, xRange, yRange } = drawingData;
    const xMin = xRange?.[0] ?? -5;
    const xMax = xRange?.[1] ?? 5;
    const yMin = yRange?.[0] ?? -5;
    const yMax = yRange?.[1] ?? 5;

    if (![xMin,xMax,yMin,yMax].every(Number.isFinite) || xMax<=xMin || yMax<=yMin) return;
    const pad = { top: 30, right: 30, bottom: 40, left: 50 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const toX = (x) => pad.left + (x - xMin) / (xMax - xMin) * plotW;
    const toY = (y) => pad.top + (yMax - y) / (yMax - yMin) * plotH;

    // 背景
    ctx.fillStyle = '#f5f8f8';
    ctx.fillRect(0, 0, width, height);

    // 绘图区背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(pad.left, pad.top, plotW, plotH);

    // 网格
    ctx.strokeStyle = '#e5edef';
    ctx.lineWidth = 0.5;
    const xStep = (xMax - xMin) / 10;
    const yStep = (yMax - yMin) / 10;
    for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
      const px = toX(x);
      ctx.beginPath();
      ctx.moveTo(px, pad.top);
      ctx.lineTo(px, pad.top + plotH);
      ctx.stroke();
    }
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
      const py = toY(y);
      ctx.beginPath();
      ctx.moveTo(pad.left, py);
      ctx.lineTo(pad.left + plotW, py);
      ctx.stroke();
    }

    // 坐标轴
    ctx.strokeStyle = '#8aa1aa';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const zeroX = toX(0);
    const zeroY = toY(0);
    if (zeroX >= pad.left && zeroX <= pad.left + plotW) {
      ctx.moveTo(zeroX, pad.top);
      ctx.lineTo(zeroX, pad.top + plotH);
    }
    if (zeroY >= pad.top && zeroY <= pad.top + plotH) {
      ctx.moveTo(pad.left, zeroY);
      ctx.lineTo(pad.left + plotW, zeroY);
    }
    ctx.stroke();

    // 刻度标签
    ctx.fillStyle = '#708792';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
      ctx.fillText(x.toFixed(xStep < 1 ? 1 : 0), toX(x), pad.top + plotH + 18);
    }
    ctx.textAlign = 'right';
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
      ctx.fillText(y.toFixed(yStep < 1 ? 1 : 0), pad.left - 8, toY(y) + 4);
    }

    // 绘制函数曲线
    const funcs = functions || [];
    const colors = ['#087f8c', '#b88728', '#697bb0', '#699766', '#b47889', '#b98654'];
    const N = 800;

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, plotW, plotH);
    ctx.clip();

    funcs.forEach((func, idx) => {
      if(hidden.includes(idx)) return;
      const compiled = parseAndCompile(func.expr);
      if (!compiled) return;

      const color = func.color || colors[idx % colors.length];
      const lineStyle = func.lineStyle || '-';

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      if (lineStyle === '--') ctx.setLineDash([6, 4]);
      else if (lineStyle === ':') ctx.setLineDash([2, 4]);
      else ctx.setLineDash([]);

      ctx.beginPath();
      let firstPoint = true;
      for (let i = 0; i <= N; i++) {
        const x = xMin + (xMax - xMin) * i / N;
        try {
          const scope = { x };
          const y = compiled(scope);
          if (typeof y === 'number' && isFinite(y) && !isNaN(y)) {
            const px = toX(x);
            const py = toY(y);
            if (firstPoint) {
              ctx.moveTo(px, py);
              firstPoint = false;
            } else {
              ctx.lineTo(px, py);
            }
          } else {
            firstPoint = true;
          }
        } catch (e) {
          firstPoint = true;
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.restore();

    // 绘制关键点
    if (points) {
      points.forEach((p) => {
        const px = toX(p.x);
        const py = toY(p.y);
        ctx.fillStyle = '#d39b32';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = '#35545f';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.name || '', px, py - 10);
      });
    }

  }, [drawingData, width, height, hidden]);

  useEffect(() => {
    draw();
  }, [draw]);

  if (!drawingData) return null;

  return (
    <div className="generated-plot">
      <div className="generated-scene-toolbar"><span>点击切换曲线</span>{(drawingData.functions||[]).map((f,i)=><button key={i} aria-pressed={!hidden.includes(i)} onClick={()=>setHidden(prev=>prev.includes(i)?prev.filter(n=>n!==i):[...prev,i])}>{f.label||f.name||f.expr}</button>)}</div>
      <canvas
        ref={canvasRef}
        aria-label="交互函数图像"
        onPointerMove={e=>{const r=e.currentTarget.getBoundingClientRect();const px=(e.clientX-r.left)/r.width*width,py=(e.clientY-r.top)/r.height*height;if(px<50||px>width-30||py<30||py>height-40){setCursor(null);return;}const xr=drawingData.xRange||[-5,5],yr=drawingData.yRange||[-5,5];setCursor({x:xr[0]+(px-50)/(width-80)*(xr[1]-xr[0]),y:yr[1]-(py-30)/(height-70)*(yr[1]-yr[0])});}}
        style={{ maxWidth: '100%', display:'block', cursor:'crosshair' }}
      />
      <div className="generated-scene-footer">{cursor ? <><span>光标坐标 ({cursor.x.toFixed(2)}, {cursor.y.toFixed(2)})</span>{onAsk&&<button onClick={()=>onAsk(`请解释当前函数图像在 (${cursor.x.toFixed(2)}, ${cursor.y.toFixed(2)}) 附近的变化。`)}>针对这里追问</button>}</> : <span>移动鼠标查看坐标 · 点击曲线名称对比观察</span>}</div>
    </div>
  );
});

export default FunctionPlot;
