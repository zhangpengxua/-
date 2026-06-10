import { useState, useRef } from 'react';
import { theme } from '../theme';

const sendIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9" />
  </svg>
);

const imageIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

const cameraIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

const fileIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const InputArea = ({ onSendMessage }) => {
  const [inputValue, setInputValue] = useState('');
  const [imagePreview, setImagePreview] = useState(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inputValue.trim() || imagePreview) {
      onSendMessage(inputValue.trim(), imagePreview);
      setInputValue('');
      setImagePreview(null);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImagePreview(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCameraCapture = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImagePreview(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setImagePreview(null);
  };

  return (
    <div style={{
      padding: theme.spacing.md,
      borderTop: `1px solid ${theme.colors.hairline}`,
      backgroundColor: theme.colors.canvas,
    }}>
      {/* 图片预览 */}
      {imagePreview && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          marginBottom: theme.spacing.sm,
          padding: theme.spacing.sm,
          backgroundColor: theme.colors.cloud,
          borderRadius: theme.rounded.md,
        }}>
          <img 
            src={imagePreview} 
            alt="预览" 
            style={{ 
              height: '60px', 
              borderRadius: theme.rounded.sm,
              objectFit: 'cover',
            }} 
          />
          <button
            onClick={removeImage}
            style={{
              ...theme.typography.buttonSm,
              color: theme.colors.bloomDeep,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: theme.spacing.xs,
              borderRadius: theme.rounded.sm,
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => { e.target.style.backgroundColor = theme.colors.bloomRose; }}
            onMouseLeave={(e) => { e.target.style.backgroundColor = 'transparent'; }}
          >
            移除
          </button>
        </div>
      )}

      {/* 输入框 */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: theme.spacing.sm }}>
        <div style={{
          display: 'flex',
          gap: theme.spacing.sm,
          padding: theme.spacing.xs,
          backgroundColor: theme.colors.cloud,
          borderRadius: theme.rounded.lg,
          marginRight: theme.spacing.sm,
        }}>
          {/* 图片上传按钮 */}
          <label style={{
            cursor: 'pointer',
            padding: theme.spacing.sm,
            borderRadius: theme.rounded.md,
            color: theme.colors.graphite,
            transition: 'background-color 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }} onMouseEnter={(e) => { e.target.style.backgroundColor = theme.colors.fog; }} onMouseLeave={(e) => { e.target.style.backgroundColor = 'transparent'; }}>
            {imageIcon}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
          </label>

          {/* 相机按钮 */}
          <label style={{
            cursor: 'pointer',
            padding: theme.spacing.sm,
            borderRadius: theme.rounded.md,
            color: theme.colors.graphite,
            transition: 'background-color 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }} onMouseEnter={(e) => { e.target.style.backgroundColor = theme.colors.fog; }} onMouseLeave={(e) => { e.target.style.backgroundColor = 'transparent'; }}>
            {cameraIcon}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleCameraCapture}
              style={{ display: 'none' }}
            />
          </label>

          {/* 文件上传按钮 */}
          <label style={{
            cursor: 'pointer',
            padding: theme.spacing.sm,
            borderRadius: theme.rounded.md,
            color: theme.colors.graphite,
            transition: 'background-color 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }} onMouseEnter={(e) => { e.target.style.backgroundColor = theme.colors.fog; }} onMouseLeave={(e) => { e.target.style.backgroundColor = 'transparent'; }}>
            {fileIcon}
            <input
              type="file"
              onChange={(e) => {
                const file = e.target.files[0];
                if (file) {
                  console.log('File selected:', file.name);
                }
              }}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {/* 文本输入 */}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="输入数学问题..."
          style={{
            ...theme.typography.bodyMd,
            flex: 1,
            padding: `${theme.spacing.sm} ${theme.spacing.md}`,
            borderRadius: theme.rounded.md,
            border: `1px solid ${theme.colors.hairline}`,
            backgroundColor: theme.colors.canvas,
            color: theme.colors.ink,
            outline: 'none',
            transition: 'border-color 0.2s',
          }}
          onFocus={(e) => { e.target.style.borderColor = theme.colors.primary; }}
          onBlur={(e) => { e.target.style.borderColor = theme.colors.hairline; }}
        />

        {/* 发送按钮 */}
        <button
          type="submit"
          disabled={!inputValue.trim() && !imagePreview}
          style={{
            ...theme.typography.buttonMd,
            backgroundColor: inputValue.trim() || imagePreview
              ? theme.colors.primary
              : theme.colors.steel,
            color: theme.colors.onPrimary,
            border: 'none',
            borderRadius: theme.rounded.md,
            padding: `${theme.spacing.sm} ${theme.spacing.xl}`,
            cursor: inputValue.trim() || imagePreview ? 'pointer' : 'not-allowed',
            transition: 'background-color 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.xs,
          }}
          onMouseEnter={(e) => {
            if (inputValue.trim() || imagePreview) {
              e.target.style.backgroundColor = theme.colors.primaryBright;
            }
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = inputValue.trim() || imagePreview
              ? theme.colors.primary
              : theme.colors.steel;
          }}
        >
          {sendIcon}
          发送
        </button>
      </form>
    </div>
  );
};

export default InputArea;