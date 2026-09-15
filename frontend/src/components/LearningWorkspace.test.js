import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import LearningWorkspace from './LearningWorkspace';

jest.mock('@react-three/fiber', () => ({ Canvas: () => null }));
jest.mock('@react-three/drei', () => ({ Html: () => null, Line: () => null, OrbitControls: () => null }));
jest.mock('./Interactive3DViewer', () => () => <div data-testid="geometry">三维图形</div>);
jest.mock('./FunctionPlot', () => () => <div data-testid="plot">函数图形</div>);
jest.mock('./InputArea', () => () => null);
jest.mock('./MathMarkdown', () => ({ children }) => <span>{children}</span>);
jest.mock('./history/HistoryWorkspace', () => () => null);

const drawingData = { functions: [{ expr: 'x^2' }] };
const visible = { description: '观察函数', needImage: true, imageType: 'MATH_STATIC_EQUATION', drawingData };
let root, container, observers;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  observers = [];
  global.ResizeObserver = class {
    constructor() { this.observe = jest.fn(); this.disconnect = jest.fn(); observers.push(this); }
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete global.ResizeObserver;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});
const props = (steps) => ({ conversations: [], onNew: async () => ({}),
  currentConversation: { _id: 'c1', messages: [{ role: 'user', content: '测试题目' }, { role: 'assistant', stepResults: steps }] } });
async function click(text) {
  await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text)).click());
}
async function showProblem(steps) {
  await act(async () => root.render(<LearningWorkspace {...props(steps)} />));
  await click('新建题目');
  await act(async () => container.querySelector('[aria-label="关闭题目编辑"]').click());
}

test.each([
  { ...visible, needImage: false },
  { ...visible, imageType: 'NO_IMAGE' },
  { ...visible, drawingData: {} },
  { ...visible, drawingData: null },
])('无图标记或空数据收起右栏，不挂载图形组件 %#', async (step) => {
  await showProblem([step]);
  expect(container.querySelector('.scene-column')).toBeNull();
  expect(container.querySelector('[role="separator"]')).toBeNull();
  expect(container.querySelector('.sync-chip')).toBeNull();
  expect(container.querySelector('.panels').classList.contains('no-scene')).toBe(true);
  expect(container.querySelector('.study-panel').textContent).toContain('观察函数');
});

test('有图到无图再返回，恢复图形与尺寸监听', async () => {
  await showProblem([visible, { description: '纯文字推理', needImage: false }]);
  expect(container.querySelector('[data-testid="plot"]')).not.toBeNull();
  const observer = observers.at(-1);
  await click('下一步');
  expect(container.querySelector('.scene-column')).toBeNull();
  expect(observer.disconnect).toHaveBeenCalled();
  await click('上一步');
  expect(container.querySelector('[data-testid="plot"]')).not.toBeNull();
  expect(observers.at(-1)).not.toBe(observer);
  expect(observers.at(-1).observe).toHaveBeenCalled();
});

test('放大场景后进入无图题目，解题区不会被放大状态隐藏', async () => {
  await showProblem([visible]);
  await act(async () => container.querySelector('[aria-label="放大场景"]').click());
  expect(container.querySelector('.panels').classList.contains('scene-wide')).toBe(true);
  await act(async () => root.render(<LearningWorkspace {...props([{ description: '文字解答', needImage: false }])} />));
  expect(container.querySelector('.panels').classList.contains('scene-wide')).toBe(false);
  expect(container.querySelector('.panels').classList.contains('no-scene')).toBe(true);
  await act(async () => root.render(<LearningWorkspace {...props([visible])} />));
  expect(container.querySelector('.scene-column')).not.toBeNull();
  expect(container.querySelector('.panels').classList.contains('scene-wide')).toBe(false);
});
