import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FunctionPlot from './FunctionPlot';

jest.mock('mathjs', () => ({ all: {}, create: () => ({ parse: () => ({ compile: () => ({ evaluate: ({ x }) => x }) }) }) }));
let root, container;
const data = { functions: [{ expr: 'x', label: '直线' }], xRange: [0, 4], yRange: [0, 4] };
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const context = new Proxy({}, { get: (target, key) => target[key] || (target[key] = jest.fn()) });
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  jest.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 294 });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.restoreAllMocks();
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test('切换曲线显隐，恢复组件后重新显示曲线', async () => {
  await act(async () => root.render(<FunctionPlot drawingData={data} width={400} height={400} />));
  const button = container.querySelector('button');
  expect(button.getAttribute('aria-pressed')).toBe('true');
  await act(async () => button.click());
  expect(button.getAttribute('aria-pressed')).toBe('false');
  await act(async () => root.render(<FunctionPlot drawingData={{ ...data }} width={400} height={400} />));
  expect(button.getAttribute('aria-pressed')).toBe('true');
});

test('坐标范围从零开始时正确显示光标位置，并可带入追问', async () => {
  const ask = jest.fn();
  await act(async () => root.render(<FunctionPlot drawingData={data} width={400} height={400} onAsk={ask} />));
  await act(async () => container.querySelector('canvas').dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 210, clientY: 142 })));
  expect(container.textContent).toContain('光标坐标 (2.00, 2.00)');
  await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent === '针对这里追问').click());
  expect(ask).toHaveBeenCalledWith(expect.stringContaining('(2.00, 2.00)'));
});
