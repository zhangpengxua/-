import { useContext, useState, useRef, useEffect, useCallback } from 'react';
import { ThemeContext } from '../theme';

const menuIcon = (<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
 <line x1="3" y1="12" x2="21" y2="12"/>
 <line x1="3" y1="6" x2="21" y2="6"/>
 <line x1="3" y1="18" x2="21" y2="18"/>
 </svg>);
const plusIcon = (<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
 <line x1="12" y1="5" x2="12" y2="19"/>
 <line x1="5" y1="12" x2="19" y2="12"/>
 </svg>);
const trashIcon = (<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
 <polyline points="3 6 5 6 21 6"/>
 <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
 <line x1="10" y1="11" x2="10" y2="17"/>
 <line x1="14" y1="11" x2="14" y2="17"/>
 </svg>);
const trashRedIcon = (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff4444" strokeWidth="2">
 <polyline points="3 6 5 6 21 6"/>
 <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
 <line x1="10" y1="11" x2="10" y2="17"/>
 <line x1="14" y1="11" x2="14" y2="17"/>
 </svg>);

const stripMarkdown = (text) => {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`[^`]*`/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\n\s*\n/g, '\n')
    .replace(/^\s+|\s+$/g, '')
    .trim();
};

function ContextMenu({ x, y, onDelete, onClose, theme }) {
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} style={{
      position: 'fixed',
      left: x,
      top: y,
      zIndex: 9999,
      backgroundColor: theme.colors.canvas,
      border: `1px solid ${theme.colors.hairlineStrong}`,
      borderRadius: theme.rounded.md,
      boxShadow: theme.elevation.floatingModal,
      padding: '4px 0',
      minWidth: '160px',
    }}>
      <div onClick={() => { onDelete(); onClose(); }} style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 16px',
        cursor: 'pointer',
        color: '#ff4444',
        fontWeight: 600,
        fontSize: '14px',
        transition: 'background-color 0.15s',
      }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.colors.bloomRose; }}
         onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
        {trashRedIcon}
        删除对话
      </div>
    </div>
  );
}

const Sidebar = ({ conversations, currentConversation, onSelectConversation, onCreateNewConversation, onDeleteConversation, isCollapsed, onToggleCollapse }) => {
  const { theme } = useContext(ThemeContext);
  const [ctxMenu, setCtxMenu] = useState(null);

  const handleContextMenu = useCallback((e, convId) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, convId });
  }, []);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const handleDelete = useCallback(() => {
    if (ctxMenu && confirm('确定删除此对话？')) {
      onDeleteConversation(ctxMenu.convId);
    }
  }, [ctxMenu, onDeleteConversation]);

  return (
    <div style={{
      width: isCollapsed ? '64px' : '280px',
      backgroundColor: theme.colors.cloud,
      display: 'flex',
      flexDirection: 'column',
      borderRight: `1px solid ${theme.colors.hairline}`,
      transition: 'width 0.3s ease',
      flexShrink: 0,
    }}>
      <div style={{
        padding: theme.spacing.sm,
        borderBottom: `1px solid ${theme.colors.hairline}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        {!isCollapsed && (
          <h1 style={{ ...theme.typography.displaySm, color: theme.colors.ink, margin: 0 }}>
            AI 解题助手
          </h1>
        )}
        <button onClick={onToggleCollapse} style={{
          background: 'none', border: 'none', color: theme.colors.graphite, cursor: 'pointer',
          padding: theme.spacing.xs, borderRadius: theme.rounded.md, transition: 'background-color 0.2s',
        }} onMouseEnter={(e) => { e.target.style.backgroundColor = theme.colors.fog; }} onMouseLeave={(e) => { e.target.style.backgroundColor = 'transparent'; }}>
          {menuIcon}
        </button>
      </div>

      <button onClick={onCreateNewConversation} style={{
        ...theme.typography.buttonMd, backgroundColor: theme.colors.primary, color: theme.colors.onPrimary,
        border: 'none', borderRadius: theme.rounded.md, padding: `${theme.spacing.sm} ${theme.spacing.xl}`,
        margin: theme.spacing.md, cursor: 'pointer', transition: 'background-color 0.2s',
        height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm,
      }} onMouseEnter={(e) => { e.target.style.backgroundColor = theme.colors.primaryBright; }} onMouseLeave={(e) => { e.target.style.backgroundColor = theme.colors.primary; }}>
        {plusIcon}
        {!isCollapsed && '新对话'}
      </button>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {conversations.map((conv) => (
          <div key={conv._id}
            onClick={() => onSelectConversation(conv._id)}
            onContextMenu={(e) => handleContextMenu(e, conv._id)}
            style={{
              padding: theme.spacing.md, cursor: 'pointer',
              borderBottom: `1px solid ${theme.colors.hairline}`,
              backgroundColor: currentConversation?._id === conv._id ? theme.colors.canvas : 'transparent',
              transition: 'background-color 0.2s', display: 'flex', alignItems: 'center', gap: theme.spacing.md,
            }}
            onMouseEnter={(e) => {
              if (currentConversation?._id !== conv._id) e.currentTarget.style.backgroundColor = theme.colors.fog;
            }}
            onMouseLeave={(e) => {
              if (currentConversation?._id !== conv._id) e.currentTarget.style.backgroundColor = 'transparent';
            }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: theme.rounded.lg,
              backgroundColor: theme.colors.primarySoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <span style={{ ...theme.typography.bodyEmphasis, color: theme.colors.primary }}>
                {conv.title?.charAt(0) || 'A'}
              </span>
            </div>
            {!isCollapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{
                  ...theme.typography.bodyEmphasis, color: theme.colors.ink, margin: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {conv.title || '未命名对话'}
                </h3>
                <p style={{
                  ...theme.typography.captionMd, color: theme.colors.graphite,
                  margin: '2px 0 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {stripMarkdown(conv.messages?.[conv.messages.length - 1]?.content || '无消息').substring(0, 50) || '无消息'}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {currentConversation && !isCollapsed && (
        <div style={{ padding: theme.spacing.sm, borderTop: `1px solid ${theme.colors.hairline}` }}>
          <button onClick={() => { if (confirm('确定删除此对话？')) onDeleteConversation(currentConversation._id); }} style={{
            ...theme.typography.buttonSm, background: 'none', border: 'none', color: theme.colors.bloomDeep,
            cursor: 'pointer', padding: `${theme.spacing.xs} ${theme.spacing.md}`, borderRadius: theme.rounded.md,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs, width: '100%',
            transition: 'background-color 0.2s',
          }} onMouseEnter={(e) => { e.target.style.backgroundColor = theme.colors.bloomRose; }} onMouseLeave={(e) => { e.target.style.backgroundColor = 'transparent'; }}>
            {trashIcon}
            删除对话
          </button>
        </div>
      )}

      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onDelete={handleDelete} onClose={closeCtxMenu} theme={theme} />
      )}
    </div>
  );
};
export default Sidebar;
