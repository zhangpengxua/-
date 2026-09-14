import axios from 'axios';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
const client = axios.create({ baseURL: `${API}/learning`, timeout: 15000 });

// 统一错误形状：{code, message, retryable, details, status}
function normalizeError(e) {
  const data = e?.response?.data;
  if (data?.error) return { ...data.error, status: e.response.status };
  if (axios.isCancel(e)) return { code: 'CANCELLED', message: '请求已取消', retryable: false, details: null, status: 0 };
  return {
    code: 'NETWORK',
    message: e?.message === 'Network Error' ? '无法连接后端，请确认服务已启动' : (e?.message || '请求失败'),
    retryable: true,
    details: null,
    status: e?.response?.status || 0,
  };
}

async function request(config) {
  try {
    const { data } = await client.request(config);
    return data;
  } catch (e) {
    throw normalizeError(e);
  }
}

export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const learningApi = {
  getHistory: (params) => request({ url: '/history', params }),
  createAnalysis: (body) => request({ url: '/analyses', method: 'post', data: body }),
  listAnalyses: (params) => request({ url: '/analyses', params }),
  getAnalysis: (id) => request({ url: `/analyses/${id}` }),
  deleteAnalysis: (id) => request({ url: `/analyses/${id}`, method: 'delete' }),
  getJob: (id) => request({ url: `/jobs/${id}` }),
  cancelJob: (id) => request({ url: `/jobs/${id}/cancel`, method: 'post' }),
  createPractice: (body) => request({ url: '/practice-sessions', method: 'post', data: body }),
  listPracticeSessions: (params) => request({ url: '/practice-sessions', params }),
  getPracticeSession: (id) => request({ url: `/practice-sessions/${id}` }),
  deletePracticeSession: (id) => request({ url: `/practice-sessions/${id}`, method: 'delete' }),
  saveDraft: (sessionId, body) => request({ url: `/practice-sessions/${sessionId}/draft`, method: 'patch', data: body }),
  requestHint: (sessionId, questionId) => request({ url: `/practice-sessions/${sessionId}/questions/${questionId}/hint`, method: 'post' }),
  revealAnswer: (sessionId, questionId) => request({ url: `/practice-sessions/${sessionId}/questions/${questionId}/reveal`, method: 'post' }),
  submitAttempt: (sessionId, body) => request({ url: `/practice-sessions/${sessionId}/attempts`, method: 'post', data: body, timeout: 30000 }),
  getAttempt: (id) => request({ url: `/attempts/${id}` }),
  retryGrading: (id) => request({ url: `/attempts/${id}/retry-grading`, method: 'post' }),
  disputeAttempt: (id, body) => request({ url: `/attempts/${id}/dispute`, method: 'post', data: body }),
  getSessionResult: (id) => request({ url: `/practice-sessions/${id}/result` }),
};

export default learningApi;
