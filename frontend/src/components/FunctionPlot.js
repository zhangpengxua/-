import React, { useRef, useEffect, useCallback } from 'react';
import { create, all } from 'mathjs';

const math = create(all, {});

// 解析函数表达式，支持多种格式
function parseFunctionExpr(expr) {
  if (!expr) return { expr: 'x', type: 'explicit' };
  // 处理 z = f(x,y) 格式
  const zMatch = expr.match(/^z\s*=\s*(.+?)$/);
  if (zMatch) return { expr: zMatch[1], type: 'explicit', vars: ['x', 'y'] };
  // 处理 y = f(x) 格式
  const yMatch = expr.match(/^y\s*=\s*(.+?)$/);
  if (yMatch) return { expr: yMatch[1], type: 'explicit', vars: ['x'] };
  // 处理 f(x) = ... 格式
  const fMatch = expr.match(/^f\(x\)\s*=\s*(.+?)$/);
  if (fMatch) return { expr: fMatch[1], type: 'explicit', vars: ['x'] };
  return { expr, type: 'explicit', vars: ['x'] };
}

// 预编译表达式以提高性能
function compileExpr(expr) {
  try {
    const parsed = math.parse(expr);
    const compiled = parsed.compile();
    return (vars) => compiled.evaluate(vars);
  } catch (e) {
    return null;
  }
}

const FunctionPlot = React.memo(({ drawingData, width = 600, height = 400 }) => {
  const canvasRef = useRef(null);

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
    const xMin = (xRange && xRange[0]) || -5;
    const xMax = (xRange && xRange[1]) || 5;
    const yMin = (yRange && yRange[0]) || -5;
    const yMax = (yRange && yRange[1]) || 5;

    const pad = { top: 30, right: 30, bottom: 40, left: 50 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const toX = (x) => pad.left + (x - xMin) / (xMax - xMin) * plotW;
    const toY = (y) => pad.top + (yMax - y) / (yMax - yMin) * plotH;

    // 背景
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // 绘图区背景
    ctx.fillStyle = '#16213e';
    ctx.fillRect(pad.left, pad.top, plotW, plotH);

    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
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
    ctx.strokeStyle = '#aaa';
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
    ctx.fillStyle = '#888';
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
    const colors = ['#4fc3f7', '#ff8a65', '#81c784', '#ffd54f', '#ce93d8', '#ef5350'];
    const N = 800;

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, plotW, plotH);
    ctx.clip();

    funcs.forEach((func, idx) => {
      const parsed = parseFunctionExpr(func.expr);
      const compiled = compileExpr(parsed.expr);
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
        ctx.fillStyle = '#ff5252';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.name || '', px, py - 10);
      });
    }

    // 图例
    if (funcs.length > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const legendH = funcs.length * 20 + 10;
      ctx.fillRect(pad.left + 10, pad.top + 10, 140, legendH);
      ctx.font = '12px sans-serif';
      funcs.forEach((func, idx) => {
        const color = func.color || colors[idx % colors.length];
        const label = func.label || func.expr;
        ctx.fillStyle = color;
        ctx.fillRect(pad.left + 18, pad.top + 20 + idx * 20, 20, 3);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.fillText(label, pad.left + 44, pad.top + 26 + idx * 20);
      });
    }
  }, [drawingData, width, height]);

  useEffect(() => {
    draw();
  }, [draw]);

  if (!drawingData) return null;

  return (
    <div style={{ marginBottom: 12, textAlign: 'center' }}>
      <canvas
        ref={canvasRef}
        style={{ maxWidth: '100%', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}
      />
    </div>
  );
});

export default FunctionPlot;