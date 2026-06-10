import { useContext } from 'react';
import { ThemeContext } from '../theme';
import Interactive3DViewer from './Interactive3DViewer';

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

const editIconSmall = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
);

const ChatArea = ({ messages = [], isLoading, formatDate, onEditLastMessage }) => {
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
        description = description.replace(/\[IMAGE:\d+\]/g, '').trim();

        const imageInfo = images && images.find(img => img.stepId === stepId);
        const stepResult = stepResults && stepResults.find(s => s.id === stepId);

        parts.push({
          type: 'step',
          stepId,
          description: description || '暂无描述',
          imageData: imageInfo?.imageData,
          imageFormat: imageInfo?.imageType || 'png',
          imageType: stepResult?.imageType || 'MATH_STATIC_EQUATION',
          needImage: stepResult?.needImage || false,
          isGeometry: stepResult?.imageType === 'MATH_STATIC_ABSTRACT' || stepResult?.imageType === 'MATH_DYNAMIC_GEOMETRY',
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

              {/* 图片/3D模型显示逻辑 */}
              {part.imageData ? (
                <div style={{ marginBottom: theme.spacing.sm, textAlign: 'center' }}>
                  {part.imageFormat === 'gif' ? (
                    <img src={'data:image/gif;base64,' + part.imageData} alt={'步骤' + part.stepId + '图形'} style={{ maxWidth: '100%', borderRadius: theme.rounded.xl, boxShadow: theme.elevation.softLift }} />
                  ) : (
                    <img src={'data:image/png;base64,' + part.imageData} alt={'步骤' + part.stepId + '图形'} style={{ maxWidth: '100%', borderRadius: theme.rounded.xl, boxShadow: theme.elevation.softLift }} />
                  )}
                </div>
              ) : part.needImage && part.isGeometry ? (
                <div style={{ marginBottom: theme.spacing.sm, textAlign: 'center' }}>
                  <Interactive3DViewer shapeInfo={{ type: 'cube', dimensions: '2x2x2', properties: part.description?.substring(0, 60) }} />
                </div>
              ) : null}

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
      <div style={{
        padding: theme.spacing.md,
        borderBottom: `1px solid ${theme.colors.hairline}`,
        backgroundColor: theme.colors.canvas,
        flexShrink: 0,
      }}>
        <h2 style={{ ...theme.typography.displayXs, color: theme.colors.ink, margin: 0 }}>
          解题对话
        </h2>
        <p style={{ ...theme.typography.captionMd, color: theme.colors.graphite, margin: `${theme.spacing.xxs} 0 0 0` }}>
          智能解题助手，助你轻松解决数学问题
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: theme.spacing.xl, backgroundColor: theme.colors.canvas }}>
        {messages.length === 0 && !isLoading && (
          <div style={{
            maxWidth: '70%', marginBottom: theme.spacing.md, padding: theme.spacing.md,
            borderRadius: theme.rounded.xl, marginRight: 'auto', backgroundColor: theme.colors.cloud,
            boxShadow: theme.elevation.softLift,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
              <div style={{ width: '32px', height: '32px', borderRadius: theme.rounded.lg, backgroundColor: theme.colors.fog, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.colors.graphite }}>
                {botIcon}
              </div>
              <span style={{ ...theme.typography.bodyEmphasis, color: theme.colors.ink }}>AI助手</span>
            </div>
            <div style={{ ...theme.typography.bodyMd, color: theme.colors.ink }}>
              <p>你好！我是你的AI解题助手。请输入数学问题，我会帮你一步步解答。</p>
              <p style={{ marginTop: theme.spacing.sm }}>支持的功能：</p>
              <ul style={{ marginLeft: theme.spacing.md, marginTop: theme.spacing.xxs }}>
                <li>文字问题输入</li>
                <li>图片上传（支持OCR识别）</li>
                <li>分步解题</li>
                <li>图形辅助理解</li>
              </ul>
            </div>
          </div>
        )}

        {(() => {
          const lastUserIdx = [...messages].reverse().findIndex(m => m.role === 'user');
          const lastUserIndex = lastUserIdx >= 0 ? messages.length - 1 - lastUserIdx : -1;

          return messages.map((message, index) => (
          <div key={index} style={{
            maxWidth: '70%', marginBottom: theme.spacing.md, padding: theme.spacing.md,
            borderRadius: theme.rounded.xl,
            marginLeft: message.role === 'user' ? 'auto' : '0',
            marginRight: message.role === 'assistant' ? 'auto' : '0',
            backgroundColor: message.role === 'user' ? theme.colors.primary : theme.colors.cloud,
            borderBottomRightRadius: message.role === 'user' ? theme.rounded.md : theme.rounded.xl,
            borderBottomLeftRadius: message.role === 'assistant' ? theme.rounded.md : theme.rounded.xl,
            boxShadow: message.role === 'assistant' ? theme.elevation.softLift : 'none',
            position: 'relative',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: theme.rounded.lg,
                backgroundColor: message.role === 'user' ? theme.colors.primaryBright : theme.colors.fog,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
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

            <div style={{
              fontSize: theme.typography.bodyMd.fontSize,
              lineHeight: theme.typography.bodyMd.lineHeight,
              color: message.role === 'user' ? theme.colors.onPrimary : theme.colors.ink,
            }}>
              {renderMessageContent(message.content, message.images, message.stepResults)}
            </div>

            {message.imageUrl && (
              <img src={message.imageUrl} alt="上传图片" style={{ maxWidth: '100%', borderRadius: theme.rounded.lg, marginTop: theme.spacing.sm }} />
            )}

            <div style={{
              ...theme.typography.captionSm,
              color: message.role === 'user' ? theme.colors.primarySoft : theme.colors.graphite,
              marginTop: theme.spacing.xs, textAlign: 'right',
            }}>
              {formatDate(message.timestamp)}
            </div>

            {index === lastUserIndex && !isLoading && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onEditLastMessage?.(); }}
                title="修改最近一次提问"
                style={{
                  position: 'absolute',
                  bottom: '-2px',
                  left: '-2px',
                  background: theme.colors.canvas,
                  border: '1px solid ' + theme.colors.hairlineStrong,
                  borderRadius: '50%',
                  cursor: 'pointer',
                  padding: '4px',
                  width: '22px',
                  height: '22px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: theme.colors.graphite,
                  opacity: 0.5,
                  transition: 'opacity 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; }}
              >
                {editIconSmall}
              </button>
            )}
          </div>
          ));
        })()}

        {isLoading && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: theme.spacing.sm, padding: theme.spacing.md,
            backgroundColor: theme.colors.cloud, borderRadius: theme.rounded.xl, marginRight: 'auto', maxWidth: '70%',
          }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: theme.rounded.lg, backgroundColor: theme.colors.fog,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.colors.graphite, marginRight: theme.spacing.sm,
            }}>
              {botIcon}
            </div>
            <div style={{ display: 'flex', gap: theme.spacing.xxs }}>
              {[1, 2, 3].map((i) => (
                <div key={i} style={{
                  width: '8px', height: '8px', borderRadius: '50%', backgroundColor: theme.colors.primary,
                  animation: 'pulse 1.4s ease-in-out infinite both',
                  animationDelay: `${(i - 1) * 0.2}s`,
                }} />
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
