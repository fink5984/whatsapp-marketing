/** Minimal structured JSON logger (Railway ingests stdout). Never log secrets or message bodies. */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL as Level) || "info";
  return ORDER[lvl] ?? 20;
}

function serialize(meta?: Record<string, unknown>) {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v instanceof Error) out[k] = { name: v.name, message: v.message, stack: v.stack?.split("\n").slice(0, 6).join("\n") };
    else out[k] = v;
  }
  return out;
}

function log(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...serialize(meta) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
};
