// Worker 入口：HTTP 路由 + Cron 分发（见开发指南 §6 / §9.2）
import type { Env } from "./types";
import type { ScheduledController, ExecutionContext } from "@cloudflare/workers-types";
import { json, errorBody } from "./utils/errors";
import * as auth from "./services/auth-service";
import * as taskSvc from "./services/task-service";
import * as reviewSvc from "./services/review-service";
import * as pushSvc from "./services/push-service";
import * as authRoutes from "./routes/auth";
import * as taskRoutes from "./routes/tasks";
import * as reviewRoutes from "./routes/reviews";
import * as settingsRoutes from "./routes/settings";
import { runMorning, runEvening, runWeekly } from "./jobs";

async function guard(env: Env, req: Request) {
  return auth.requireUser(env, req);
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const reqId = crypto.randomUUID();

    try {
      // ---- 鉴权 ----
      if (path === "/api/auth/login" && method === "POST") return authRoutes.login(req, env);
      if (path === "/api/auth/logout" && method === "POST") return authRoutes.logout(req, env);
      if (path === "/api/auth/change-password" && method === "POST") {
        const u = await guard(env, req);
        return authRoutes.changePassword(req, env, u);
      }
      if (path === "/api/auth/me" && method === "GET") {
        const u = await guard(env, req);
        return authRoutes.me(req, env, u);
      }

      // ---- 任务 ----
      if (path === "/api/tasks" && method === "GET") {
        const u = await guard(env, req);
        return taskRoutes.list(req, env, u);
      }
      if (path === "/api/tasks" && method === "POST") {
        const u = await guard(env, req);
        return taskRoutes.create(req, env, u);
      }
      const m = path.match(/^\/api\/tasks\/([^/]+)$/);
      if (m && method === "GET") return taskRoutes.get(req, env, await guard(env, req), m[1]);
      if (m && method === "PATCH") return taskRoutes.patch(req, env, await guard(env, req), m[1]);
      if (m && method === "DELETE") return taskRoutes.remove(req, env, await guard(env, req), m[1]);
      const mc = path.match(/^\/api\/tasks\/([^/]+)\/complete$/);
      if (mc && method === "POST") return taskRoutes.complete(req, env, await guard(env, req), mc[1]);
      const mr = path.match(/^\/api\/tasks\/([^/]+)\/rollover$/);
      if (mr && method === "POST") return taskRoutes.rollover(req, env, await guard(env, req), mr[1]);

      // ---- 日志 / 复盘 ----
      if (path === "/api/daily-log" && method === "GET") return reviewRoutes.getDailyLog(req, env, await guard(env, req));
      const md = path.match(/^\/api\/daily-log\/([^/]+)$/);
      if (md && method === "PUT") return reviewRoutes.upsertDailyLog(req, env, await guard(env, req), md[1]);
      if (path === "/api/reviews" && method === "GET") return reviewRoutes.list(req, env, await guard(env, req));
      if (path === "/api/reviews/generate" && method === "POST") return reviewRoutes.generate(req, env, await guard(env, req));

      // ---- 设置 ----
      if (path === "/api/settings/status" && method === "GET") return settingsRoutes.status(req, env, await guard(env, req));
      if (path === "/api/settings/test-push" && method === "POST") return settingsRoutes.testPushRoute(req, env, await guard(env, req));

      // ---- 静态前端（Workers Assets / Pages） ----
      if (env.ASSETS) return env.ASSETS.fetch(req);

      return json(errorBody("NOT_FOUND", "路径不存在", reqId), 404);
    } catch (e: any) {
      return json(errorBody(e?.code || "INTERNAL_ERROR", e?.message || "服务器内部错误", reqId), e?.status || 500);
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const handlers: Record<string, (env: Env) => Promise<void>> = {
      "30 0 * * 1-5": runMorning,
      "30 10 * * *": runEvening,
      "45 10 * * 5": runWeekly,
    };
    const h = handlers[event.cron];
    if (h) ctx.waitUntil(h(env));
  },
};
