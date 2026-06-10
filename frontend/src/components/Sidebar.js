import { theme } from '../theme';
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
const Sidebar = ({ conversations, currentConversation, onSelectConversation, onCreateNewConversation, onDeleteConversation, isCollapsed, onToggleCollapse }) => {
 return (<div style={{
 width: isCollapsed ? '64px' : '280px',
 backgroundColor: theme.colors.cloud,
 display: 'flex',
 flexDirection: 'column',
 borderRight: `1px solid ${theme.colors.hairline}`,
 transition: 'width 0.3s ease',
 }}>
 {/* 顶部工具栏 */}
 <div style={{
 padding: theme.spacing.sm,
 borderBottom: `1px solid ${theme.colors.hairline}`,
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'space-between',
 }}>
 {!isCollapsed && (<h1 style={{
 ...theme.typography.displaySm,
 color: theme.colors.ink,
 margin: 0,
 }}>
 AI 解题助手
 </h1>)}
 <button onClick={onToggleCollapse} style={{
 background: 'none',
 border: 'none',
 color: theme.colors.graphite,
 cursor: 'pointer',
 padding: theme.spacing.xs,
 borderRadius: theme.rounded.md,
 transition: 'background-color 0.2s',
 }} onMouseEnter={(e) => { e.target.style.backgroundColor = theme.colors.fog; }} onMouseLeave={(e) => { e.target.style.backgroundColor = 'transparent'; }}>
 {menuIcon}
 </button>
 </div>

 {/* 新对话按钮 */}
 <button onClick={onCreateNewConversation} style={{
 ...theme.typography.buttonMd,
 backgroundColor: theme.colors.primary,
 color: theme.colors.onPrimary,
 border: 'none',
 borderRadius: theme.rounded.md,
 padding: `${theme.spacing.sm} ${theme.spacing.xl}`,
 margin: theme.spacing.md,
 cursor: 'pointer',
 transition: 'background-color 0.2s',
 height: '44px',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 gap: theme.spacing.sm,
 }} onMouseEnter={(e) => { e.target.style.backgroundColor = theme.colors.primaryBright; }} onMouseLeave={(e) => { e.target.style.backgroundColor = theme.colors.primary; }}>
 {plusIcon}
 {!isCollapsed && '新对话'}
 </button>

 {/* 历史记录列表 */}
 <div style={{ flex: 1, overflowY: 'auto' }}>
 {conversations.map((conv) => (<div key={conv._id} onClick={() => onSelectConversation(conv._id)} style={{
 padding: theme.spacing.md,
 cursor: 'pointer',
 borderBottom: `1px solid ${theme.colors.hairline}`,
 backgroundColor: currentConversation?._id === conv._id
 ? theme.colors.canvas
 : 'transparent',
 transition: 'background-color 0.2s',
 display: 'flex',
 alignItems: 'center',
 gap: theme.spacing.md,
 }} onMouseEnter={(e) => {
 if (currentConversation?._id !== conv._id) {
 e.currentTarget.style.backgroundColor = theme.colors.fog;
 }
 }} onMouseLeave={(e) => {
 if (currentConversation?._id !== conv._id) {
 e.currentTarget.style.backgroundColor = 'transparent';
 }
 }}>
 <div style={{
 width: '40px',
 height: '40px',
 borderRadius: theme.rounded.lg,
 backgroundColor: theme.colors.primarySoft,
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 flexShrink: 0,
 }}>
 <span style={{
 ...theme.typography.bodyEmphasis,
 color: theme.colors.primary,
 }}>
 {conv.title?.charAt(0) || 'A'}
 </span>
 </div>
 
 {!isCollapsed && (<div style={{ flex: 1, minWidth: 0 }}>
 <h3 style={{
 ...theme.typography.bodyEmphasis,
 color: theme.colors.ink,
 margin: 0,
 overflow: 'hidden',
 textOverflow: 'ellipsis',
 whiteSpace: 'nowrap',
 }}>
 {conv.title || '未命名对话'}
 </h3>
 <p style={{
 ...theme.typography.captionMd,
 color: theme.colors.graphite,
 margin: `${theme.spacing.xxs} 0 0 0`,
 overflow: 'hidden',
 textOverflow: 'ellipsis',
 whiteSpace: 'nowrap',
 }}>
 {conv.messages?.[conv.messages.length - 1]?.content?.substring(0, 50) || '无消息'}
 </p>
 </div>)}
 </div>))}
 </div>

 {/* 删除按钮 */}
 {currentConversation && !isCollapsed && (<div style={{
 padding: theme.spacing.sm,
 borderTop: `1px solid ${theme.colors.hairline}`,
 }}>
 <button onClick={() => { if (confirm('确定删除此对话？'))
 onDeleteConversation(currentConversation._id); }} style={{
 ...theme.typography.buttonSm,
 background: 'none',
 border: 'none',
 color: theme.colors.bloomDeep,
 cursor: 'pointer',
 padding: `${theme.spacing.xs} ${theme.spacing.md}`,
 borderRadius: theme.rounded.md,
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 gap: theme.spacing.xs,
 width: '100%',
 transition: 'background-color 0.2s',
 }} onMouseEnter={(e) => { e.target.style.backgroundColor = theme.colors.bloomRose; }} onMouseLeave={(e) => { e.target.style.backgroundColor = 'transparent'; }}>
 {trashIcon}
 删除对话
 </button>
 </div>)}
 </div>);
};
export default Sidebar;