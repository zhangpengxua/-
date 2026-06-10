import { useState, useRef, useContext, useEffect } from 'react';
import { ThemeContext } from '../theme';

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

const checkIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const InputArea = ({ onSendMessage, ocrResult }) => {
  const { theme } = useContext(ThemeContext);
  const [inputValue, setInputValue] = useState('');
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64Raw, setImageBase64Raw] = useState(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [ocrText, setOcrText] = useState('');
  const [isOcrPending, setIsOcrPending] = useState(false);

  // When parent provides OCR result, update the editable text
  useEffect(() => {
    if (ocrResult) {
      setOcrText(ocrResult);
    }
  }, [ocrResult]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isOcrPending) {
      onSendMessage(inputValue.trim() || ocrText, imageBase64Raw, ocrText);
      setInputValue('');
      setImagePreview(null);
      setImageBase64Raw(null);
      setOcrText('');
      setIsOcrPending(false);
    } else if (inputValue.trim() || imagePreview) {
      onSendMessage(inputValue.trim(), imagePreview, null);
      setInputValue('');
      setImagePreview(null);
      setImageBase64Raw(null);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target.result;
        setImagePreview(base64);
        setImageBase64Raw(base64);
        setIsOcrPending(true);
        onSendMessage('__OCR_REQUEST__', base64, null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCameraCapture = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target.result;
        setImagePreview(base64);
        setImageBase64Raw(base64);
        setIsOcrPending(true);
        onSendMessage('__OCR_REQUEST__', base64, null);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setImagePreview(null);
    setImageBase64Raw(null);
    setOcrText('');
    setIsOcrPending(false);
  };

  return (
    <div style={{
      padding: theme.spacing.md,
      borderTop: `1px solid ${theme.colors.hairline}`,
      backgroundColor: theme.colors.canvas,
      flexShrink: 0,
    }}>
      {/* OCR result confirmation area */}
      {isOcrPending && ocrText && (
        <div style={{
          marginBottom: theme.spacing.sm,
          padding: theme.spacing.md,
          backgroundColor: theme.colors.primarySoft,
          borderRadius: theme.rounded.md,
          border: `1px solid ${theme.colors.primary}`,
        }}>
          <div style={{
            ...theme.typography.captionBold,
            color: theme.colors.primary,
            marginBottom: theme.spacing.xs,
          }}>
            图片识别结果（可编辑修改）：
          </div>
          <textarea
            value={ocrText}
            onChange={(e) => setOcrText(e.target.value)}
            style={{
              ...theme.typography.bodyMd,
              width: '100%',
              height: '140px',
              padding: theme.spacing.sm,
              borderRadius: theme.rounded.sm,
              border: `1px solid ${theme.colors.hairlineStrong}`,
              backgroundColor: theme.colors.canvas,
              color: theme.colors.ink,
              outline: 'none',
              resize: 'vertical',
            }}
            onFocus={(e) => { e.target.style.borderColor = theme.colors.primary; }}
            onBlur={(e) => { e.target.style.borderColor = theme.colors.hairlineStrong; }}
          />
        </div>
      )}

      {isOcrPending && !ocrText && (
        <div style={{
          marginBottom: theme.spacing.sm,
          padding: theme.spacing.md,
          backgroundColor: theme.colors.fog,
          borderRadius: theme.rounded.md,
          ...theme.typography.captionMd,
          color: theme.colors.graphite,
        }}>
          正在识别图片文字…
        </div>
      )}

      {/* Image preview */}
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

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: theme.spacing.sm }}>
        <div style={{
          display: 'flex',
          gap: theme.spacing.sm,
          padding: theme.spacing.xs,
          backgroundColor: theme.colors.cloud,
          borderRadius: theme.rounded.lg,
          marginRight: theme.spacing.sm,
        }}>
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
              onClick={(e) => { e.target.value = null; }}
              style={{ display: 'none' }}
            />
          </label>

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
              onClick={(e) => { e.target.value = null; }}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={isOcrPending ? '输入补充说明（可选）…' : '输入数学问题…'}
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

        <button
          type="submit"
          disabled={!isOcrPending && !inputValue.trim() && !imagePreview}
          style={{
            ...theme.typography.buttonMd,
            backgroundColor: (isOcrPending || inputValue.trim() || imagePreview)
              ? theme.colors.primary
              : theme.colors.steel,
            color: theme.colors.onPrimary,
            border: 'none',
            borderRadius: theme.rounded.md,
            padding: `${theme.spacing.sm} ${theme.spacing.xl}`,
            cursor: (isOcrPending || inputValue.trim() || imagePreview) ? 'pointer' : 'not-allowed',
            transition: 'background-color 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.xs,
          }}
          onMouseEnter={(e) => {
            if (isOcrPending || inputValue.trim() || imagePreview) {
              e.target.style.backgroundColor = theme.colors.primaryBright;
            }
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = (isOcrPending || inputValue.trim() || imagePreview)
              ? theme.colors.primary
              : theme.colors.steel;
          }}
        >
          {isOcrPending ? (
            <>
              {checkIcon}
              确认发送
            </>
          ) : (
            <>
              {sendIcon}
              发送
            </>
          )}
        </button>
      </form>
    </div>
  );
};

export default InputArea;
