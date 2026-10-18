import { createSign } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { assertCan, systemContext, type OrgContext } from "../context";
import { NotFoundError, UserError } from "../rbac";
import { env } from "../env";
import { importContactRows, type ColumnMapping, type RawRow } from "./imports";
import { logger } from "../logger";

const serviceAccountSchema = z.object({ client_email: z.string().email(), private_key: z.string().min(100), token_uri: z.string().url().optional() });

let tokenCache: { token: string; exp: number } | null = null;

export function sheetsConfigured(): boolean {
  return !!env().GOOGLE_SERVICE_ACCOUNT_JSON;
}

export function serviceAccountEmail(): string | null {
  try {
    return serviceAccountSchema.parse(JSON.parse(env().GOOGLE_SERVICE_ACCOUNT_JSON || "{}")).client_email;
  } catch {
    return null;
  }
}

/** OAuth2 JWT-bearer flow for a Google service account (read-only Sheets scope). */
async function accessToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const raw = env().GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new UserError("Google Sheets לא הוגדר (חסר GOOGLE_SERVICE_ACCOUNT_JSON)");
  const sa = serviceAccountSchema.parse(JSON.parse(raw));
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key.replace(/\\n/g, "\n")).toString("base64url");
  const res = await fetchImpl(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) throw new UserError(`התחברות ל-Google נכשלה: ${json.error_description ?? res.status}`);
  tokenCache = { token: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

export async function fetchSheetRows(spreadsheetId: string, range: string): Promise<{ headers: string[]; rows: RawRow[] }> {
  const token = await accessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  const json = (await res.json()) as { values?: string[][]; error?: { message?: string } };
  if (!res.ok) throw new UserError(`קריאת הגיליון נכשלה: ${json.error?.message ?? res.status}. ודאו שהגיליון שותף עם ${serviceAccountEmail() ?? "חשבון השירות"}`);
  const values = json.values ?? [];
  const headers = (values[0] ?? []).map((h, i) => String(h).trim() || `עמודה ${i + 1}`);
  const rows = values.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? "").trim()])));
  return { headers, rows: rows.filter((r) => Object.values(r).some(Boolean)) };
}

export function parseSpreadsheetId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = m ? m[1] : input.trim();
  if (!/^[a-zA-Z0-9-_]{20,}$/.test(id)) throw new UserError("מזהה גיליון לא תקין");
  return id;
}

export async function saveSheetSource(
  ctx: OrgContext,
  input: { name: string; spreadsheet: string; range: string; columnMap: ColumnMapping; defaultTags: string[]; audienceId?: string | null; syncIntervalMin?: number | null },
  id?: string,
) {
  assertCan(ctx, "contacts:write");
  const data = {
    name: input.name.trim(),
    spreadsheetId: parseSpreadsheetId(input.spreadsheet),
    range: input.range.trim() || "Sheet1",
    columnMap: input.columnMap as unknown as Prisma.InputJsonValue,
    defaultTags: input.defaultTags,
    audienceId: input.audienceId || null,
    syncIntervalMin: input.syncIntervalMin && input.syncIntervalMin >= 15 ? input.syncIntervalMin : null,
  };
  if (id) {
    const res = await db.googleSheetSource.updateMany({ where: { id, organizationId: ctx.orgId }, data });
    if (!res.count) throw new NotFoundError();
    return id;
  }
  return (await db.googleSheetSource.create({ data: { ...data, organizationId: ctx.orgId } })).id;
}

/**
 * Pulls the sheet and imports through the standard import path. Sheet sync
 * never records consent and never touches suppression/consent of existing
 * contacts — those are protected by importContactRows.
 */
export async function syncSheetSource(ctx: OrgContext, id: string) {
  assertCan(ctx, "contacts:write");
  const src = await db.googleSheetSource.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!src) throw new NotFoundError("מקור הגיליון לא נמצא");
  try {
    const { rows } = await fetchSheetRows(src.spreadsheetId, src.range);
    const result = await importContactRows(
      ctx,
      rows,
      src.columnMap as unknown as ColumnMapping,
      { source: `Google Sheets: ${src.name}`, tagNames: src.defaultTags, audienceId: src.audienceId, consent: null },
      { kind: "google_sheets", fileName: src.name },
    );
    await db.googleSheetSource.update({
      where: { id },
      data: { lastSyncAt: new Date(), lastSyncStatus: "OK", lastSyncMessage: `נוספו ${result.stats.created}, עודכנו ${result.stats.updated}, שגויים ${result.stats.invalid}` },
    });
    return result;
  } catch (err) {
    await db.googleSheetSource.update({
      where: { id },
      data: { lastSyncAt: new Date(), lastSyncStatus: "ERROR", lastSyncMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500) },
    });
    throw err;
  }
}

export async function syncDueSheetSources() {
  if (!sheetsConfigured()) return 0;
  const sources = await db.googleSheetSource.findMany({ where: { syncIntervalMin: { not: null } } });
  let n = 0;
  for (const s of sources) {
    if (s.lastSyncAt && Date.now() - s.lastSyncAt.getTime() < (s.syncIntervalMin ?? 0) * 60_000) continue;
    try {
      await syncSheetSource(systemContext(s.organizationId, "sheets-sync"), s.id);
      n++;
    } catch (err) {
      logger.warn("scheduled sheet sync failed", { sourceId: s.id, err });
    }
  }
  return n;
}
