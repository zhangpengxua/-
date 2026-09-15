// 明确的无图标记优先于残留绘图数据；空对象不是可视化结果。
export function hasStepVisualization(step) {
  if (!step || step.needImage === false || step.needImage === 'false' ||
      String(step.imageType || '').toUpperCase() === 'NO_IMAGE') return false;
  const data = step.drawingData;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const nonempty = (key) => Array.isArray(data[key]) && data[key].length > 0;
  if (step.is2DPlot || ['MATH_STATIC_EQUATION', 'MATH_STATIC_2D_FUNCTION'].includes(step.imageType)) {
    return nonempty('functions');
  }
  return nonempty('functions') || nonempty('planes') ||
    (Array.isArray(data.points) && data.points.length >= 2) ||
    (typeof data.surfaceEquation === 'string' && Boolean(data.surfaceEquation.trim()));
}
