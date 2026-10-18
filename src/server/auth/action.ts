import "server-only";
import type { z } from "zod";
import { getAppContext, type AppContext } from "./current";
import { ForbiddenError, NotFoundError, UserError, type Permission } from "../rbac";
import { logger } from "../logger";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Wraps every Server Action: authenticates, authorizes, validates input with
 * Zod, and converts known errors into user-safe messages.
 */
export function defineAction<S extends z.ZodType, T>(
  permission: Permission,
  schema: S,
  handler: (ctx: AppContext, input: z.infer<S>) => Promise<T>,
) {
  return async (input: z.input<S>): Promise<ActionResult<T>> => {
    const ctx = await getAppContext();
    if (!ctx) return { ok: false, error: "פג תוקף ההתחברות. יש להתחבר מחדש." };
    if (!ctx.can(permission)) return { ok: false, error: "אין לך הרשאה לבצע פעולה זו" };
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { ok: false, error: "יש לתקן את השדות המסומנים", fieldErrors };
    }
    try {
      // Handlers return plain data and signal failures by throwing UserError.
      return { ok: true, data: await handler(ctx, parsed.data) };
    } catch (err) {
      return toActionError(err);
    }
  };
}

export function toActionError(err: unknown): { ok: false; error: string } {
  if (err instanceof UserError || err instanceof ForbiddenError || err instanceof NotFoundError) {
    return { ok: false, error: err.message };
  }
  // Re-throw Next.js control-flow errors (redirect/notFound)
  if (err && typeof err === "object" && "digest" in err && typeof (err as { digest: unknown }).digest === "string") {
    const digest = (err as { digest: string }).digest;
    if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR")) throw err;
  }
  logger.error("action failed", { err });
  return { ok: false, error: "אירעה שגיאה בלתי צפויה. הפעולה לא בוצעה." };
}
