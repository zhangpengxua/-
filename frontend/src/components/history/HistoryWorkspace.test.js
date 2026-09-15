import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import HistoryWorkspace from './HistoryWorkspace';
import learningApi from '../../api/learningApi';

jest.mock('../../api/learningApi', () => ({
  __esModule: true, uuid: () => 'request-key',
  default: {
    getHistory: jest.fn(), listAnalyses: jest.fn(), getAnalysis: jest.fn(),
    listPracticeSessions: jest.fn(), createPractice: jest.fn(), createAnalysis: jest.fn(),
  },
}));
jest.mock('../MathMarkdown', () => ({ children }) => <span>{children}</span>);
jest.mock('./PracticeSession', () => () => null);
jest.mock('./PracticeResult', () => () => null);
jest.mock('../../hooks/useLearningJobs', () => {
  const jobs = { poll: jest.fn(), cancel: jest.fn() };
  return () => jobs;
});

let root, container;
const report = {
  id: 'report-1', createdAt: new Date().toISOString(), scope: { conversationIds: ['conv-1'] },
  summary: '已有的分析结果', evidence: [], limitations: [],
  knowledgePoints: [{ id: 'math.test', name: '测试知识点', assessment: 'review_suggestion', evidenceRefs: [], performance: {} }],
};
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  learningApi.getHistory.mockResolvedValue({ items: [{ id: 'conv-1', title: '历史题目', analyzable: true }] });
  learningApi.listAnalyses.mockResolvedValue({ items: [report] });
  learningApi.getAnalysis.mockResolvedValue(report);
  learningApi.listPracticeSessions.mockResolvedValue({ items: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete global.IS_REACT_ACT_ENVIRONMENT;
});
const render = () => act(async () => { root.render(<HistoryWorkspace />); });
async function click(text) {
  const button = [...container.querySelectorAll('button')].find((el) => el.textContent.includes(text));
  expect(button).toBeDefined();
  await act(async () => button.click());
}

test('reopening history restores the latest API report', async () => {
  await render();
  await click('薄弱点分析');
  expect(learningApi.getAnalysis).toHaveBeenCalledWith('report-1');
  expect(container.textContent).toContain('已有的分析结果');
});

test('practice creation failures are visible on the active practice tab', async () => {
  learningApi.createPractice.mockRejectedValue({ message: '模型认证失败，请检查 API 配置' });
  await render();
  await click('薄弱点分析');
  await act(async () => container.querySelector('input[type="checkbox"]').click());
  await click('生成专项训练');
  await act(async () => container.querySelector('input[type="checkbox"]').click());
  await click('开始生成');
  expect(learningApi.createPractice).toHaveBeenCalledWith(expect.objectContaining({ analysisId: 'report-1', knowledgePointIds: ['math.test'] }));
  expect(container.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe('专项训练');
  expect(container.querySelector('[role="alert"]').textContent).toContain('模型认证失败');
});

test('analysis creation failures are visible without switching tabs', async () => {
  learningApi.createAnalysis.mockRejectedValue({ message: '无法连接后端' });
  await render();
  await click('分析所选记录');
  expect(container.querySelector('[role="alert"]').textContent).toContain('无法连接后端');
});
