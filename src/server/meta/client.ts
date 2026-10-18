import { classifyMetaError, classifyNetworkError, networkErrorCode, type ErrorClass } from "./errors";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number | null,
    public readonly code: number | null,
    public readonly subcode: number | null,
    public readonly classification: ErrorClass,
    public readonly details?: string,
    public readonly fbtraceId?: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

export type MetaClientOptions = {
  accessToken: string;
  version?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  baseUrl?: string;
};

export type GraphTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components: unknown[];
  rejected_reason?: string;
  quality_score?: { score?: string };
  parameter_format?: string;
};

/** Thin, typed wrapper around the official WhatsApp Business Cloud API (Graph API). */
export class MetaClient {
  private readonly token: string;
  private readonly version: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(opts: MetaClientOptions) {
    this.token = opts.accessToken;
    this.version = opts.version ?? process.env.META_GRAPH_API_VERSION ?? "v25.0";
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.baseUrl = opts.baseUrl ?? "https://graph.facebook.com";
  }

  private url(path: string, params?: Record<string, string | number | undefined>) {
    const u = new URL(`${this.baseUrl}/${this.version}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }

  async request<T>(method: "GET" | "POST" | "DELETE", path: string, opts: { params?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(path, opts.params), {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const cls = classifyNetworkError(err);
      throw new MetaApiError(`Network error calling Meta (${networkErrorCode(err) ?? "unknown"})`, null, null, null, cls);
    }
    let json: unknown = null;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const e = (json as { error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string }; fbtrace_id?: string } })?.error;
      const code = typeof e?.code === "number" ? e.code : null;
      throw new MetaApiError(
        e?.message ?? `Meta API HTTP ${res.status}`,
        res.status,
        code,
        e?.error_subcode ?? null,
        classifyMetaError(res.status, code),
        e?.error_data?.details,
        e?.fbtrace_id,
      );
    }
    return json as T;
  }

  /** Sends a message. `body` is the full Cloud API payload minus messaging_product. */
  async sendMessage(phoneNumberId: string, body: Record<string, unknown>): Promise<{ wamid: string; raw: unknown }> {
    const res = await this.request<{ messages?: { id: string; message_status?: string }[] }>("POST", `${phoneNumberId}/messages`, {
      body: { messaging_product: "whatsapp", recipient_type: "individual", ...body },
    });
    const wamid = res.messages?.[0]?.id;
    if (!wamid) {
      // Accepted with 2xx but no id → we cannot prove/deny delivery: treat as uncertain.
      throw new MetaApiError("Meta response missing message id", 200, null, null, "UNCERTAIN");
    }
    return { wamid, raw: res };
  }

  async getWaba(wabaId: string) {
    return this.request<{ id: string; name?: string; currency?: string; timezone_id?: string; message_template_namespace?: string }>("GET", wabaId, {
      params: { fields: "id,name,currency,timezone_id,message_template_namespace" },
    });
  }

  async listPhoneNumbers(wabaId: string) {
    const res = await this.request<{ data: GraphPhoneNumber[] }>("GET", `${wabaId}/phone_numbers`, {
      params: { fields: "id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type,throughput", limit: 100 },
    });
    return res.data;
  }

  async getPhoneNumber(phoneNumberId: string): Promise<GraphPhoneNumber> {
    const base = await this.request<GraphPhoneNumber>("GET", phoneNumberId, {
      params: { fields: "id,display_phone_number,verified_name,quality_rating,name_status,platform_type,throughput" },
    });
    // Portfolio-level messaging limit (replaces deprecated messaging_limit_tier). Optional: don't fail health check on it.
    try {
      const lim = await this.request<{ whatsapp_business_manager_messaging_limit?: string }>("GET", phoneNumberId, {
        params: { fields: "whatsapp_business_manager_messaging_limit" },
      });
      base.whatsapp_business_manager_messaging_limit = lim.whatsapp_business_manager_messaging_limit;
    } catch {
      /* field unavailable for this token/version */
    }
    return base;
  }

  async subscribeAppToWaba(wabaId: string) {
    return this.request<{ success: boolean }>("POST", `${wabaId}/subscribed_apps`);
  }

  async listSubscribedApps(wabaId: string) {
    return this.request<{ data: { whatsapp_business_api_data?: { id: string; name?: string } }[] }>("GET", `${wabaId}/subscribed_apps`);
  }

  async listTemplates(wabaId: string): Promise<GraphTemplate[]> {
    const out: GraphTemplate[] = [];
    let after: string | undefined;
    for (let page = 0; page < 50; page++) {
      const res = await this.request<{ data: GraphTemplate[]; paging?: { cursors?: { after?: string }; next?: string } }>("GET", `${wabaId}/message_templates`, {
        params: { fields: "id,name,language,status,category,components,rejected_reason,quality_score,parameter_format", limit: 100, after },
      });
      out.push(...res.data);
      if (!res.paging?.next || !res.paging.cursors?.after) break;
      after = res.paging.cursors.after;
    }
    return out;
  }

  async createTemplate(wabaId: string, body: { name: string; language: string; category: string; components: unknown[]; parameter_format?: string }) {
    return this.request<{ id: string; status: string; category: string }>("POST", `${wabaId}/message_templates`, { body });
  }

  async deleteTemplate(wabaId: string, name: string, hsmId?: string) {
    return this.request<{ success: boolean }>("DELETE", `${wabaId}/message_templates`, { params: { name, hsm_id: hsmId } });
  }

  /** Uploads a media file for sending (valid ~30 days); returns the media ID. */
  async uploadMessageMedia(phoneNumberId: string, file: { bytes: ArrayBuffer; mimeType: string; fileName: string }): Promise<string> {
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", file.mimeType);
    form.set("file", new Blob([file.bytes], { type: file.mimeType }), file.fileName);
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(`${phoneNumberId}/media`), { method: "POST", headers: { authorization: `Bearer ${this.token}` }, body: form, signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      throw new MetaApiError("Upload failed", null, null, null, classifyNetworkError(err));
    }
    const json = (await res.json().catch(() => null)) as { id?: string; error?: { message?: string; code?: number } } | null;
    if (!res.ok || !json?.id) throw new MetaApiError(json?.error?.message ?? "Upload failed", res.status, json?.error?.code ?? null, null, classifyMetaError(res.status, json?.error?.code ?? null));
    return json.id;
  }

  /**
   * Resumable Upload API — returns a file handle usable as a template header example.
   * Requires the Meta App ID that owns the access token.
   */
  async uploadTemplateMedia(appId: string, file: { bytes: ArrayBuffer; mimeType: string; fileName: string }): Promise<string> {
    const session = await this.request<{ id: string }>("POST", `${appId}/uploads`, {
      params: { file_name: file.fileName, file_length: file.bytes.byteLength, file_type: file.mimeType },
    });
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(session.id), {
        method: "POST",
        headers: { authorization: `OAuth ${this.token}`, file_offset: "0", "content-type": "application/octet-stream" },
        body: file.bytes,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new MetaApiError("Upload failed", null, null, null, classifyNetworkError(err));
    }
    const json = (await res.json().catch(() => null)) as { h?: string; error?: { message?: string; code?: number } } | null;
    if (!res.ok || !json?.h) {
      throw new MetaApiError(json?.error?.message ?? "Upload failed", res.status, json?.error?.code ?? null, null, classifyMetaError(res.status, json?.error?.code ?? null));
    }
    return json.h;
  }
}

export type GraphPhoneNumber = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  name_status?: string;
  platform_type?: string;
  throughput?: { level?: string };
  whatsapp_business_manager_messaging_limit?: string;
};

/** "TIER_250" | "TIER_2K" | "TIER_10K" | "TIER_100K" | "TIER_UNLIMITED" → number (Infinity for unlimited) */
export function parseMessagingLimit(tier: string | null | undefined): number | null {
  if (!tier) return null;
  const t = tier.toUpperCase();
  if (t.includes("UNLIMITED")) return Number.POSITIVE_INFINITY;
  const m = t.match(/(\d+)\s*(K)?/);
  if (!m) return null;
  return Number(m[1]) * (m[2] ? 1000 : 1);
}
