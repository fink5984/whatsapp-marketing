export type SP = Record<string, string | string[] | undefined>;

export function spOne(sp: SP, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export function spPage(sp: SP): number {
  const n = Number(spOne(sp, "page"));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Returns `path?query` with `changes` applied (null removes a key). Resets page unless page is changed. */
export function withParams(path: string, sp: SP, changes: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val !== undefined && val !== "") params.set(k, val);
  }
  if (!("page" in changes)) params.delete("page");
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined || v === "") params.delete(k);
    else params.set(k, String(v));
  }
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}
