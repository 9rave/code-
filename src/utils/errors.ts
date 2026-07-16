// 错误封装与统一响应信封（见开发指南 §6.1 / §6.2）

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "HttpError";
  }
}

export const STATUS = {
  VALIDATION_ERROR: 400,
  AUTH_REQUIRED: 401,
  AUTH_FAILED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PUSH_FAILED: 502,
  INTERNAL_ERROR: 500,
} as const;

export function ok(data: unknown, meta?: unknown) {
  return meta === undefined ? { ok: true, data } : { ok: true, data, meta };
}

export function errorBody(code: string, message: string, requestId: string) {
  return { ok: false, error: { code, message, requestId } };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function errorResponse(e: unknown, reqId: string): Response {
  if (e instanceof HttpError) {
    return json(errorBody(e.code, e.message, reqId), e.status);
  }
  console.error("[unhandled]", e);
  return json(errorBody("INTERNAL_ERROR", "服务器内部错误", reqId), 500);
}
