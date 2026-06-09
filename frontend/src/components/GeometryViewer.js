import { useEffect, useRef } from 'react';

function GeometryViewer({ shapeInfo }) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    let rotation = 0;

    const drawShape = () => {
      ctx.clearRect(0, 0, rect.width, rect.height);
      
      ctx.save();
      ctx.translate(rect.width / 2, rect.height / 2);
      ctx.rotate(rotation);

      const size = Math.min(rect.width, rect.height) * 0.3;

      ctx.strokeStyle = '#4ec9b0';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(78, 201, 176, 0.1)';

      if (shapeInfo.type === 'cube' || !shapeInfo.type) {
        drawCube(ctx, size);
      } else if (shapeInfo.type === 'sphere') {
        drawSphere(ctx, size);
      } else if (shapeInfo.type === 'pyramid') {
        drawPyramid(ctx, size);
      } else if (shapeInfo.type === 'cylinder') {
        drawCylinder(ctx, size);
      } else if (shapeInfo.type === 'cone') {
        drawCone(ctx, size);
      } else {
        drawCube(ctx, size);
      }

      ctx.restore();
      rotation += 0.01;
      animationRef.current = requestAnimationFrame(drawShape);
    };

    drawShape();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [shapeInfo]);

  const drawCube = (ctx, size) => {
    const d = size / 2;
    
    ctx.beginPath();
    ctx.moveTo(-d, -d);
    ctx.lineTo(d, -d);
    ctx.lineTo(d, d);
    ctx.lineTo(-d, d);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-d, -d);
    ctx.lineTo(-d * 0.7, -d * 1.2);
    ctx.lineTo(d * 0.7, -d * 1.2);
    ctx.lineTo(d, -d);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(d, -d);
    ctx.lineTo(d * 0.7, -d * 1.2);
    ctx.lineTo(d * 0.7, d * 0.8);
    ctx.lineTo(d, d);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };

  const drawSphere = (ctx, size) => {
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(0, 0, size, size * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(0, 0, size, size * 0.5, Math.PI / 2, 0, Math.PI * 2);
    ctx.stroke();
  };

  const drawPyramid = (ctx, size) => {
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.8, size * 0.6);
    ctx.lineTo(-size * 0.8, size * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(size * 0.8, size * 0.6);
    ctx.lineTo(0, size * 0.2);
    ctx.lineTo(-size * 0.8, size * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };

  const drawCylinder = (ctx, size) => {
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.5, size * 0.6, size * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(0, size * 0.5, size * 0.6, size * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-size * 0.6, -size * 0.5);
    ctx.lineTo(-size * 0.6, size * 0.5);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(size * 0.6, -size * 0.5);
    ctx.lineTo(size * 0.6, size * 0.5);
    ctx.stroke();
  };

  const drawCone = (ctx, size) => {
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.8, size * 0.6);
    ctx.lineTo(-size * 0.8, size * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(0, size * 0.6, size * 0.8, size * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };

  return (
    <>
      <div style={{ padding: '8px 12px', backgroundColor: '#1e1e1e', borderRadius: '6px', marginBottom: '8px' }}>
        <div style={{ fontSize: '14px', fontWeight: '600', color: '#4ec9b0', marginBottom: '4px' }}>三维几何图形</div>
        <div style={{ fontSize: '12px', color: '#888888' }}>
          形状类型: {shapeInfo.type || '立方体'}
          {shapeInfo.dimensions && (
            <span style={{ marginLeft: '12px' }}>尺寸: {shapeInfo.dimensions}</span>
          )}
          {shapeInfo.properties && (
            <span style={{ marginLeft: '12px' }}>属性: {shapeInfo.properties}</span>
          )}
        </div>
      </div>
      <div style={{ width: '100%', height: '200px', backgroundColor: '#0d1117', borderRadius: '8px', marginBottom: '12px', overflow: 'hidden' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </>
  );
}

export default GeometryViewer;
