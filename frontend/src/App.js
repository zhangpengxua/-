import { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { ThemeContext } from './theme';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import InputArea from './components/InputArea';

const API_BASE_URL = 'http://localhost:5000/api';

function SetupGuide({ checks, onDismiss, theme }) {
  const okCount = checks.filter(c => c.ok).length;
  const total = checks.length;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000,
      backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        backgroundColor: theme.colors.canvas, borderRadius: theme.rounded.xl,
        padding: '32px', maxWidth: '580px', width: '90%',
        boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
        fontFamily: theme.typography.bodyMd.fontFamily,
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ ...theme.typography.displaySm, color: theme.colors.ink, margin: 0 }}>
            环境检测 ({okCount}/{total})
          </h2>
          <span style={{ fontSize: '32px' }}>
            {okCount === total ? '✅' : '⚠️'}
          </span>
        </div>

        <div style={{ marginBottom: '16px' }}>
          {checks.map((c, i) => (
            <div key={i} style={{
              padding: '12px',
              marginBottom: '8px',
              borderRadius: theme.rounded.md,
              border: `1px solid ${c.ok ? '#4caf50' : '#ff6b6b'}`,
              backgroundColor: c.ok ? '#f0faf0' : '#fff5f5',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px', marginBottom: c.ok ? 0 : '8px',
                fontWeight: 600, color: c.ok ? '#2e7d32' : '#c62828',
              }}>
                <span>{c.ok ? '✓' : '✗'}</span>
                <span>{c.name}</span>
                <span style={{ fontSize: '12px', color: '#888', fontWeight: 400 }}>{c.detail}</span>
              </div>
              {!c.ok && (
                <div style={{
                  backgroundColor: '#fff', padding: '10px', borderRadius: theme.rounded.sm,
                  fontSize: '13px', color: '#333', borderLeft: '3px solid #ff6b6b',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  <strong>修复方法：</strong><br/>{c.fix}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{
          padding: '12px', borderRadius: theme.rounded.md,
          backgroundColor: okCount === total ? '#e8f5e9' : '#fff3e0',
          marginBottom: '20px',
        }}>
          <div style={{ fontWeight: 600, marginBottom: '4px', color: okCount === total ? '#2e7d32' : '#e65100' }}>
            {okCount === total ? '所有依赖已就绪' : '部分依赖缺失，按上述提示安装后重新启动'}
          </div>
          {okCount < total && (
            <div style={{ fontSize: '13px', color: '#555' }}>
              <div style={{ marginTop: '8px', fontWeight: 600 }}>快速安装所有 Python 依赖：</div>
              <code style={{
                display: 'block', backgroundColor: '#1e1e1e', color: '#d4d4d4',
                padding: '8px 12px', borderRadius: '4px', marginTop: '4px', fontSize: '13px',
              }}>
                pip install matplotlib numpy pillow
              </code>
            </div>
          )}
        </div>

        <button
          onClick={onDismiss}
          style={{
            ...theme.typography.buttonMd,
            width: '100%', padding: '12px', borderRadius: theme.rounded.md,
            border: 'none', cursor: 'pointer',
            backgroundColor: theme.colors.primary, color: theme.colors.onPrimary,
          }}
        >
          {okCount === total ? '开始使用' : '我已知晓，继续使用'}
        </button>
      </div>
    </div>
  );
}

function App() {
  const { theme, isDark, toggleDarkMode } = useContext(ThemeContext);
  const [conversations, setConversations] = useState([]);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [loadingConvId, setLoadingConvId] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);
  const [healthCheck, setHealthCheck] = useState(null); // null = loading, object = result
  const [showSetupGuide, setShowSetupGuide] = useState(false);

  useEffect(() => {
    // 启动时检测环境
    axios.get(`${API_BASE_URL}/health`, { timeout: 5000 })
      .then(res => {
        setHealthCheck(res.data);
        setShowSetupGuide(true);
      })
      .catch(() => {
        setHealthCheck({
          allOk: false,
          checks: [{
            name: '后端服务',
            ok: false,
            detail: '无法连接',
            fix: '请确保后端已启动：cd backend && node server.js',
          }],
        });
        setShowSetupGuide(true);
      });
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/conversations`);
      setConversations(response.data);
      if (response.data.length > 0) {
        // 调用 selectConversation 获取完整的对话数据（包含 messages）
        selectConversation(response.data[0]._id);
      }
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    }
  };

  const createNewConversation = async () => {
    try {
      const response = await axios.post(`${API_BASE_URL}/conversations`);
      const newConv = response.data;
      setCurrentConversation(newConv);
      setConversations(prev => [newConv, ...prev]);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const selectConversation = async (id) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/conversations/${id}`);
      setCurrentConversation(response.data);
      setOcrResult(null);
    } catch (error) {
      console.error('Failed to fetch conversation:', error);
    }
  };

  const deleteConversation = async (id) => {
    try {
      await axios.delete(`${API_BASE_URL}/conversations/${id}`);
      setConversations(prev => {
        const oldIndex = prev.findIndex(c => c._id === id);
        const remaining = prev.filter(c => c._id !== id);
        if (currentConversation?._id === id) {
          // Pick next: the conversation that was just below the deleted one, or the last one, or null
          const next = remaining.length > 0
            ? (oldIndex < remaining.length ? remaining[oldIndex] : remaining[remaining.length - 1])
            : null;
          setCurrentConversation(next);
          if (next) selectConversation(next._id);
        }
        return remaining;
      });
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const sendMessage = async (text, imageData, ocrTextOverride) => {
    if (!currentConversation) return;

    // OCR request: only do OCR, don't send to LLM yet
    if (text === '__OCR_REQUEST__') {
      setOcrResult(null);
      const base64 = imageData ? imageData.split(',')[1] : null;
      if (!base64) return;

      try {
        const ocrRes = await axios.post(`${API_BASE_URL}/ocr`, { imageBase64: base64 });
        const recognized = ocrRes.data.text || '';
        setOcrResult(recognized);
      } catch (err) {
        console.error('OCR failed:', err);
        setOcrResult('[OCR 识别失败，请手动输入题目]');
      }
      return;
    }

    const targetConv = currentConversation;

    const displayContent = ocrTextOverride
      ? `${text}\n\n[图片 OCR 识别结果] ${ocrTextOverride}`
      : text;

    const userMsg = {
      role: 'user',
      content: text || ocrTextOverride || '[图片]',
      imageUrl: ocrTextOverride ? imageData : (imageData || null),
      ocrText: ocrTextOverride || null,
      timestamp: new Date().toISOString(),
    };

    let msgs = [...targetConv.messages];
    msgs.push(userMsg);

    const updatedConv = {
      ...targetConv,
      messages: msgs,
      updatedAt: new Date().toISOString(),
    };
    setCurrentConversation(updatedConv);
    setConversations(prev => prev.map(c => (c._id === updatedConv._id ? updatedConv : c)));

    setOcrResult(null);
    setLoadingConvId(targetConv._id);

    try {
      const requestContent = ocrTextOverride
        ? `${text || ocrTextOverride}\n\n图片识别文字: ${ocrTextOverride}`
        : text;

      const response = await axios.post(`${API_BASE_URL}/conversations/${targetConv._id}/message`, {
        content: requestContent,
        imageBase64: ocrTextOverride ? imageData?.split(',')[1] : (imageData ? imageData.split(',')[1] : null),
      });

      setCurrentConversation(response.data.conversation);
      setConversations(prev =>
        prev.map(c =>
          c._id === response.data.conversation._id ? response.data.conversation : c
        )
      );
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setLoadingConvId(null);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isLoading = loadingConvId === currentConversation?._id;

  // Fix 5: Stop the current generation
  const handleStop = async () => {
    if (!currentConversation) return;
    try {
      await axios.delete(`${API_BASE_URL}/conversations/${currentConversation._id}`);
      setConversations(prev => prev.filter(c => c._id !== currentConversation._id));
      const remaining = conversations.filter(c => c._id !== currentConversation._id);
      setCurrentConversation(remaining.length > 0 ? remaining[0] : null);
    } catch (e) {
      console.error('Stop failed:', e);
    }
    setLoadingConvId(null);
  };

  // Fix 6: Edit last message — delete old prompt + its answer, re-send edited prompt
  const handleEditLastMessage = () => {
    if (!currentConversation || !currentConversation.messages || currentConversation.messages.length === 0) return;
    const msgs = currentConversation.messages;
    // Find last user message index
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const lastUserMsg = msgs[lastUserIdx];

    const edited = window.prompt('修改你的提问：', lastUserMsg.content);
    if (edited && edited.trim()) {
      // Remove the last user message and any assistant response after it
      const trimmed = msgs.slice(0, lastUserIdx);
      const updatedConv = {
        ...currentConversation,
        messages: trimmed,
        updatedAt: new Date().toISOString(),
      };
      setCurrentConversation(updatedConv);
      setConversations(prev => prev.map(c => (c._id === updatedConv._id ? updatedConv : c)));

      // Rebuild the edited-prompt user message and send
      const userMsg = {
        role: 'user',
        content: edited.trim(),
        imageUrl: lastUserMsg.imageUrl || null,
        ocrText: lastUserMsg.ocrText || null,
        timestamp: new Date().toISOString(),
      };
      const withNewMsg = {
        ...updatedConv,
        messages: [...trimmed, userMsg],
        updatedAt: new Date().toISOString(),
      };
      setCurrentConversation(withNewMsg);
      setConversations(prev => prev.map(c => (c._id === withNewMsg._id ? withNewMsg : c)));
      setLoadingConvId(currentConversation._id);

      const origImageBase64 = lastUserMsg.imageUrl ? lastUserMsg.imageUrl.split(',')[1] : null;
      const requestContent = lastUserMsg.ocrText
        ? `${edited.trim()}\n\n图片识别文字: ${lastUserMsg.ocrText}`
        : edited.trim();

      axios.post(`${API_BASE_URL}/conversations/${currentConversation._id}/message`, {
        content: requestContent,
        imageBase64: origImageBase64,
      })
        .then(response => {
          setCurrentConversation(response.data.conversation);
          setConversations(prev =>
            prev.map(c => c._id === response.data.conversation._id ? response.data.conversation : c)
          );
        })
        .catch(err => { console.error('Failed to send edited message:', err); })
        .finally(() => { setLoadingConvId(null); });
    }
  };

  return (
    <>
      {/* 环境检测弹窗 */}
      {showSetupGuide && healthCheck && (
        <SetupGuide
          checks={healthCheck.checks}
          onDismiss={() => setShowSetupGuide(false)}
          theme={theme}
        />
      )}

    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: theme.colors.canvas,
        color: theme.colors.ink,
        fontFamily: theme.typography.bodyMd.fontFamily,
      }}
    >
      <Sidebar
        conversations={conversations}
        currentConversation={currentConversation}
        onSelectConversation={id => {
          if (
            currentConversation &&
            currentConversation._id !== id &&
            (!currentConversation.messages || currentConversation.messages.length === 0)
          ) {
            deleteConversation(currentConversation._id);
          }
          selectConversation(id);
        }}
        onCreateNewConversation={() => {
          if (
            currentConversation &&
            (!currentConversation.messages || currentConversation.messages.length === 0)
          ) {
            deleteConversation(currentConversation._id);
          }
          createNewConversation();
        }}
        onDeleteConversation={deleteConversation}
        isCollapsed={false}
        onToggleCollapse={() => {}}
      />

      <button
        onClick={toggleDarkMode}
        title={isDark ? '切换浅色模式' : '切换深色模式'}
        style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          zIndex: 100,
          width: '40px',
          height: '40px',
          borderRadius: theme.rounded.lg,
          border: `1px solid ${theme.colors.hairlineStrong}`,
          backgroundColor: theme.colors.canvas,
          color: theme.colors.ink,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.2s',
        }}
        onMouseEnter={e => { e.target.style.backgroundColor = theme.colors.cloud; }}
        onMouseLeave={e => { e.target.style.backgroundColor = theme.colors.canvas; }}
      >
        {isDark ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {currentConversation ? (
          <>
            <ChatArea
              messages={currentConversation.messages}
              isLoading={isLoading}
              formatDate={formatDate}
              onEditLastMessage={handleEditLastMessage}
            />
            <InputArea
              onSendMessage={sendMessage}
              ocrResult={ocrResult}
              isLoading={isLoading}
              onStop={handleStop}
            />
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.cloud,
            }}
          >
            <div
              style={{
                width: '120px',
                height: '120px',
                borderRadius: theme.rounded.xl,
                backgroundColor: theme.colors.primarySoft,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: theme.spacing.xl,
              }}
            >
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke={theme.colors.primary} strokeWidth="1.5">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
                <path d="M12 12l2 2 4-4" />
              </svg>
            </div>
            <h2 style={{ ...theme.typography.displayMd, color: theme.colors.ink, margin: 0, marginBottom: theme.spacing.sm }}>
              欢迎使用 AI 解题助手
            </h2>
            <p style={{ ...theme.typography.bodyMd, color: theme.colors.graphite, margin: 0, textAlign: 'center', maxWidth: '400px' }}>
              点击左侧"新对话"按钮开始你的数学解题之旅
            </p>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

export default App;
