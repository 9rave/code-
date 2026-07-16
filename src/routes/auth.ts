// 鉴权路由（见开发指南 §6.3）
import type { Env, SessionPayload } from "../types";
import { json, ok, errorBody, HttpError, STATUS } from "../utils/errors";
import { requestId } from "../utils/id";
import * as auth from "../services/auth-service";

export async function login(req: Request, env: Env): Promise<Response> {
  const reqId = requestId();
  const body = await req.json().catch(() => ({}));
  try {
    const { token, user } = await auth.login(
      env,
      body.username,
      body.password,
      req.headers.get("cf-connecting-ip") || "unknown"
    );
    return new Response(
      JSON.stringify(ok({ user: { id: user.id, username: user.username, mustChangePassword: !!user.must_change_password } })),
      { status: 200, headers: { "content-type": "application/json", "set-cookie": auth.sessionCookie(token) } }
    );
  } catch (e) {
    return json(errorBody((e as HttpError).code || "INTERNAL_ERROR", (e as Error).message, reqId), (e as HttpError).status || 500);
  }
}

export async function logout(_req: Request, _env: Env): Promise<Response> {
  return new Response(JSON.stringify(ok({})), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": auth.clearCookie() },
  });
}

export async function changePassword(req: Request, env: Env, user: SessionPayload): Promise<Response> {
  const reqId = requestId();
  const body = await req.json().catch(() => ({}));
  try {
    await auth.changePassword(env, user.sub, body.currentPassword, body.newPassword);
    return json(ok({}));
  } catch (e) {
    return json(errorBody((e as HttpError).code || "INTERNAL_ERROR", (e as Error).message, reqId), (e as HttpError).status || 500);
  }
}

export async function me(_req: Request, env: Env, user: SessionPayload): Promise<Response> {
  const data = await auth.getMe(env, user.sub);
  return json(ok(data));
}
