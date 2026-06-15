export class AppError extends Error {
  constructor(status, message, { expose = true } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.expose = expose;
  }
}

export function httpError(status, message, options = {}) {
  return new AppError(status, message, options);
}

function isExpectedHttpError(error) {
  return Number.isInteger(error?.status) && error.status >= 400 && error.status < 600;
}

export function errorPayload(error, fallbackMessage = '请求失败') {
  if (isExpectedHttpError(error)) {
    return {
      status: error.status,
      body: { error: error.message || fallbackMessage },
    };
  }

  const message = String(error?.message || error || '').trim();
  return {
    status: 500,
    body: { error: message ? `${fallbackMessage}: ${message}` : fallbackMessage },
  };
}

export function jsonError(res, error, fallbackMessage) {
  const payload = errorPayload(error, fallbackMessage);
  return res.status(payload.status).json(payload.body);
}
