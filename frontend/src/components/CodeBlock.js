import { useState } from 'react';
import axios from 'axios';

const copyIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const checkIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const playIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

function CodeBlock({ code }) {
  const [output, setOutput] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleExecute = async () => {
    setIsRunning(true);
    try {
      const response = await axios.post('http://localhost:5000/api/python/execute', {
        code: code
      });
      setOutput(response.data);
    } catch (error) {
      setOutput({ success: false, error: error.message });
    } finally {
      setIsRunning(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ backgroundColor: '#1e1e1e', borderRadius: '8px', overflow: 'hidden', margin: '12px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: '#2d2d2d' }}>
        <span style={{ fontSize: '12px', color: '#4ec9b0', fontWeight: '600' }}>Python</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            onClick={handleCopy}
            style={{ background: 'none', border: 'none', color: '#888888', cursor: 'pointer', padding: '4px', borderRadius: '4px', transition: 'color 0.2s' }}
            onMouseEnter={(e) => e.target.style.color = '#ffffff'}
            onMouseLeave={(e) => e.target.style.color = '#888888'}
          >
            {copied ? checkIcon : copyIcon}
          </button>
          <button 
            onClick={handleExecute}
            disabled={isRunning}
            style={{ background: 'none', border: 'none', color: '#888888', cursor: 'pointer', padding: '4px', borderRadius: '4px', transition: 'color 0.2s' }}
            onMouseEnter={(e) => e.target.style.color = '#ffffff'}
            onMouseLeave={(e) => e.target.style.color = '#888888'}
          >
            {isRunning ? (
              <div style={{ width: '16px', height: '16px', border: '2px solid #888', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            ) : (
              playIcon
            )}
          </button>
        </div>
      </div>
      <pre style={{ padding: '12px', margin: '0', fontFamily: 'Monaco, Consolas, monospace', fontSize: '13px', lineHeight: '1.5', overflowX: 'auto', color: '#d4d4d4', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {code}
      </pre>
      {output && (
        <div style={{ padding: '12px', borderTop: '1px solid #3d3d3d' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: '600', color: output.success ? '#4ec9b0' : '#f14c4c' }}>
              {output.success ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              )}
              {output.success ? '执行成功' : '执行失败'}
            </span>
          </div>
          {(output.output || output.error) && (
            <pre style={{ 
              backgroundColor: '#0d1117', 
              padding: '12px', 
              borderRadius: '6px', 
              fontFamily: 'Monaco, Consolas, monospace', 
              fontSize: '13px', 
              lineHeight: '1.5', 
              overflowX: 'auto', 
              margin: '0',
              color: output.success ? '#a5d6a7' : '#ffcdd2'
            }}>
              {output.error || output.output}
            </pre>
          )}
        </div>
      )}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default CodeBlock;
