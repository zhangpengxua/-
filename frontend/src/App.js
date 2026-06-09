import { useState, useEffect } from 'react';
import axios from 'axios';
import CodeBlock from './components/CodeBlock';
import GeometryViewer from './components/GeometryViewer';
import Interactive3DViewer from './components/Interactive3DViewer';

const API_BASE_URL = 'http://localhost:5000/api';

const menuIcon = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const xIcon = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const plusIcon = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const imageIcon = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

const cameraIcon = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

const fileIcon = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const sendIcon = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const messageIcon = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const trashIcon = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/conversations`);
      setConversations(response.data);
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    }
  };

  const fetchConversation = async (conversationId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/conversations/${conversationId}`);
      setCurrentConversation(response.data);
    } catch (error) {
      console.error('Failed to fetch conversation:', error);
    }
  };

  const createNewConversation = async () => {
    try {
      const response = await axios.post(`${API_BASE_URL}/conversations`);
      if (response.data && response.data._id) {
        setCurrentConversation(response.data);
        fetchConversations();
      } else {
        console.error('Invalid conversation data received:', response.data);
      }
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const deleteConversation = async (conversationId) => {
    try {
      await axios.delete(`${API_BASE_URL}/conversations/${conversationId}`);
      if (currentConversation && currentConversation._id === conversationId) {
        setCurrentConversation(null);
      }
      fetchConversations();
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() && !selectedFile) return;

    setIsLoading(true);

    try {
      let imageBase64 = null;
      if (selectedFile) {
        const reader = new FileReader();
        imageBase64 = await new Promise((resolve) => {
          reader.onload = (e) => resolve(e.target.result.split(',')[1]);
          reader.readAsDataURL(selectedFile);
        });
      }

      const response = await axios.post(
        `${API_BASE_URL}/conversations/${currentConversation._id}/message`,
        {
          content: inputValue,
          imageBase64: imageBase64
        }
      );

      setCurrentConversation(response.data.conversation);
      setInputValue('');
      setSelectedFile(null);
      fetchConversations();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file);
    }
  };

  const handleCameraCapture = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        setSelectedFile(file);
      }
    };
    input.click();
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const parseMessageContent = (content, images, stepResults) => {
    const parts = [];
    
    // 按步骤分割内容
    const stepMatches = content.match(/### 步骤 (\d+)\n\n([\s\S]*?)(?=### 步骤|$)/g);
    
    if (stepMatches) {
      stepMatches.forEach((stepContent) => {
        // 提取步骤ID
        const stepIdMatch = stepContent.match(/### 步骤 (\d+)/);
        const stepId = stepIdMatch ? parseInt(stepIdMatch[1]) : 0;
        
        // 提取步骤描述（去掉步骤标题）
        let description = stepContent.replace(/### 步骤 \d+\n\n/, '').trim();
        
        // 检查是否有图片
        const imageData = images && images.find(img => img.stepId === stepId);
        
        // 获取步骤结果以判断是否使用3D交互
        const stepResult = stepResults && stepResults.find(s => s.id === stepId);
        
        parts.push({
          type: 'step',
          stepId,
          description,
          imageData: imageData?.imageData,
          imageType: stepResult?.imageType || 'MATH_STATIC_EQUATION'
        });
      });
    } else {
      // 没有步骤结构，直接显示内容
      parts.push({ type: 'text', data: content.trim() });
    }
    
    return parts;
  };

  const renderMessageContent = (content, images, stepResults) => {
    const parts = parseMessageContent(content, images, stepResults);
    
    return parts.map((part, index) => {
      switch (part.type) {
        case 'step':
          return (
            <div key={`step-${index}`} style={{ marginBottom: '24px' }}>
              {/* 步骤标题 */}
              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#4a9eff', fontSize: '16px' }}>
                  ### 步骤 {part.stepId}
                </strong>
              </div>
              
              {/* 先显示图片 */}
              {part.imageData && (
                <div style={{ marginBottom: '12px', textAlign: 'center' }}>
                  {part.imageType === 'MATH_STATIC_ABSTRACT' || 
                   part.imageType === 'MATH_DYNAMIC_GEOMETRY' ||
                   part.imageType === 'PHYSICS_ENGINE' ? (
                    // 可交互的3D查看器
                    <Interactive3DViewer 
                      shapeInfo={{ 
                        type: 'cube', 
                        dimensions: '3x3x3',
                        properties: '三维立方体'
                      }} 
                    />
                  ) : (
                    // 静态图片
                    <img 
                      src={`data:image/png;base64,${part.imageData}`} 
                      alt={`步骤${part.stepId}图形`} 
                      style={{ 
                        maxWidth: '100%', 
                        borderRadius: '8px', 
                        boxShadow: '0 2px 8px rgba(0,0,0,0.3)' 
                      }} 
                    />
                  )}
                </div>
              )}
              
              {/* 再显示步骤描述 */}
              <div style={{ lineHeight: '1.6', color: '#ffffff' }}>
                {part.description.split('\n').map((line, lineIdx) => (
                  <p key={lineIdx} style={{ margin: '4px 0' }}>{line}</p>
                ))}
              </div>
            </div>
          );
        case 'text':
          return (
            <div key={`text-${index}`} style={{ margin: '8px 0', lineHeight: '1.6' }}>
              {part.data.split('\n').map((line, lineIdx) => (
                <p key={lineIdx} style={{ margin: '4px 0' }}>
                  {line.startsWith('###') ? (
                    <strong style={{ color: '#4a9eff', fontSize: '16px' }}>{line}</strong>
                  ) : line}
                </p>
              ))}
            </div>
          );
        default:
          return null;
      }
    });
  };

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#1a1a2e', color: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* Sidebar */}
      <div style={{ 
        width: sidebarCollapsed ? '60px' : '280px', 
        backgroundColor: '#16213e', 
        borderRight: '1px solid #2a2a4a',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.3s ease'
      }}>
        <div style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #2a2a4a' }}>
          <h1 style={{ fontSize: '18px', fontWeight: '600', margin: '0', display: sidebarCollapsed ? 'none' : 'block' }}>DeepSeek Chat</h1>
          <button 
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', padding: '8px' }}
          >
            {sidebarCollapsed ? menuIcon : xIcon}
          </button>
        </div>
        
        <button 
          onClick={createNewConversation}
          style={{
            width: sidebarCollapsed ? '40px' : 'calc(100% - 32px)',
            height: '40px',
            border: 'none',
            borderRadius: '8px',
            backgroundColor: '#0f3460',
            color: '#ffffff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            margin: '16px',
            transition: 'background-color 0.2s'
          }}
          onMouseEnter={(e) => e.target.style.backgroundColor = '#1a4d8c'}
          onMouseLeave={(e) => e.target.style.backgroundColor = '#0f3460'}
        >
          {plusIcon}
          {!sidebarCollapsed && '新对话'}
        </button>

        <div style={{ flex: '1', overflowY: 'auto', padding: '8px' }}>
          {conversations.length === 0 ? (
            !sidebarCollapsed && (
              <div style={{ padding: '16px', textAlign: 'center', color: '#666666' }}>暂无对话</div>
            )
          ) : (
            conversations.map((conv) => (
              <div
                key={conv._id}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  marginBottom: '4px',
                  display: sidebarCollapsed ? 'flex' : 'block',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                className={currentConversation?._id === conv._id ? 'active-conv' : ''}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#2a2a4a'}
                onMouseLeave={(e) => e.target.style.backgroundColor = currentConversation?._id === conv._id ? '#0f3460' : 'transparent'}
                onClick={() => fetchConversation(conv._id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (confirm('确定删除此对话？')) {
                    deleteConversation(conv._id);
                  }
                }}
              >
                {sidebarCollapsed ? (
                  <div style={{ fontSize: '20px' }}>{messageIcon}</div>
                ) : (
                  <>
                    <div style={{ fontSize: '14px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {conv.title}
                    </div>
                    <div style={{ fontSize: '12px', color: '#888888', marginTop: '4px' }}>
                      {formatDate(conv.updatedAt)}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: '1', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {currentConversation ? (
          <>
            <div style={{ padding: '16px 24px', backgroundColor: '#16213e', borderBottom: '1px solid #2a2a4a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '600', margin: '0' }}>{currentConversation.title}</h2>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button 
                  onClick={createNewConversation}
                  style={{ background: 'none', border: 'none', color: '#888888', cursor: 'pointer', padding: '8px', borderRadius: '8px', transition: 'all 0.2s' }}
                  onMouseEnter={(e) => { e.target.style.backgroundColor = '#2a2a4a'; e.target.style.color = '#ffffff'; }}
                  onMouseLeave={(e) => { e.target.style.backgroundColor = 'transparent'; e.target.style.color = '#888888'; }}
                >
                  {plusIcon}
                </button>
                <button 
                  onClick={() => { if (confirm('确定删除此对话？')) deleteConversation(currentConversation._id); }}
                  style={{ background: 'none', border: 'none', color: '#888888', cursor: 'pointer', padding: '8px', borderRadius: '8px', transition: 'all 0.2s' }}
                  onMouseEnter={(e) => { e.target.style.backgroundColor = '#2a2a4a'; e.target.style.color = '#ffffff'; }}
                  onMouseLeave={(e) => { e.target.style.backgroundColor = 'transparent'; e.target.style.color = '#888888'; }}
                >
                  {trashIcon}
                </button>
              </div>
            </div>

            <div style={{ flex: '1', overflowY: 'auto', padding: '24px' }}>
              {currentConversation.messages.map((message, index) => (
                <div 
                  key={index} 
                  style={{
                    maxWidth: '70%',
                    marginBottom: '16px',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    marginLeft: message.role === 'user' ? 'auto' : '0',
                    marginRight: message.role === 'assistant' ? 'auto' : '0',
                    backgroundColor: message.role === 'user' ? '#0f3460' : '#2a2a4a',
                    borderBottomRightRadius: message.role === 'user' ? '4px' : '12px',
                    borderBottomLeftRadius: message.role === 'assistant' ? '4px' : '12px'
                  }}
                >
                  <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
                    {renderMessageContent(message.content, message.images, message.stepResults)}
                  </div>
                  {message.imageUrl && (
                    <img src={message.imageUrl} alt="图片" style={{ maxWidth: '100%', borderRadius: '8px', marginTop: '8px' }} />
                  )}
                  <div style={{ fontSize: '11px', color: '#888888', marginTop: '8px', textAlign: 'right' }}>
                    {formatDate(message.timestamp)}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', backgroundColor: '#2a2a4a', borderRadius: '12px', marginRight: 'auto', maxWidth: '70%' }}>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#0f3460', animation: 'loading 1.4s infinite ease-in-out', animationDelay: '-0.32s' }} />
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#0f3460', animation: 'loading 1.4s infinite ease-in-out', animationDelay: '-0.16s' }} />
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#0f3460', animation: 'loading 1.4s infinite ease-in-out' }} />
                  </div>
                  <span style={{ fontSize: '14px' }}>思考中...</span>
                </div>
              )}
            </div>

            <div style={{ padding: '16px 24px', backgroundColor: '#16213e', borderTop: '1px solid #2a2a4a' }}>
              <div style={{ backgroundColor: '#2a2a4a', borderRadius: '12px', padding: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button style={{ background: 'none', border: 'none', color: '#888888', cursor: 'pointer', padding: '8px', borderRadius: '8px', transition: 'color 0.2s' }} onMouseEnter={(e) => e.target.style.color = '#ffffff'} onMouseLeave={(e) => e.target.style.color = '#888888'}>
                    <input type="file" accept="image/*" onChange={handleImageSelect} style={{ display: 'none' }} id="image-upload" />
                    <label htmlFor="image-upload" style={{ cursor: 'pointer' }}>{imageIcon}</label>
                  </button>
                  <button style={{ background: 'none', border: 'none', color: '#888888', cursor: 'pointer', padding: '8px', borderRadius: '8px', transition: 'color 0.2s' }} onMouseEnter={(e) => e.target.style.color = '#ffffff'} onMouseLeave={(e) => e.target.style.color = '#888888'} onClick={handleCameraCapture}>
                    {cameraIcon}
                  </button>
                  <button style={{ background: 'none', border: 'none', color: '#888888', cursor: 'pointer', padding: '8px', borderRadius: '8px', transition: 'color 0.2s' }} onMouseEnter={(e) => e.target.style.color = '#ffffff'} onMouseLeave={(e) => e.target.style.color = '#888888'}>
                    <input type="file" onChange={handleFileSelect} style={{ display: 'none' }} id="file-upload" />
                    <label htmlFor="file-upload" style={{ cursor: 'pointer' }}>{fileIcon}</label>
                  </button>
                </div>
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="输入问题..."
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                  style={{
                    flex: '1',
                    background: 'none',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: '14px',
                    resize: 'none',
                    outline: 'none',
                    padding: '8px',
                    minHeight: '24px',
                    maxHeight: '200px',
                    overflowY: 'auto'
                  }}
                />
                <button 
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() && !selectedFile}
                  style={{
                    backgroundColor: '#0f3460',
                    border: 'none',
                    color: '#ffffff',
                    cursor: 'pointer',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    transition: 'background-color 0.2s',
                    opacity: (!inputValue.trim() && !selectedFile) ? '0.5' : '1'
                  }}
                  onMouseEnter={(e) => { if (inputValue.trim() || selectedFile) e.target.style.backgroundColor = '#1a4d8c'; }}
                  onMouseLeave={(e) => e.target.style.backgroundColor = '#0f3460'}
                >
                  {sendIcon}
                </button>
              </div>
              {selectedFile && (
                <div style={{ marginTop: '8px', color: '#888888', fontSize: '12px' }}>已选择文件: {selectedFile.name}</div>
              )}
            </div>
          </>
        ) : (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
            <div style={{ fontSize: '64px', color: '#3a3a5a', marginBottom: '16px' }}>{messageIcon}</div>
            <h3 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 8px 0' }}>开始新对话</h3>
            <p style={{ fontSize: '14px', color: '#888888', margin: '0' }}>点击左侧按钮创建新对话，开始与AI交流</p>
          </div>
        )}
      </div>
      <style>{`
        .active-conv {
          background-color: #0f3460;
        }
        @keyframes loading {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #1a1a2e; }
        ::-webkit-scrollbar-thumb { background: #4a4a6a; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #5a5a7a; }
      `}</style>
    </div>
  );
}

export default App;
