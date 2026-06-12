import { useContext } from 'react';
import { ThemeContext } from '../theme';
import Interactive3DViewer from './Interactive3DViewer';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

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

  const markdownComponents = {
    p: ({ children, ...props }) => <p style={{ margin: '4px 0', lineHeight: 1.6 }} {...props}>{children}</p>,
    strong: ({ children, ...props }) => <strong style={{ fontWeight: 700, color: theme.colors.inkDeep }} {...props}>{children}</strong>,
    em: ({ children, ...props }) => <em style={{ fontStyle: 'italic', color: theme.colors.charcoal }} {...props}>{children}</em>,
    code: ({ children, inline, ...props }) => {
      if (inline) {
        return <code style={{
          backgroundColor: theme.colors.cloud,
          padding: '1px 5px',
          borderRadius: '3px',
          fontSize: '0.9em',
          fontFamily: 'Consolas, "Courier New", monospace',
          color: theme.colors.primaryDeep,
        }} {...props}>{children}</code>;
      }
      return <code {...props}>{children}</code>;
    },
    pre: ({ children, ...props }) => (
      <pre style={{
        backgroundColor: theme.colors.cloud,
        padding: theme.spacing.sm,
        borderRadius: '6px',
        overflow: 'auto',
        fontSize: '0.85em',
        lineHeight: 1.5,
        margin: '8px 0',
        border: `1px solid ${theme.colors.hairline}`,
      }} {...props}>{children}</pre>
    ),
    ul: ({ children, ...props }) => <ul style={{ margin: '4px 0', paddingInlineStart: '20px', lineHeight: 1.6 }} {...props}>{children}</ul>,
    ol: ({ children, ...props }) => <ol style={{ margin: '4px 0', paddingInlineStart: '20px', lineHeight: 1.6 }} {...props}>{children}</ol>,
    li: ({ children, ...props }) => <li style={{ margin: '2px 0' }} {...props}>{children}</li>,
    h1: ({ children, ...props }) => <h1 style={{ fontSize: '1.5em', fontWeight: 700, margin: '10px 0 4px', color: theme.colors.inkDeep }} {...props}>{children}</h1>,
    h2: ({ children, ...props }) => <h2 style={{ fontSize: '1.3em', fontWeight: 700, margin: '8px 0 4px', color: theme.colors.inkDeep }} {...props}>{children}</h2>,
    h3: ({ children, ...props }) => <h3 style={{ fontSize: '1.1em', fontWeight: 700, margin: '6px 0 4px', color: theme.colors.primary }} {...props}>{children}</h3>,
    blockquote: ({ children, ...props }) => (
      <blockquote style={{
        borderLeft: `3px solid ${theme.colors.primary}`,
        paddingLeft: theme.spacing.sm,
        margin: '8px 0',
        color: theme.colors.graphite,
        backgroundColor: theme.colors.primarySoft,
        padding: '4px 12px',
        borderRadius: '0 4px 4px 0',
      }} {...props}>{children}</blockquote>
    ),
    table: ({ children, ...props }) => (
      <div style={{ overflow: 'auto', margin: '8px 0' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9em' }} {...props}>{children}</table>
      </div>
    ),
    th: ({ children, ...props }) => (
      <th style={{
        border: `1px solid ${theme.colors.hairlineStrong}`,
        padding: '4px 8px',
        backgroundColor: theme.colors.cloud,
        fontWeight: 700,
        textAlign: 'left',
      }} {...props}>{children}</th>
    ),
    td: ({ children, ...props }) => (
      <td style={{
        border: `1px solid ${theme.colors.hairline}`,
        padding: '4px 8px',
      }} {...props}>{children}</td>
    ),
  };

  const renderContent = (text) => {
    // Preprocess: wrap bare LaTeX commands in $...$ so KaTeX can render them
    const processed = text
      // \vec{AB} → $\vec{AB}$
      .replace(/\\vec\{[^}]+\}/g, (m) => `$${m}$`)
      // \overrightarrow{AB} → $\overrightarrow{AB}$
      .replace(/\\overrightarrow\{[^}]+\}/g, (m) => `$${m}$`)
      // \frac{a}{b} → $\frac{a}{b}$
      .replace(/\\frac\{[^}]+\}\{[^}]+\}/g, (m) => `$${m}$`)
      // \sqrt{x} → $\sqrt{x}$
      .replace(/\\sqrt\{[^}]+\}/g, (m) => `$${m}$`)
      // √x → $\sqrt{x}$
      .replace(/√(\d+|[a-zA-Z])/g, (_, n) => `$\\sqrt{${n}}$`)
      // \displaystyle stuff
      .replace(/\\displaystyle\s+/g, '')
      // AC→ → $\overrightarrow{AC}$ (arrow notation)
      .replace(/([A-Z][\d]*)→/g, '$\\overrightarrow{$1}$');

    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={markdownComponents}
      >
        {processed}
      </ReactMarkdown>
    );
  };

  const renderMessageContent = (content, images, stepResults) => {
    const parts = parseMessageContent(content, images, stepResults);

    return parts.map((part, index) => {
      switch (part.type) {
        case 'step':
          return (
            <div key={`step-${index}`} style={{ marginBottom: theme.spacing.lg }}>
              <div style={{
                fontSize: '18px',
                fontWeight: 700,
                color: theme.colors.primary,
                marginBottom: theme.spacing.sm,
                paddingBottom: theme.spacing.xs,
                borderBottom: `1px solid ${theme.colors.hairline}`,
              }}>
                步骤 {part.stepId}
              </div>

              {part.isGeometry ? (
                <div style={{ marginBottom: theme.spacing.sm, textAlign: 'center' }}>
                  <Interactive3DViewer description={part.description} />
                </div>
              ) : part.imageData ? (
                <div style={{ marginBottom: theme.spacing.sm, textAlign: 'center' }}>
                  {part.imageFormat === 'gif' ? (
                    <img src={'data:image/gif;base64,' + part.imageData} alt={'步骤' + part.stepId} style={{ maxWidth: '100%', borderRadius: theme.rounded.xl, boxShadow: theme.elevation.softLift }} />
                  ) : (
                    <img src={'data:image/png;base64,' + part.imageData} alt={'步骤' + part.stepId} style={{ maxWidth: '100%', borderRadius: theme.rounded.xl, boxShadow: theme.elevation.softLift }} />
                  )}
                </div>
              ) : null}

              <div style={{
                ...theme.typography.bodyMd,
                color: theme.colors.ink,
              }}>
                {renderContent(part.description)}
              </div>
            </div>
          );
        case 'text':
          return (
            <div key={`text-${index}`} style={{ lineHeight: 1.5 }}>
              {renderContent(part.data)}
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
          AI 解题助手
        </h2>
        <p style={{ ...theme.typography.captionMd, color: theme.colors.graphite, margin: '2px 0 0 0' }}>
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
              <span style={{ ...theme.typography.bodyEmphasis, color: theme.colors.ink }}>AI 解题助手</span>
            </div>
            <div style={{ ...theme.typography.bodyMd, color: theme.colors.ink }}>
              <p>你好！我是 AI 解题助手，输入数学问题我会一步步为你解答。</p>
              <p style={{ marginTop: theme.spacing.sm }}>支持的功能：</p>
              <ul style={{ marginLeft: theme.spacing.md, marginTop: '2px' }}>
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
                {message.role === 'user' ? '你' : 'AI 解题助手'}
              </span>
            </div>

            <div style={{
              fontSize: theme.typography.bodyMd.fontSize,
              lineHeight: 1.5,
              color: message.role === 'user' ? theme.colors.onPrimary : theme.colors.ink,
            }}>
              {renderMessageContent(message.content, message.images, message.stepResults)}
            </div>

            {message.imageUrl && (
              <img src={message.imageUrl} alt="uploaded" style={{ maxWidth: '100%', borderRadius: theme.rounded.lg, marginTop: theme.spacing.sm }} />
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
