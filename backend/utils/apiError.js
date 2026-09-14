// 统一业务错误：所有新接口与任务错误遵循 {error:{code,message,retryable,details}} 约定。
const STATUS_BY_CODE = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  SOURCE_CHANGED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  ATTEMPT_IN_PROGRESS: 409,
  ANSWER_ALREADY_REVEALED: 409,
  HINTS_EXHAUSTED: 409,
  INSUFFICIENT_DATA: 422,
  CAPACITY_LIMIT: 429,
  LLM_INVALID_OUTPUT: 502,
  LLM_UPSTREAM_ERROR: 502,
  LLM_TIMEOUT: 504,
  TIMEOUT: 504,
  CANCELLED: 409,
  INTERNAL: 500,
};

const RETRYABLE_BY_CODE = {
  INVALID_INPUT: false,
  NOT_FOUND: false,
  SOURCE_CHANGED: false,
  IDEMPOTENCY_CONFLICT: false,
  ATTEMPT_IN_PROGRESS: true,
  ANSWER_ALREADY_REVEALED: false,
  HINTS_EXHAUSTED: false,
  INSUFFICIENT_DATA: false,
  CAPACITY_LIMIT: true,
  LLM_INVALID_OUTPUT: false,
  LLM_UPSTREAM_ERROR: true,
  LLM_TIMEOUT: true,
  TIMEOUT: true,
  CANCELLED: false,
  INTERNAL: true,
};

class ApiError extends Error {
  constructor(code, message, { status, retryable, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = STATUS_BY_CODE[code] ? code : 'INTERNAL';
    this.status = status || STATUS_BY_CODE[this.code] || 500;
    this.retryable = retryable === undefined ? (RETRYABLE_BY_CODE[this.code] ?? false) : Boolean(retryable);
    this.details = details === undefined ? null : details;
  }

  toBody() {
    return { error: { code: this.code, message: this.message, retryable: this.retryable, details: this.details } };
  }
}

// 将任意异常转换为错误响应体；未知异常不向上游泄漏完整堆栈。
function toErrorBody(err) {
  if (err instanceof ApiError) return err.toBody();
  return { error: { code: 'INTERNAL', message: err?.message || '服务器内部错误', retryable: true, details: null } };
}

function sendApiError(res, err) {
  if (err instanceof ApiError) return res.status(err.status).json(err.toBody());
  console.error('[apiError] unexpected error:', err);
  return res.status(500).json(toErrorBody(err));
}

module.exports = { ApiError, toErrorBody, sendApiError };
