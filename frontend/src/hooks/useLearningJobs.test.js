import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import learningApi from '../api/learningApi';
import useLearningJobs from './useLearningJobs';

jest.mock('../api/learningApi', () => ({
  __esModule: true,
  default: { getJob: jest.fn(), cancelJob: jest.fn() },
}));

let root;
let container;
let jobs;
function Harness() { jobs = useLearningJobs(); return null; }

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  if (root) act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test('polling survives StrictMode effect cleanup and reports completion', async () => {
  learningApi.getJob.mockResolvedValue({ id: 'job-1', status: 'completed', result: { analysisId: 'a-1' } });
  act(() => root.render(<StrictMode><Harness /></StrictMode>));
  const completed = jest.fn();
  jobs.poll('job-1', { onCompleted: completed });
  await act(async () => { jest.advanceTimersByTime(300); });
  expect(learningApi.getJob).toHaveBeenCalledWith('job-1');
  expect(completed).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
});

test('unmount clears a pending poll', async () => {
  act(() => root.render(<StrictMode><Harness /></StrictMode>));
  jobs.poll('job-2');
  act(() => root.unmount());
  root = null;
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(learningApi.getJob).not.toHaveBeenCalled();
});
