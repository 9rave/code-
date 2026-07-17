/**
 * Integration test harness for AI Todo Assistant.
 *
 * Strategy: spin up a single Miniflare instance (workerd) and grab a *real*
 * D1 database from it. We then drive the Worker's `default.fetch` and
 * `default.scheduled` handlers exactly as production would, with an ephemeral
 * D1 backing every request. No database mocking — cross-module collaboration
 * (routes → services → queries → D1, plus sessions, rate-limit, push) is
 * exercised against the same SQLite engine Cloudflare runs in production.
 *
 * Each test resets the schema (DROP + re-apply migrations) so suites are
 * fully isolated even though they share one D1 handle.
 */
import { Miniflare } from "miniflare";
import { vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { D1Database, ExecutionContext } from "@cloudflare/workers-types";

import app from "../../src/index";
import type { Env } from "../../src/types";
import * as q from "../../src/db/queries";
import { hashPassword, generateSalt, passwordParams } from "../../src/security/password";
import { signSession } from "../../src/security/session";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- migrations (read once at module load) ----
const MIGRATION_FILES = [
  join(HERE, "../../src/db/migrations/0001_init.sql"),
  join(HERE, "../../src/db/migrations/0002_rate_limits.sql"),
];
// D1's exec() rejects SQL beginning a statement with a "--" comment, and it
// also treats inline "--" as a comment start. Strip "--" to end-of-line on
// every line (none of our migrations contain "--" inside string literals).
// It also mishandles multi-statement blobs, so execScript splits on ";".
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}
const MIGRATIONS = MIGRATION_FILES.map((p) => stripSqlComments(readFileSync(p, "utf8")));

function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
async function execScript(db: D1Database, sql: string): Promise<void> {
  // D1 exec splits on newlines, so collapse all whitespace to single spaces
  // before splitting into individual statements on ";".
  const flat = sql.replace(/\s+/g, " ");
  for (const stmt of splitStatements(flat)) {
    await db.exec(stmt);
  }
}

const SESSION_SECRET = "integration-test-secret-please-rotate";
export const WECOM_URL = "https://hooks.example.invalid/webhook/test";

// tables dropped (child → parent) before re-applying migrations each test
const TABLES = ["rate_limits", "push_logs", "ai_usage", "reviews", "daily_logs", "tasks", "users"];

// ---------------------------------------------------------------------------
// Miniflare lifecycle (one instance for the whole process)
// ---------------------------------------------------------------------------
let mfPromise: Promise<Miniflare> | null = null;
function getMf(): Promise<Miniflare> {
  if (!mfPromise) {
    mfPromise = new Miniflare({
      modules: true,
      compatibilityDate: "2024-01-01",
      // dummy module worker; we only use it to obtain the D1 binding
      script: `export default { async fetch() { return new Response("ok"); } };`,
      d1Databases: ["DB"],
    });
  }
  return mfPromise;
}

export async function getDb(): Promise<D1Database> {
  const mf = await getMf();
  const bindings = await mf.getBindings<{ DB: D1Database }>();
  return bindings.DB;
}

export async function disposeMf(): Promise<void> {
  if (mfPromise) {
    const mf = await mfPromise;
    await mf.dispose();
    mfPromise = null;
  }
}

// ---------------------------------------------------------------------------
// Schema reset (isolation between tests)
// ---------------------------------------------------------------------------
export async function resetSchema(db: D1Database): Promise<void> {
  await execScript(db, TABLES.map((t) => `DROP TABLE IF EXISTS ${t}`).join(";"));
  for (const sql of MIGRATIONS) {
    await execScript(db, sql);
  }
}

// ---------------------------------------------------------------------------
// Env builder — mirrors wrangler.jsonc vars, with safe test defaults
// ---------------------------------------------------------------------------
export function makeEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    SESSION_SECRET,
    WECOM_WEBHOOK_URL: WECOM_URL,
    AI_ENABLED: "false",
    AI_PROVIDER: "workers_ai",
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    BUSINESS_TIMEZONE: "Asia/Shanghai",
    AI_TIMEOUT_MS: "10000",
    AI_MAX_OUTPUT_TOKENS: "400",
    AI_DAILY_MANUAL_LIMIT: "5",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Seed a single user (single-tenant model)
// ---------------------------------------------------------------------------
export interface SeedUser {
  id: string;
  username: string;
  password: string;
}

export async function seedUser(
  db: D1Database,
  username = "alice",
  password = "Str0ng#Passw0rd"
): Promise<SeedUser> {
  const salt = generateSalt();
  const hash = await hashPassword(password, salt);
  const id = await q.createUser(db, {
    username,
    passwordHash: hash,
    passwordSalt: salt,
    passwordParams: passwordParams(),
  });
  return { id, username, password };
}

// ---------------------------------------------------------------------------
// Session cookie helpers
// ---------------------------------------------------------------------------
export async function signCookieFor(userId: string, sessionVersion = 1): Promise<string> {
  const token = await signSession({ sub: userId, sessionVersion }, SESSION_SECRET);
  return `session=${token}`;
}

// ---------------------------------------------------------------------------
// ExecutionContext stub that captures waitUntil promises (for cron jobs)
// ---------------------------------------------------------------------------
export interface CtxBag {
  waitList: Promise<unknown>[];
  ctx: ExecutionContext;
}
export function makeCtx(): CtxBag {
  const waitList: Promise<unknown>[] = [];
  const ctx: ExecutionContext = {
    waitUntil: (p: Promise<unknown>) => {
      waitList.push(p);
      return p as unknown as void;
    },
    passThroughOnException: () => {},
  };
  return { waitList, ctx };
}
export async function flush(waitList: Promise<unknown>[]): Promise<void> {
  await Promise.allSettled(waitList);
}

// ---------------------------------------------------------------------------
// HTTP caller — wraps app.fetch with a convenient API
// ---------------------------------------------------------------------------
interface CallOpts {
  body?: unknown;
  cookie?: string;
  ip?: string;
  headers?: Record<string, string>;
}
export interface CallResult {
  res: Response;
  status: number;
  json: any;
}
export async function call(
  env: Env,
  ctx: ExecutionContext,
  method: string,
  path: string,
  opts: CallOpts = {}
): Promise<CallResult> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers["cookie"] = opts.cookie;
  if (opts.ip) headers["cf-connecting-ip"] = opts.ip;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const req = new Request("https://example.com" + path, { method, headers, body });
  const res = await app.fetch(req, env, ctx);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body (e.g. static) */
  }
  return { res, status: res.status, json };
}

export function cookieFrom(res: Response): string {
  const setCookies = (res.headers.getSetCookie?.() as string[] | undefined) ?? [];
  for (const c of setCookies) {
    if (c.startsWith("session=")) return c.split(";")[0]; // "session=<token>"
  }
  return "";
}

let ipCounter = 0;
function uniqueIp(): string {
  ipCounter += 1;
  return `10.0.0.${ipCounter}`;
}

export async function loginAs(
  env: Env,
  ctx: ExecutionContext,
  user: SeedUser,
  ip: string = uniqueIp()
): Promise<{ cookie: string; userId: string }> {
  const { res } = await call(env, ctx, "POST", "/api/auth/login", {
    body: { username: user.username, password: user.password },
    ip,
  });
  return { cookie: cookieFrom(res), userId: user.id };
}

// ---------------------------------------------------------------------------
// WeCom webhook mock — intercepts the single `fetch` call sendPush makes
// ---------------------------------------------------------------------------
export type WebhookBehavior = "ok" | "biz_error" | "always_500" | "http_500_then_ok";

export interface WebhookMock {
  calls: { url: string; markdown?: string; raw: any }[];
  behavior: WebhookBehavior;
  setBehavior(b: WebhookBehavior): void;
  handler: typeof fetch;
}

export function createWebhookMock(): WebhookMock {
  const mock: WebhookMock = {
    calls: [],
    behavior: "ok",
    setBehavior(b) {
      this.behavior = b;
    },
    handler: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      let raw: any = null;
      let markdown: string | undefined;
      try {
        raw = init?.body ? JSON.parse(init.body as string) : null;
        markdown = raw?.markdown?.content;
      } catch {
        /* ignore */
      }
      mock.calls.push({ url: url ?? "", markdown, raw });

      if (mock.behavior === "biz_error") {
        return new Response(JSON.stringify({ errcode: 93000, errmsg: "invalid webhook key" }), {
          status: 200,
        });
      }
      if (mock.behavior === "always_500") {
        return new Response("upstream 500", { status: 500 });
      }
      if (mock.behavior === "http_500_then_ok") {
        // fail first two attempts, succeed on the third
        if (mock.calls.length < 3) return new Response("upstream 500", { status: 500 });
        return new Response(JSON.stringify({ errcode: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify({ errcode: 0 }), { status: 200 });
    }) as typeof fetch,
  };
  return mock;
}

export function installWebhook(mock: WebhookMock): void {
  vi.stubGlobal("fetch", mock.handler);
}
export function restoreWebhook(): void {
  vi.unstubAllGlobals();
}
