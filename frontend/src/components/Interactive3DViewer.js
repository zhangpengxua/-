import { useEffect, useRef, useState } from 'react';

const Interactive3DViewer = ({ shapeInfo }) => {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const rotationRef = useRef({ x: 0.3, y: 0.5 });
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const animationRef = useRef(null);
  const [autoRotate, setAutoRotate] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // 3D投影函数
    const project = (x, y, z) => {
      const scale = 200;
      const cx = width / 2;
      const cy = height / 2;
      const f = 300; // 焦距
      const scaleZ = f / (f + z);
      return {
        x: cx + x * scale * scaleZ,
        y: cy - y * scale * scaleZ
      };
    };

    // 生成几何体顶点
    const getShapeVertices = () => {
      const shapeType = shapeInfo?.type || 'cube';
      const size = shapeInfo?.dimensions ? parseFloat(shapeInfo.dimensions.split('x')[0]) : 3;
      
      const halfSize = size / 2;
      
      switch (shapeType) {
        case 'sphere':
          return generateSphereVertices(halfSize);
        case 'pyramid':
          return generatePyramidVertices(halfSize);
        case 'cylinder':
          return generateCylinderVertices(halfSize);
        case 'cone':
          return generateConeVertices(halfSize);
        case 'cube':
        default:
          return [
            { x: -halfSize, y: -halfSize, z: -halfSize },
            { x: halfSize, y: -halfSize, z: -halfSize },
            { x: halfSize, y: halfSize, z: -halfSize },
            { x: -halfSize, y: halfSize, z: -halfSize },
            { x: -halfSize, y: -halfSize, z: halfSize },
            { x: halfSize, y: -halfSize, z: halfSize },
            { x: halfSize, y: halfSize, z: halfSize },
            { x: -halfSize, y: halfSize, z: halfSize }
          ];
      }
    };

    const generateSphereVertices = (radius) => {
      const vertices = [];
      const latBands = 15;
      const longBands = 15;
      
      for (let lat = 0; lat <= latBands; lat++) {
        const theta1 = (lat * Math.PI) / latBands;
        for (let lon = 0; lon <= longBands; lon++) {
          const theta2 = (lon * 2 * Math.PI) / longBands;
          vertices.push({
            x: radius * Math.sin(theta1) * Math.cos(theta2),
            y: radius * Math.cos(theta1),
            z: radius * Math.sin(theta1) * Math.sin(theta2)
          });
        }
      }
      return vertices;
    };

    const generatePyramidVertices = (size) => {
      return [
        { x: 0, y: size, z: 0 },           // 顶点
        { x: -size, y: -size, z: -size },   // 底面左下后
        { x: size, y: -size, z: -size },    // 底面右下后
        { x: size, y: -size, z: size },     // 底面右下前
        { x: -size, y: -size, z: size }     // 底面左下前
      ];
    };

    const generateCylinderVertices = (radius) => {
      const vertices = [];
      const sides = 12;
      
      for (let i = 0; i < sides; i++) {
        const angle = (i * 2 * Math.PI) / sides;
        vertices.push({
          x: radius * Math.cos(angle),
          y: -radius,
          z: radius * Math.sin(angle)
        });
        vertices.push({
          x: radius * Math.cos(angle),
          y: radius,
          z: radius * Math.sin(angle)
        });
      }
      return vertices;
    };

    const generateConeVertices = (radius) => {
      const vertices = [];
      const sides = 12;
      
      vertices.push({ x: 0, y: radius, z: 0 }); // 顶点
      
      for (let i = 0; i < sides; i++) {
        const angle = (i * 2 * Math.PI) / sides;
        vertices.push({
          x: radius * Math.cos(angle),
          y: -radius,
          z: radius * Math.sin(angle)
        });
      }
      return vertices;
    };

    // 获取面
    const getFaces = () => {
      const shapeType = shapeInfo?.type || 'cube';
      
      switch (shapeType) {
        case 'sphere':
          return generateSphereFaces();
        case 'pyramid':
          return [
            [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1], // 四个侧面
            [1, 2, 3, 4] // 底面
          ];
        case 'cylinder':
          const cylFaces = [];
          for (let i = 0; i < 12; i++) {
            cylFaces.push([i * 2, (i * 2 + 1) % 24, ((i + 1) * 2 + 1) % 24, ((i + 1) * 2) % 24]);
          }
          // 顶面和底面
          const topFace = [];
          const bottomFace = [];
          for (let i = 0; i < 12; i++) {
            topFace.push(i * 2 + 1);
            bottomFace.push(i * 2);
          }
          cylFaces.push(topFace, bottomFace);
          return cylFaces;
        case 'cone':
          const coneFaces = [];
          for (let i = 0; i < 12; i++) {
            coneFaces.push([0, i + 1, ((i + 1) % 12) + 1]);
          }
          coneFaces.push([...Array.from({ length: 12 }, (_, i) => i + 1)]); // 底面
          return coneFaces;
        case 'cube':
        default:
          return [
            [0, 1, 2, 3], // 后
            [4, 5, 6, 7], // 前
            [0, 4, 7, 3], // 左
            [1, 5, 6, 2], // 右
            [3, 2, 6, 7], // 上
            [0, 1, 5, 4]  // 下
          ];
      }
    };

    const generateSphereFaces = () => {
      const faces = [];
      const latBands = 15;
      const longBands = 15;
      
      for (let lat = 0; lat < latBands; lat++) {
        for (let lon = 0; lon < longBands; lon++) {
          const v1 = lat * (longBands + 1) + lon;
          const v2 = v1 + 1;
          const v3 = v1 + longBands + 1;
          const v4 = v3 + 1;
          faces.push([v1, v2, v4, v3]);
        }
      }
      return faces;
    };

    // 旋转点
    const rotatePoint = (point, rx, ry) => {
      const cosX = Math.cos(rx);
      const sinX = Math.sin(rx);
      const cosY = Math.cos(ry);
      const sinY = Math.sin(ry);
      
      // 绕X轴旋转
      const y1 = point.y * cosX - point.z * sinX;
      const z1 = point.y * sinX + point.z * cosX;
      
      // 绕Y轴旋转
      const x2 = point.x * cosY + z1 * sinY;
      const z2 = -point.x * sinY + z1 * cosY;
      
      return { x: x2, y: y1, z: z2 };
    };

    // 计算面的深度（用于排序）
    const getFaceDepth = (face, vertices, rx, ry) => {
      let avgZ = 0;
      face.forEach(i => {
        const rotated = rotatePoint(vertices[i], rx, ry);
        avgZ += rotated.z;
      });
      return avgZ / face.length;
    };

    // 绘制函数
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      
      const vertices = getShapeVertices();
      const faces = getFaces();
      const rx = rotationRef.current.x;
      const ry = rotationRef.current.y;

      // 绘制网格
      ctx.strokeStyle = 'rgba(100, 100, 150, 0.3)';
      ctx.lineWidth = 1;
      const gridSize = 20;
      const gridCount = 10;
      
      for (let i = -gridCount; i <= gridCount; i++) {
        const pos = project(i * gridSize, 0, 0);
        ctx.beginPath();
        ctx.moveTo(0, pos.y);
        ctx.lineTo(width, pos.y);
        ctx.stroke();
        
        const pos2 = project(0, 0, i * gridSize);
        ctx.beginPath();
        ctx.moveTo(pos2.x, 0);
        ctx.lineTo(pos2.x, height);
        ctx.stroke();
      }

      // 按深度排序面
      const sortedFaces = faces.slice().sort((a, b) => {
        return getFaceDepth(b, vertices, rx, ry) - getFaceDepth(a, vertices, rx, ry);
      });

      // 绘制面
      sortedFaces.forEach((face) => {
        const projectedPoints = face.map(i => {
          const rotated = rotatePoint(vertices[i], rx, ry);
          return project(rotated.x, rotated.y, rotated.z);
        });

        // 计算平均深度用于颜色
        const avgDepth = getFaceDepth(face, vertices, rx, ry);
        const intensity = Math.max(0.3, Math.min(1, 0.7 + avgDepth / 5));
        
        ctx.beginPath();
        ctx.fillStyle = `rgba(100, 150, 255, ${intensity})`;
        ctx.strokeStyle = `rgba(150, 200, 255, ${intensity})`;
        ctx.lineWidth = 2;
        
        ctx.moveTo(projectedPoints[0].x, projectedPoints[0].y);
        for (let i = 1; i < projectedPoints.length; i++) {
          ctx.lineTo(projectedPoints[i].x, projectedPoints[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });

      // 绘制坐标轴
      const axisLength = 4;
      const axes = [
        { x: axisLength, y: 0, z: 0, color: '#ff4444', label: 'X' },
        { x: 0, y: axisLength, z: 0, color: '#44ff44', label: 'Y' },
        { x: 0, y: 0, z: axisLength, color: '#4444ff', label: 'Z' }
      ];

      axes.forEach(axis => {
        const start = project(0, 0, 0);
        const end = rotatePoint(axis, rx, ry);
        const endProj = project(end.x, end.y, end.z);
        
        ctx.beginPath();
        ctx.strokeStyle = axis.color;
        ctx.lineWidth = 3;
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(endProj.x, endProj.y);
        ctx.stroke();
        
        // 箭头
        const angle = Math.atan2(endProj.y - start.y, endProj.x - start.x);
        const arrowSize = 15;
        ctx.beginPath();
        ctx.moveTo(endProj.x, endProj.y);
        ctx.lineTo(
          endProj.x - arrowSize * Math.cos(angle - Math.PI / 6),
          endProj.y - arrowSize * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(endProj.x, endProj.y);
        ctx.lineTo(
          endProj.x - arrowSize * Math.cos(angle + Math.PI / 6),
          endProj.y - arrowSize * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();
        
        // 标签
        ctx.fillStyle = axis.color;
        ctx.font = 'bold 14px Arial';
        ctx.fillText(axis.label, endProj.x + 5, endProj.y - 5);
      });

      if (autoRotate && !isDragging.current) {
        rotationRef.current.y += 0.01;
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    // 鼠标事件处理
    const handleMouseDown = (e) => {
      isDragging.current = true;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e) => {
      if (!isDragging.current) return;
      
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      
      rotationRef.current.y += dx * 0.01;
      rotationRef.current.x += dy * 0.01;
      
      // 限制X轴旋转角度
      rotationRef.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotationRef.current.x));
      
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    const handleMouseLeave = () => {
      isDragging.current = false;
    };

    // 触摸事件处理
    const handleTouchStart = (e) => {
      if (e.touches.length === 1) {
        isDragging.current = true;
        lastMousePos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const handleTouchMove = (e) => {
      if (!isDragging.current || e.touches.length !== 1) return;
      
      const dx = e.touches[0].clientX - lastMousePos.current.x;
      const dy = e.touches[0].clientY - lastMousePos.current.y;
      
      rotationRef.current.y += dx * 0.01;
      rotationRef.current.x += dy * 0.01;
      
      rotationRef.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotationRef.current.x));
      
      lastMousePos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };

    const handleTouchEnd = () => {
      isDragging.current = false;
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('touchstart', handleTouchStart);
    canvas.addEventListener('touchmove', handleTouchMove);
    canvas.addEventListener('touchend', handleTouchEnd);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, [shapeInfo, autoRotate]);

  return (
    <div 
      ref={containerRef} 
      style={{ 
        width: '100%', 
        maxWidth: '600px', 
        margin: '16px auto',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
        backgroundColor: '#1a1a2e'
      }}
    >
      <canvas
        ref={canvasRef}
        width={500}
        height={400}
        style={{ 
          display: 'block',
          cursor: 'grab'
        }}
      />
      <div style={{ 
        padding: '12px', 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTop: '1px solid #2a2a4a'
      }}>
        <div style={{ color: '#888888', fontSize: '14px' }}>
          👆 拖拽旋转视角
        </div>
        <button
          onClick={() => setAutoRotate(!autoRotate)}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: autoRotate ? '#4a9eff' : '#3a3a5a',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: '12px',
            transition: 'background-color 0.2s'
          }}
        >
          {autoRotate ? '⏸ 暂停旋转' : '▶ 自动旋转'}
        </button>
      </div>
    </div>
  );
};

export default Interactive3DViewer;