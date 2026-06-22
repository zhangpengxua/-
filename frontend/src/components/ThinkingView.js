import { useState, useEffect, useRef, useMemo, useContext } from 'react';
import { ThemeContext } from '../theme';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

// ====== LaTeX-aware text renderer ======
const MathText = ({ children, style }) => {
  if (!children) return null;
  const text = String(children);
  // 只有包含 $ 或 \ 的文本才用 ReactMarkdown 渲染，否则直接输出（避免不必要的开销）
  if (!text.includes('$') && !text.includes('\\')) {
    return <span style={style}>{text}</span>;
  }
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p: ({ children: pChild }) => <span style={style}>{pChild}</span>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
};

// ====== Icons ======
const BrainIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a4 4 0 0 1 4 4c0 1.1-.4 2.1-1.2 2.8" />
    <path d="M8 6a4 4 0 0 1 4-4" />
    <path d="M6 12a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4" />
    <path d="M2 12h20" />
    <path d="M12 12v10" />
    <circle cx="12" cy="16" r="1" />
    <circle cx="12" cy="20" r="1" />
  </svg>
);

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

const FunctionIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16v16H4z" />
    <path d="M9 8h6" />
    <path d="M9 12h6" />
    <path d="M9 16h4" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const CodeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

const ChevronDownIcon = ({ open }) => (
  <svg
    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const SparkleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.5 4.5L6 9l4.5 1.5L12 15l1.5-4.5L18 9l-4.5-1.5Z" />
    <path d="M4 18c2.5 1.5 5 2 8 2s5.5-.5 8-2" />
  </svg>
);

const LayerIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-9 6 9 6 9-6-9-6z" />
    <path d="m5 12-2 1.5 9 6 9-6-2-1.5" />
  </svg>
);

// ====== Shimmer / Loading animation ======
const Shimmer = ({ children }) => (
  <span style={{
    display: 'inline-block',
    background: 'linear-gradient(90deg, currentColor 30%, transparent 50%, currentColor 70%)',
    backgroundSize: '200% 100%',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    animation: 'shimmer 1.5s ease-in-out infinite',
    color: 'transparent',
  }}>{children}</span>
);

// ====== ThinkingStep ======
const ThinkingStep = ({ icon, label, description, status, children, theme, defaultOpen }) => {
  const [open, setOpen] = useState(defaultOpen ?? (status === 'active'));

  useEffect(() => {
    if (status === 'active') setOpen(true);
  }, [status]);

  const statusColor = status === 'completed' ? '#22c55e' :
    status === 'active' ? theme?.colors?.primary || '#4d96ff' :
    '#6b7280';

  const opacity = status === 'pending' ? 0.5 : 1;

  return (
    <div style={{
      opacity,
      transition: 'opacity 0.3s, transform 0.3s',
      transform: status === 'pending' ? 'translateX(-4px)' : 'translateX(0)',
    }}>
      <div
        onClick={() => status !== 'pending' && setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
          padding: '6px 0',
          cursor: status === 'pending' ? 'default' : 'pointer',
        }}
      >
        {/* Icon + Connector line */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{
            width: '28px', height: '28px', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: status === 'completed' ? '#22c55e' :
              status === 'active' ? (theme?.colors?.primaryLight || '#e0e7ff') : '#e5e7eb',
            color: status === 'completed' ? '#fff' :
              status === 'active' ? (theme?.colors?.primary || '#4d96ff') : '#9ca3af',
            transition: 'all 0.3s',
            flexShrink: 0,
          }}>
            {status === 'completed' ? <CheckIcon /> :
              status === 'active' ? <Spinner size={14} /> : icon}
          </div>
          {/* Vertical connector line */}
          <div style={{
            width: '1px', flex: 1, minHeight: '12px',
            backgroundColor: '#e5e7eb', marginTop: '4px',
          }} />
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            fontWeight: 500, fontSize: '13px', color: '#374151',
          }}>
            <span style={{ color: statusColor, transition: 'color 0.3s' }}>
              {status === 'active' ? <Shimmer>{label}</Shimmer> : label}
            </span>
            {status !== 'pending' && (
              <span style={{ marginLeft: 'auto', color: '#9ca3af', display: 'flex', alignItems: 'center' }}>
                <ChevronDownIcon open={open} />
              </span>
            )}
          </div>
          {description && (
            <div style={{
              fontSize: '12px', color: '#6b7280', marginTop: '2px',
              lineHeight: 1.4,
            }}><MathText>{description}</MathText></div>
          )}

          {/* Expandable detail */}
          {status !== 'pending' && open && children && (
            <div style={{
              marginTop: '8px', padding: '8px 10px',
              backgroundColor: '#f9fafb', borderRadius: '6px',
              border: '1px solid #e5e7eb', fontSize: '12px',
              color: '#4b5563', lineHeight: 1.5,
              animation: 'fadeSlideIn 0.2s ease-out',
            }}>
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ====== Spinner ======
const Spinner = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

// ====== Main ThinkingView Component ======
const ThinkingView = ({ thinkingState, theme }) => {
  if (!thinkingState) return null;

  const { phase, steps, currentStepIndex, layer1Steps, functionPoolUsed, error } = thinkingState;
  const styles = {
    container: {
      margin: '12px 0',
      borderRadius: '10px',
      border: '1px solid #e5e7eb',
      overflow: 'hidden',
      backgroundColor: '#ffffff',
    },
    header: {
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '10px 14px',
      backgroundColor: '#f3f4f6',
      borderBottom: phase === 'complete' ? '1px solid #e5e7eb' : '1px solid #dbeafe',
      fontSize: '13px', fontWeight: 600, color: '#374151',
    },
    headerDot: {
      width: '8px', height: '8px', borderRadius: '50%',
      backgroundColor: phase === 'complete' ? '#22c55e' : '#4d96ff',
      animation: phase === 'thinking' ? 'pulse 1.5s ease-in-out infinite' : 'none',
    },
    body: {
      padding: '8px 14px 12px',
    },
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerDot} />
        <LayerIcon />
        <span>
          {phase === 'thinking' ? 'AI 思考中...' :
           phase === 'complete' ? 'AI 思考完成' :
           'AI 处理中'}
        </span>
        {phase === 'thinking' && <Spinner size={12} />}
      </div>

      {/* Steps */}
      <div style={styles.body}>
        {/* Step 1: Problem Analysis */}
        <ThinkingStep
          theme={theme}
          icon={<SearchIcon />}
          label="分析题目"
          description="第一层大模型解读题目内容，识别题型和数学领域"
          status={phase === 'complete' ? 'completed' : phase === 'thinking' && currentStepIndex === undefined ? 'active' : 'completed'}
          defaultOpen={false}
        >
          {steps?.problemAnalysis && (
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>题目分析结果：</div>
              <MathText>{steps.problemAnalysis}</MathText>
            </div>
          )}
        </ThinkingStep>

        {/* Step 2: Step Extraction */}
        <ThinkingStep
          theme={theme}
          icon={<CodeIcon />}
          label="拆解题步骤"
          description="第一层大模型将问题分解为可执行的步骤序列"
          status={currentStepIndex === undefined && phase === 'thinking' ? 'pending' :
            currentStepIndex >= 0 || phase === 'complete' ? 'completed' :
            currentStepIndex === undefined && phase !== 'thinking' ? 'pending' : 'active'}
          defaultOpen={true}
        >
          {layer1Steps?.length > 0 && (
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>提取到 {layer1Steps.length} 个步骤：</div>
              {layer1Steps.map((s, i) => (
                <div key={i} style={{
                  padding: '4px 8px', margin: '2px 0',
                  backgroundColor: i === currentStepIndex && phase === 'thinking' ? '#dbeafe' : 'transparent',
                  borderRadius: '4px', fontSize: '12px',
                }}>
                  <strong>步骤 {s.id}:</strong>{' '}
                  <MathText>{s.description?.substring(0, 100)}</MathText>
                  {s.needImage && <span style={{ color: '#4d96ff', marginLeft: 4 }}>[需绘图]</span>}
                </div>
              ))}
            </div>
          )}
        </ThinkingStep>

        {/* Step 3: Function/Drawing Extraction */}
        <ThinkingStep
          theme={theme}
          icon={<FunctionIcon />}
          label="提取绘制数据"
          description="第二层大模型提取几何参数和函数方程"
          status={phase === 'complete' ? 'completed' :
            phase === 'thinking' && currentStepIndex >= 0 ? 'active' : 'pending'}
          defaultOpen={true}
        >
          {currentStepIndex >= 0 && layer1Steps?.[currentStepIndex]?.drawingData && (
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>绘制数据：</div>
              <pre style={{
                fontSize: '11px', whiteSpace: 'pre-wrap',
                backgroundColor: '#f3f4f6', padding: '6px',
                borderRadius: '4px', maxHeight: '120px', overflow: 'auto',
              }}>
                {JSON.stringify(layer1Steps[currentStepIndex].drawingData, null, 2)}
              </pre>
            </div>
          )}
        </ThinkingStep>

        {/* Step 4: Function Pool Fallback */}
        {functionPoolUsed && (
          <ThinkingStep
            theme={theme}
            icon={<SparkleIcon />}
            label="函数池补充"
            description="大模型未能提取完整数据，从函数池中匹配补充"
            status="completed"
            defaultOpen={true}
          >
            <div style={{ color: '#6b7280' }}>
              ✓ 已从函数池中匹配到相关函数模板，补充到绘制数据中
            </div>
          </ThinkingStep>
        )}

        {/* Step 5: Answer Generation */}
        <ThinkingStep
          theme={theme}
          icon={<BrainIcon />}
          label="生成最终答案"
          description="第三层大模型整合步骤结果，生成完整解答"
          status={phase === 'complete' ? 'completed' :
            phase === 'thinking' ? 'pending' : 'pending'}
          defaultOpen={false}
        />
      </div>
    </div>
  );
};

export default ThinkingView;

// Inject keyframe animations
if (typeof document !== 'undefined') {
  const styleId = 'thinking-view-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(0.8); }
      }
      @keyframes fadeSlideIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }
}