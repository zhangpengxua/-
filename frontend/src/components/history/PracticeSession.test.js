import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PracticeSession from './PracticeSession';
import learningApi from '../../api/learningApi';

jest.mock('../../api/learningApi', () => ({ __esModule: true, uuid: () => 'key', default: { revealAnswer: jest.fn() } }));
jest.mock('../MathMarkdown', () => ({ children }) => <span>{children}</span>);
jest.mock('../../hooks/useLearningJobs', () => () => ({ poll: jest.fn() }));

const release = { canonical: '2cos(2x)', explanation: '外层导数乘以内层导数2。' };
const question = { id: 'q1', type: 'fill_blank', knowledgePointIds: ['math.chain'], stem: '求 sin(2x) 的导数', hints: [], hintsAvailable: 1, revealed: false };
let root, container, onSessionUpdate;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  learningApi.revealAnswer.mockResolvedValue({ ...release, revealed: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onSessionUpdate = jest.fn();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.restoreAllMocks();
  delete global.IS_REACT_ACT_ENVIRONMENT;
});
const render = (questions = [question]) => act(async () => {
  root.render(<PracticeSession session={{ id: 's1', difficulty: 'basic', questions }} onSessionUpdate={onSessionUpdate} />);
});
const click = (label) => act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label)).click());

test('未提交时直接揭晓立即显示答案和解析，不依赖训练刷新', async () => {
  await render();
  expect(container.querySelector('.release-box')).toBeNull();
  await click('直接看答案');
  expect(learningApi.revealAnswer).toHaveBeenCalledWith('s1', 'q1');
  expect(container.querySelector('.release-box').textContent).toContain(release.canonical);
  expect(container.querySelector('.release-box').textContent).toContain(release.explanation);
  expect(container.textContent).toContain('辅助练习');
  expect(container.textContent).not.toContain('直接看答案');
});

test('重新打开训练读取服务端已揭晓答案', async () => {
  await render([{ ...question, revealed: true, answerRelease: release }]);
  expect(container.querySelector('.release-box').textContent).toContain(release.canonical);
  expect(learningApi.revealAnswer).not.toHaveBeenCalled();
});

test('切换题目不泄漏另一题答案，返回时保留已揭晓内容', async () => {
  await render([question, { ...question, id: 'q2' }]);
  await click('直接看答案');
  await click('下一题');
  expect(container.querySelector('.release-box')).toBeNull();
  await click('上一题');
  expect(container.querySelector('.release-box').textContent).toContain(release.canonical);
});

test('揭晓失败保留重试入口，不伪装已揭晓', async () => {
  learningApi.revealAnswer.mockRejectedValue({ message: '网络连接失败' });
  await render();
  await click('直接看答案');
  expect(container.querySelector('[role="alert"]').textContent).toContain('网络连接失败');
  expect(container.querySelector('.release-box')).toBeNull();
  expect(container.textContent).toContain('直接看答案');
});
