import { useContext } from 'react';
import { ThemeContext } from '../theme';

const userIcon = (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const botIcon = (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <circle cx="15" cy="9" r="2" />
    <path d="M9 15h6" />
  </svg>
);

const ChatArea = ({ messages = [], isLoading, formatDate }) => {
  const { theme } = useContext(ThemeContext);
  const parseMessageContent = (content, images, stepResults) => {
    const parts = [];
    
    if (!content || !content.trim()) {
      return [{ type: 'text', data: '暂无内容' }];
    }
    
    const stepMatches = content.match(/### 步骤 (\d+)\n\n([\s\S]*?)(?=### 步骤|$)/g);
    
    if (stepMatches) {
      stepMatches.forEach((stepContent) => {
        const stepIdMatch = stepContent.match(/### 步骤 (\d+)/);
        const stepId = stepIdMatch ? parseInt(stepIdMatch[1]) : 0;
        let description = stepContent.replace(/### 步骤 \d+\n\n/, '').trim();
        // 移除图片占位符
        description = description.replace(/\[IMAGE:\d+\]/g, '').trim();
        
        const imageInfo = images && images.find(img => img.stepId === stepId);
        const stepResult = stepResults && stepResults.find(s => s.id === stepId);
        
        parts.push({
          type: 'step',
          stepId,
          description: description || '暂无描述',
          imageData: imageInfo?.imageData,
          imageFormat: imageInfo?.imageType || 'png', // 获取图片格式（png/gif）
          imageType: stepResult?.imageType || 'MATH_STATIC_EQUATION' // 获取图像类型
        });
      });
    } else {
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
            <div key={`step-${index}`} style={{ marginBottom: theme.spacing.xl }}>
              <div style={{ marginBottom: theme.spacing.sm }}>
                <strong style={{ 
                  ...theme.typography.displayXs,
                  color: theme.colors.primary,
                }}>
                  步骤 {part.stepId}
                </strong>
              </div>
              
              {part.imageData && (
                <div style={{ marginBottom: theme.spacing.sm, textAlign: 'center' }}>
                  {part.imageFormat === 'gif' ? (
                    <img
                      src={`data:image/gif;base64,${part.imageData}`}
                      alt={`步骤${part.stepId}图形`}
                      style={{
                        maxWidth: '100%',
                        borderRadius: theme.rounded.xl,
                        boxShadow: theme.elevation.softLift,
                      }}
                    />
                  ) : (
                    <img
                      src={`data:image/png;base64,${part.imageData}`}
                      alt={`步骤${part.stepId}图形`}
                      style={{
                        maxWidth: '100%',
                        borderRadius: theme.rounded.xl,
                        boxShadow: theme.elevation.softLift,
                      }}
                    />
                  )}
                </div>
              )}
              
              <div style={{ 
                ...theme.typography.bodyMd,
                color: theme.colors.ink,
                lineHeight: theme.typography.bodyMd.lineHeight,
              }}>
                {part.description.split('\n').map((line, lineIdx) => (
                  <p key={lineIdx} style={{ margin: `${theme.spacing.xxs} 0` }}>{line}</p>
                ))}
              </div>
            </div>
          );
        case 'text':
          return (
            <div key={`text-${index}`} style={{ margin: `${theme.spacing.xs} 0`, lineHeight: theme.typography.bodyMd.lineHeight }}>
              {part.data.split('\n').map((line, lineIdx) => (
                <p key={lineIdx} style={{ margin: `${theme.spacing.xxs} 0` }}>
                  {line.startsWith('###') ? (
                    <strong style={{ 
                      ...theme.typography.displayXs,
                      color: theme.colors.primary,
                    }}>{line.replace(/^###\s*/, '')}</strong>
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* 对话标题 */}
      <div style={{
        padding: theme.spacing.md,
        borderBottom: `1px solid ${theme.colors.hairline}`,
        backgroundColor: theme.colors.canvas,
        flexShrink: 0,
      }}>
        <h2 style={{
          ...theme.typography.displayXs,
          color: theme.colors.ink,
          margin: 0,
        }}>
          解题对话
        </h2>
        <p style={{
          ...theme.typography.captionMd,
          color: theme.colors.graphite,
          margin: `${theme.spacing.xxs} 0 0 0`,
        }}>
          智能解题助手，助你轻松解决数学问题
        </p>
      </div>

      {/* 消息列表 */}
      <div style={{ 
        flex: 1, 
        overflowY: 'auto', 
        padding: theme.spacing.xl,
        backgroundColor: theme.colors.canvas,
      }}>
        {/* 欢迎消息 */}
        {messages.length === 0 && !isLoading && (
          <div style={{
            maxWidth: '70%',
            marginBottom: theme.spacing.md,
            padding: theme.spacing.md,
            borderRadius: theme.rounded.xl,
            marginRight: 'auto',
            backgroundColor: theme.colors.cloud,
            boxShadow: theme.elevation.softLift,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: theme.rounded.lg,
                backgroundColor: theme.colors.fog,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: theme.colors.graphite,
              }}>
                {botIcon}
              </div>
              <span style={{
                ...theme.typography.bodyEmphasis,
                color: theme.colors.ink,
              }}>
                AI助手
              </span>
            </div>
            <div style={{ 
              ...theme.typography.bodyMd,
              color: theme.colors.ink,
            }}>
              <p>你好！我是你的AI解题助手。请输入数学问题，我会帮你一步步解答。</p>
              <p style={{ marginTop: theme.spacing.sm }}>支持的功能：</p>
              <ul style={{ marginLeft: theme.spacing.md, marginTop: theme.spacing.xxs }}>
                <li>📝 文字问题输入</li>
                <li>📷 图片上传（支持OCR识别）</li>
                <li>🎯 分步解题</li>
                <li>📊 图形辅助理解</li>
              </ul>
            </div>
          </div>
        )}
        
        {/* 用户和AI的消息 */}
        {messages.map((message, index) => (
          <div 
            key={index} 
            style={{
              maxWidth: '70%',
              marginBottom: theme.spacing.md,
              padding: theme.spacing.md,
              borderRadius: theme.rounded.xl,
              marginLeft: message.role === 'user' ? 'auto' : '0',
              marginRight: message.role === 'assistant' ? 'auto' : '0',
              backgroundColor: message.role === 'user' 
                ? theme.colors.primary 
                : theme.colors.cloud,
              borderBottomRightRadius: message.role === 'user' ? theme.rounded.md : theme.rounded.xl,
              borderBottomLeftRadius: message.role === 'assistant' ? theme.rounded.md : theme.rounded.xl,
              boxShadow: message.role === 'assistant' ? theme.elevation.softLift : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: theme.rounded.lg,
                backgroundColor: message.role === 'user' 
                  ? theme.colors.primaryBright 
                  : theme.colors.fog,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: message.role === 'user' ? theme.colors.onPrimary : theme.colors.graphite,
              }}>
                {message.role === 'user' ? userIcon : botIcon}
              </div>
              <span style={{
                ...theme.typography.bodyEmphasis,
                color: message.role === 'user' ? theme.colors.onPrimary : theme.colors.ink,
              }}>
                {message.role === 'user' ? '你' : 'AI助手'}
              </span>
            </div>
            
            {/* 消息内容 */}
            <div style={{ 
              fontSize: theme.typography.bodyMd.fontSize,
              lineHeight: theme.typography.bodyMd.lineHeight,
              color: message.role === 'user' ? theme.colors.onPrimary : theme.colors.ink,
            }}>
              {renderMessageContent(message.content, message.images, message.stepResults)}
            </div>
            
            {/* 用户上传的图片 */}
            {message.imageUrl && (
              <img 
                src={message.imageUrl} 
                alt="上传图片" 
                style={{ 
                  maxWidth: '100%', 
                  borderRadius: theme.rounded.lg, 
                  marginTop: theme.spacing.sm,
                }} 
              />
            )}
            
            {/* 时间戳 */}
            <div style={{ 
              ...theme.typography.captionSm,
              color: message.role === 'user' ? theme.colors.primarySoft : theme.colors.graphite,
              marginTop: theme.spacing.xs,
              textAlign: 'right',
            }}>
              {formatDate(message.timestamp)}
            </div>
          </div>
        ))}
        
        {/* 正在思考加载动画 */}
        {isLoading && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: theme.spacing.sm, 
            padding: theme.spacing.md, 
            backgroundColor: theme.colors.cloud, 
            borderRadius: theme.rounded.xl, 
            marginRight: 'auto', 
            maxWidth: '70%',
          }}>
            <div style={{ 
              width: '32px',
              height: '32px',
              borderRadius: theme.rounded.lg,
              backgroundColor: theme.colors.fog,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: theme.colors.graphite,
              marginRight: theme.spacing.sm,
            }}>
              {botIcon}
            </div>
            <div style={{ display: 'flex', gap: theme.spacing.xxs }}>
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: theme.colors.primary,
                    animation: `pulse 1.4s ease-in-out infinite both`,
                    animationDelay: `${(i - 1) * 0.2}s`,
                  }}
                />
              ))}
            </div>
            <span style={{ ...theme.typography.captionMd, color: theme.colors.graphite }}>
              AI 正在思考中...
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatArea;