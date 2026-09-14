// 全局唯一的内存对话数据源。
// conversations 路由与学习分析共用这里的数据；禁止在路由内另复制一份消息数组，
// 也禁止通过 HTTP 回调自身接口获取对话正文。
const crypto = require('crypto');

const conversations = [];
let conversationIdCounter = 1;
const listeners = new Set();

const MESSAGE_KINDS = ['question', 'followup', 'assistant_answer'];
const MESSAGE_STATUSES = ['pending', 'completed', 'failed', 'aborted', 'fallback'];
const CONVERSATION_SOURCES = ['user_problem', 'demo', 'legacy_unknown'];

function uuid() {
  return crypto.randomUUID();
}

function newMessageId() {
  return 'msg_' + uuid();
}

function emit(event, payload) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (e) {
      console.error('[conversationRepository] listener failed:', e.message);
    }
  }
}

// 订阅对话变化事件：changed（revision 递增）/ deleted / created。
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 旧数据补齐：首次读取时补 ID/kind/status/metadata，补完保留，不重复生成。
function ensureConversationShape(conv) {
  if (!conv.revision || !Number.isInteger(conv.revision) || conv.revision < 1) conv.revision = 1;
  if (!CONVERSATION_SOURCES.includes(conv.source)) conv.source = 'legacy_unknown';
  if (!('linkedPracticeSessionId' in conv)) conv.linkedPracticeSessionId = null;
  if (!Array.isArray(conv.messages)) conv.messages = [];
  let firstUserSeen = false;
  for (const m of conv.messages) {
    if (!m._id) m._id = newMessageId();
    if (!(m.timestamp instanceof Date)) m.timestamp = m.timestamp ? new Date(m.timestamp) : new Date();
    if (m.role === 'user') {
      if (!MESSAGE_KINDS.includes(m.kind)) m.kind = firstUserSeen ? 'followup' : 'question';
      firstUserSeen = true;
      if (!MESSAGE_STATUSES.includes(m.status)) m.status = 'completed';
    } else {
      m.role = 'assistant';
      if (!MESSAGE_KINDS.includes(m.kind)) m.kind = 'assistant_answer';
      if (!MESSAGE_STATUSES.includes(m.status)) m.status = 'completed';
    }
    if (!m.metadata || typeof m.metadata !== 'object') m.metadata = {};
    if (!CONVERSATION_SOURCES.includes(m.metadata.source)) m.metadata.source = conv.source;
    if (!('studentQuestion' in m.metadata)) m.metadata.studentQuestion = null;
    if (!('activeStepId' in m.metadata)) m.metadata.activeStepId = null;
  }
  return conv;
}

function listConversationSummaries() {
  return conversations
    .map((c) => ({ _id: c._id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function getConversation(id) {
  const conv = conversations.find((c) => c._id === id);
  return conv ? ensureConversationShape(conv) : null;
}

function requireConversation(id) {
  const conv = getConversation(id);
  if (!conv) {
    const { ApiError } = require('../utils/apiError');
    throw new ApiError('NOT_FOUND', `对话 ${id} 不存在（可能服务已重启或已被删除）`);
  }
  return conv;
}

function createConversation({ title = '未命名对话', source = 'user_problem' } = {}) {
  const conv = {
    _id: 'conv_' + conversationIdCounter++,
    title,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    revision: 1,
    source: CONVERSATION_SOURCES.includes(source) ? source : 'user_problem',
    linkedPracticeSessionId: null,
  };
  conversations.push(conv);
  emit('created', { conversationId: conv._id });
  return conv;
}

// 两个消息入口（同步 + SSE）统一经这里写入；用户消息默认 status=completed，
// 仅表示提交状态，不表示答题对错。
function appendUserMessage(conv, { content, imageUrl = null, ocrText = null, kind = 'question', source, studentQuestion = null, activeStepId = null, status = 'completed' }) {
  const msgSource = CONVERSATION_SOURCES.includes(source) ? source : (conv.source === 'legacy_unknown' ? 'user_problem' : conv.source);
  // 会话第一条消息决定会话来源（如示例追问创建的会话标记为 demo）。
  const isFirstMessage = conv.messages.length === 0;
  if (isFirstMessage && CONVERSATION_SOURCES.includes(source)) conv.source = msgSource;
  const message = {
    role: 'user',
    content,
    imageUrl: imageUrl || null,
    ocrText: ocrText || null,
    timestamp: new Date(),
    _id: newMessageId(),
    kind: MESSAGE_KINDS.includes(kind) ? kind : 'question',
    status: MESSAGE_STATUSES.includes(status) ? status : 'completed',
    metadata: {
      studentQuestion: studentQuestion || null,
      activeStepId: activeStepId === undefined ? null : activeStepId,
      source: msgSource,
    },
  };
  conv.messages.push(message);
  conv.revision += 1;
  conv.updatedAt = new Date();
  emit('changed', { conversationId: conv._id, revision: conv.revision });
  return message;
}

function appendAssistantMessage(conv, { content, stepResults = [], images = [], status = 'completed' }) {
  const message = {
    role: 'assistant',
    content,
    images: images || [],
    stepResults: stepResults || [],
    timestamp: new Date(),
    _id: newMessageId(),
    kind: 'assistant_answer',
    status: MESSAGE_STATUSES.includes(status) ? status : 'completed',
    metadata: { studentQuestion: null, activeStepId: null, source: conv.source },
  };
  conv.messages.push(message);
  conv.revision += 1;
  conv.updatedAt = new Date();
  emit('changed', { conversationId: conv._id, revision: conv.revision });
  return message;
}

// 标题变化不触发学习内容 revision，只改标题。
function renameConversation(conv, title) {
  conv.title = title;
  return conv;
}

function touchConversation(conv) {
  conv.updatedAt = new Date();
  return conv;
}

function deleteConversation(id) {
  const idx = conversations.findIndex((c) => c._id === id);
  if (idx === -1) return false;
  conversations.splice(idx, 1);
  emit('deleted', { conversationId: id });
  return true;
}

function countConversations() {
  return conversations.length;
}

// 仅供自动化测试复位内存状态。
function __resetForTests() {
  conversations.length = 0;
  conversationIdCounter = 1;
}

module.exports = {
  MESSAGE_KINDS,
  MESSAGE_STATUSES,
  CONVERSATION_SOURCES,
  subscribe,
  listConversationSummaries,
  getConversation,
  requireConversation,
  createConversation,
  appendUserMessage,
  appendAssistantMessage,
  renameConversation,
  touchConversation,
  deleteConversation,
  countConversations,
  __resetForTests,
};
