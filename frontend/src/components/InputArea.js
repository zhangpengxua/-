import { useState, useRef, useContext, useEffect, useCallback } from 'react';
import { ThemeContext } from '../theme';

const sendIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9"/></svg>
);
const stopIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
);
const imageIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
);
const cameraIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
);
const checkIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
);

const InputArea = ({ onSendMessage, ocrResult, isLoading, onStop }) => {
  const { theme } = useContext(ThemeContext);
  const [inputValue, setInputValue] = useState('');
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64Raw, setImageBase64Raw] = useState(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [ocrText, setOcrText] = useState('');
  const [isOcrPending, setIsOcrPending] = useState(false);
  const [ocrArrivedAt, setOcrArrivedAt] = useState(0);
  const [ocrMinDisplayed, setOcrMinDisplayed] = useState(false);

  // Fix 1: OCR results must be shown for at least 1 second before allowing submit
  useEffect(() => {
    if (ocrResult && isOcrPending) {
      setOcrText(ocrResult);
      setOcrArrivedAt(Date.now());
      setOcrMinDisplayed(false);
      const timer = setTimeout(() => setOcrMinDisplayed(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [ocrResult]);

  // Update editable OCR text when parent provides result
  useEffect(() => {
    if (ocrResult) {
      setOcrText(ocrResult);
    }
  }, [ocrResult]);

  const canSubmitOcr = isOcrPending && ocrText && ocrMinDisplayed;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isLoading) {
      onStop?.();
      return;
    }
    if (canSubmitOcr) {
      // 用户点击发送，提交完整的消息（包含图片和 OCR 文字）
      onSendMessage(inputValue.trim() || ocrText, imageBase64Raw, ocrText);
      setInputValue(''); setImagePreview(null); setImageBase64Raw(null);
      setOcrText(''); setIsOcrPending(false); setOcrMinDisplayed(false);
    } else if (!isOcrPending && (inputValue.trim() || imagePreview)) {
      // 普通文本或图片消息
      onSendMessage(inputValue.trim(), imagePreview, null);
      setInputValue(''); setImagePreview(null); setImageBase64Raw(null);
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
        setOcrText(''); setIsOcrPending(true); setOcrMinDisplayed(false);
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
        setOcrText(''); setIsOcrPending(true); setOcrMinDisplayed(false);
        onSendMessage('__OCR_REQUEST__', base64, null);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setImagePreview(null); setImageBase64Raw(null);
    setOcrText(''); setIsOcrPending(false); setOcrMinDisplayed(false);
  };

  const submitDisabled = isLoading ? false
    : canSubmitOcr ? false
    : isOcrPending ? true
    : !inputValue.trim() && !imagePreview;

  const isStop = isLoading;

  return (
    <div style={{
      padding: theme.spacing.md, borderTop: '1px solid ' + theme.colors.hairline,
      backgroundColor: theme.colors.canvas, flexShrink: 0,
    }}>
      {/* OCR confirmation area */}
      {isOcrPending && ocrText && (
        <div style={{
          marginBottom: theme.spacing.sm, padding: theme.spacing.md,
          backgroundColor: theme.colors.primarySoft, borderRadius: theme.rounded.md,
          border: '1px solid ' + theme.colors.primary,
        }}>
          <div style={{ ...theme.typography.captionBold, color: theme.colors.primary, marginBottom: theme.spacing.xs }}>
            图片识别结果（可编辑修改）{!ocrMinDisplayed ? ' — 请审阅后确认' : ''}：
          </div>
          <textarea value={ocrText} onChange={e => setOcrText(e.target.value)}
            style={{ ...theme.typography.bodyMd, width: '100%', height: '140px', padding: theme.spacing.sm,
              borderRadius: theme.rounded.sm, border: '1px solid ' + theme.colors.hairlineStrong,
              backgroundColor: theme.colors.canvas, color: theme.colors.ink, outline: 'none', resize: 'vertical' }}
            onFocus={e => { e.target.style.borderColor = theme.colors.primary; }}
            onBlur={e => { e.target.style.borderColor = theme.colors.hairlineStrong; }}
          />
        </div>
      )}

      {isOcrPending && !ocrText && (
        <div style={{ marginBottom: theme.spacing.sm, padding: theme.spacing.md,
          backgroundColor: theme.colors.fog, borderRadius: theme.rounded.md,
          ...theme.typography.captionMd, color: theme.colors.graphite }}>
          正在识别图片文字…
        </div>
      )}

      {/* Image preview */}
      {imagePreview && (
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm,
          marginBottom: theme.spacing.sm, padding: theme.spacing.sm,
          backgroundColor: theme.colors.cloud, borderRadius: theme.rounded.md }}>
          <img src={imagePreview} alt="预览" style={{ height: '60px', borderRadius: theme.rounded.sm, objectFit: 'cover' }} />
          <button onClick={removeImage} style={{ ...theme.typography.buttonSm, color: theme.colors.bloomDeep,
            background: 'none', border: 'none', cursor: 'pointer', padding: theme.spacing.xs, borderRadius: theme.rounded.sm }}
            onMouseEnter={e => { e.target.style.backgroundColor = theme.colors.bloomRose; }}
            onMouseLeave={e => { e.target.style.backgroundColor = 'transparent'; }}>
            移除
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: theme.spacing.sm }}>
        <div style={{ display: 'flex', gap: theme.spacing.sm, padding: theme.spacing.xs,
          backgroundColor: theme.colors.cloud, borderRadius: theme.rounded.lg, marginRight: theme.spacing.sm }}>
          <label style={{ cursor: 'pointer', padding: theme.spacing.sm, borderRadius: theme.rounded.md,
            color: theme.colors.graphite, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={e => { e.target.style.backgroundColor = theme.colors.fog; }}
            onMouseLeave={e => { e.target.style.backgroundColor = 'transparent'; }}>
            {imageIcon}
            <input ref={fileInputRef} type="file" accept="image/*"
              onChange={handleImageUpload} onClick={e => { e.target.value = null; }} style={{ display: 'none' }} />
          </label>
          <label style={{ cursor: 'pointer', padding: theme.spacing.sm, borderRadius: theme.rounded.md,
            color: theme.colors.graphite, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={e => { e.target.style.backgroundColor = theme.colors.fog; }}
            onMouseLeave={e => { e.target.style.backgroundColor = 'transparent'; }}>
            {cameraIcon}
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment"
              onChange={handleCameraCapture} onClick={e => { e.target.value = null; }} style={{ display: 'none' }} />
          </label>
        </div>

        {/* Fix 6: Edit last message button - moved to ChatArea, now on last user message bubble */}

        <input type="text" value={inputValue} onChange={e => setInputValue(e.target.value)}
          placeholder={isOcrPending ? '输入补充说明（可选）…' : '输入数学问题…'}
          style={{ ...theme.typography.bodyMd, flex: 1, padding: theme.spacing.sm + ' ' + theme.spacing.md,
            borderRadius: theme.rounded.md, border: '1px solid ' + theme.colors.hairline,
            backgroundColor: theme.colors.canvas, color: theme.colors.ink, outline: 'none', transition: 'border-color 0.2s' }}
          onFocus={e => { e.target.style.borderColor = theme.colors.primary; }}
          onBlur={e => { e.target.style.borderColor = theme.colors.hairline; }}
        />

        {/* Fix 5: Stop button during thinking */}
        <button type="submit" disabled={submitDisabled}
          style={{ ...theme.typography.buttonMd,
            backgroundColor: isStop ? theme.colors.bloomCoral
              : ((canSubmitOcr || inputValue.trim() || imagePreview) ? theme.colors.primary : theme.colors.steel),
            color: isStop ? '#fff' : theme.colors.onPrimary,
            border: 'none', borderRadius: theme.rounded.md,
            padding: theme.spacing.sm + ' ' + theme.spacing.xl,
            cursor: submitDisabled ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.2s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs,
          }}
          onMouseEnter={e => {
            if (!submitDisabled) e.target.style.backgroundColor = isStop ? theme.colors.bloomDeep : theme.colors.primaryBright;
          }}
          onMouseLeave={e => {
            if (!submitDisabled) e.target.style.backgroundColor = isStop ? theme.colors.bloomCoral
              : ((canSubmitOcr || inputValue.trim() || imagePreview) ? theme.colors.primary : theme.colors.steel);
          }}>
          {isStop ? (<>{stopIcon}停止</>)
            : isOcrPending ? (<>{checkIcon}确认发送</>)
            : (<>{sendIcon}发送</>)}
        </button>
      </form>
    </div>
  );
};

export default InputArea;
