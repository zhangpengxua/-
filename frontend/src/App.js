import { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { ThemeContext } from './theme';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import InputArea from './components/InputArea';

const API_BASE_URL = 'http://localhost:5000/api';

function App() {
  const { theme, isDark, toggleDarkMode } = useContext(ThemeContext);
  const [conversations, setConversations] = useState([]);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [loadingConvId, setLoadingConvId] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);

  useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/conversations`);
      setConversations(response.data);
      if (response.data.length > 0) {
        setCurrentConversation(response.data[0]);
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
      setConversations(prev => prev.filter(c => c._id !== id));
      if (currentConversation?._id === id) {
        setConversations(prev => {
          const remaining = prev.filter(c => c._id !== id);
          setCurrentConversation(remaining.length > 0 ? remaining[0] : null);
          return remaining;
        });
      }
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

      // Add user's image message to conversation
      const userMsg = {
        role: 'user',
        content: '[图片上传]',
        imageUrl: imageData || null,
        timestamp: new Date().toISOString(),
      };
      const updatedConv = {
        ...currentConversation,
        messages: [...currentConversation.messages, userMsg],
        updatedAt: new Date().toISOString(),
      };
      setCurrentConversation(updatedConv);
      setConversations(prev => prev.map(c => (c._id === updatedConv._id ? updatedConv : c)));

      try {
        const ocrRes = await axios.post(`${API_BASE_URL}/ocr`, { imageBase64: base64 });
        const recognized = ocrRes.data.text || '';
        setOcrResult(recognized);
      } catch (err) {
        console.error('OCR failed:', err);
        setOcrResult('[OCR识别失败，请手动输入题目]');
      }
      return;
    }

    const targetConv = currentConversation;

    const displayContent = ocrTextOverride
      ? `${text}\n\n[图片OCR识别结果] ${ocrTextOverride}`
      : text;

    const userMsg = {
      role: 'user',
      content: displayContent,
      imageUrl: ocrTextOverride ? currentConversation.messages[currentConversation.messages.length - 1]?.imageUrl : (imageData || null),
      ocrText: ocrTextOverride || null,
      timestamp: new Date().toISOString(),
    };

    // If OCR result was used, update the last image message with ocr text
    let msgs = [...targetConv.messages];
    if (ocrTextOverride) {
      // Replace the last [图片上传] placeholder message with the real one
      msgs = msgs.filter(m => m.content !== '[图片上传]');
    }
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
        ? `${text}\n\n图片识别文字: ${ocrTextOverride}`
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

  return (
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
            />
            <InputArea
              onSendMessage={sendMessage}
              ocrResult={ocrResult}
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
  );
}

export default App;
