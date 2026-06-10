import { useState, useEffect } from 'react';
import axios from 'axios';
import { theme } from './theme';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import InputArea from './components/InputArea';

const API_BASE_URL = 'http://localhost:5000/api';

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
      setCurrentConversation(response.data);
      setConversations(prev => [response.data, ...prev]);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const selectConversation = async (id) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/conversations/${id}`);
      setCurrentConversation(response.data);
    } catch (error) {
      console.error('Failed to fetch conversation:', error);
    }
  };

  const deleteConversation = async (id) => {
    try {
      await axios.delete(`${API_BASE_URL}/conversations/${id}`);
      setConversations(prev => prev.filter(c => c._id !== id));
      if (currentConversation?._id === id) {
        const remaining = conversations.filter(c => c._id !== id);
        setCurrentConversation(remaining.length > 0 ? remaining[0] : null);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const sendMessage = async (text, imageData) => {
    if (!currentConversation) return;
    
    setIsLoading(true);
    
    try {
      const response = await axios.post(`${API_BASE_URL}/conversations/${currentConversation._id}/message`, {
        content: text,
        imageBase64: imageData ? imageData.split(',')[1] : null,
      });
      
      setCurrentConversation(response.data.conversation);
      setConversations(prev => prev.map(c => 
        c._id === response.data.conversation._id ? response.data.conversation : c
      ));
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div style={{ 
      display: 'flex', 
      height: '100vh', 
      backgroundColor: theme.colors.canvas, 
      color: theme.colors.ink, 
      fontFamily: theme.typography.bodyMd.fontFamily,
    }}>
      <Sidebar 
        conversations={conversations}
        currentConversation={currentConversation}
        onSelectConversation={selectConversation}
        onCreateNewConversation={createNewConversation}
        onDeleteConversation={deleteConversation}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {currentConversation ? (
          <>
            <ChatArea 
              messages={currentConversation.messages}
              isLoading={isLoading}
              formatDate={formatDate}
            />
            <InputArea onSendMessage={sendMessage} />
          </>
        ) : (
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center',
            backgroundColor: theme.colors.cloud,
          }}>
            <div style={{
              width: '120px',
              height: '120px',
              borderRadius: theme.rounded.xl,
              backgroundColor: theme.colors.primarySoft,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: theme.spacing.xl,
            }}>
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke={theme.colors.primary} strokeWidth="1.5">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
                <path d="M12 12l2 2 4-4" />
              </svg>
            </div>
            <h2 style={{
              ...theme.typography.displayMd,
              color: theme.colors.ink,
              margin: 0,
              marginBottom: theme.spacing.sm,
            }}>
              欢迎使用 AI 解题助手
            </h2>
            <p style={{
              ...theme.typography.bodyMd,
              color: theme.colors.graphite,
              margin: 0,
              textAlign: 'center',
              maxWidth: '400px',
            }}>
              点击左侧"新对话"按钮开始你的数学解题之旅
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;