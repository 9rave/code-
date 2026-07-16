// 鉴权路由（见开发指南 §6.3）
import type { Env, SessionPayload } from "../types";
import { json, ok, errorResponse } from "../utils/errors";
import { requestId } from "../utils/id";
import * as auth from "../services/auth-service";

export async function login(req: Request, env: Env): Promise<Response> {
  const reqId = requestId();
  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
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
    return errorResponse(e, reqId);
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
  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  try {
    await auth.changePassword(env, user.sub, body.currentPassword, body.newPassword);
    return json(ok({}));
  } catch (e) {
    return errorResponse(e, reqId);
  }
}

export async function me(_req: Request, env: Env, user: SessionPayload): Promise<Response> {
  const data = await auth.getMe(env, user.sub);
  return json(ok(data));
}
