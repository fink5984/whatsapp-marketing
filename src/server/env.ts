import { z } from "zod";

/** A random secret: 32 bytes base64, or any random string of 32+ characters (hashed to 32 bytes). */
const secretKey = z.string().min(32, "must be at least 32 random characters");

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  TRACKING_BASE_URL: z.string().url().optional(),
  ENCRYPTION_KEY: secretKey,
  HASH_PEPPER: secretKey,
  // Dev/test only: point the Graph client at a local fake (scripts/fake-meta.mjs). Ignored in production.
  META_GRAPH_BASE_URL: z.string().url().optional(),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v25.0"),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  WORKER_ID: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validated environment. Lazy so that `next build` works without secrets. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function trackingBaseUrl(): string {
  const e = env();
  return (e.TRACKING_BASE_URL || e.APP_URL).replace(/\/+$/, "");
}

export function appUrl(): string {
  return env().APP_URL.replace(/\/+$/, "");
}

/** Test hook. */
export function resetEnvCache() {
  cached = null;
}
