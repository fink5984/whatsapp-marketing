import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticateApiKey, type ApiKeyContext } from "../services/api-keys";
import { rateLimit } from "../rate-limit";
import { ForbiddenError, NotFoundError, UserError, type ApiScope } from "../rbac";
import { logger } from "../logger";

type Params = Record<string, string>;

export function apiError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

/**
 * Wraps a REST route: Bearer API key auth, scope check, per-key rate limit,
 * and error mapping. The org always comes from the key — never from the request.
 */
export function apiRoute<P extends Params = Params>(scope: ApiScope, handler: (ctx: ApiKeyContext, req: NextRequest, params: P) => Promise<unknown>) {
  return async (req: NextRequest, { params }: { params: Promise<P> }) => {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const ctx = await authenticateApiKey(req.headers.get("authorization"), ip);
    if (!ctx) return apiError(401, "unauthorized", "Missing or invalid API key");
    if (!ctx.scopes.includes(scope)) return apiError(403, "forbidden", `API key lacks scope "${scope}"`);
    const rl = await rateLimit(`api:${ctx.actor.type === "api_key" ? ctx.actor.apiKeyId : "x"}`, 600, 60);
    if (!rl.allowed) return NextResponse.json({ error: { code: "rate_limited", message: "Too many requests" } }, { status: 429, headers: { "retry-after": String(Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)) } });
    try {
      const result = await handler(ctx, req, await params);
      return result instanceof NextResponse ? result : NextResponse.json({ data: result });
    } catch (err) {
      if (err instanceof z.ZodError) return apiError(422, "validation_error", "Invalid request", err.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
      if (err instanceof NotFoundError) return apiError(404, "not_found", err.message);
      if (err instanceof ForbiddenError) return apiError(403, "forbidden", err.message);
      if (err instanceof UserError) return apiError(400, "bad_request", err.message);
      if (err instanceof SyntaxError) return apiError(400, "bad_json", "Body must be valid JSON");
      logger.error("api error", { err, path: req.nextUrl.pathname });
      return apiError(500, "internal_error", "Unexpected error");
    }
  };
}

export async function jsonBody<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  const text = await req.text();
  if (text.length > 5_000_000) throw new UserError("Body too large");
  return schema.parse(text ? JSON.parse(text) : {});
}
