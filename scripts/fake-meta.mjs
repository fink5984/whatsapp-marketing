/**
 * Local fake of the WhatsApp Cloud API (Graph API) for development and E2E
 * tests — never used in production (the app ignores META_GRAPH_BASE_URL when
 * NODE_ENV=production).
 *
 * Behaves like Meta for the endpoints the app uses and, after each send,
 * POSTs *signed* status webhooks back to the app (sent → delivered → read).
 * Recipient number suffix controls the scenario:
 *   …0003  replies "הסר" (unsubscribe) after delivery
 *   …0004  taps the "מעוניין" quick-reply button
 *   …0005  delivery fails (131026)
 *   …0006  delivered but never read (read receipts off)
 *
 *   node scripts/fake-meta.mjs --port 4010 --webhook http://localhost:3000/api/webhooks/whatsapp/<key> --secret <appSecret>
 */
import http from "node:http";
import crypto from "node:crypto";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith("--") ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const PORT = Number(args.port ?? 4010);
let WEBHOOK = args.webhook ?? process.env.FAKE_META_WEBHOOK;
let SECRET = args.secret ?? process.env.FAKE_META_SECRET;
const WABA = args.waba ?? "123456789012345";
const PHONE_ID = args["phone-id"] ?? "109876543210987";
const DISPLAY = "+972 3-555-0100";
let seq = 0;
const sent = [];
const templates = [
  {
    id: "900000000000001",
    name: "loan_offer_he",
    language: "he",
    status: "APPROVED",
    category: "MARKETING",
    parameter_format: "POSITIONAL",
    components: [
      { type: "BODY", text: "פרסומת: שלום {{1}}, הצעה חדשה מלינדר פיננסים מחכה לך. לבדיקת זכאות ללא התחייבות לחצו על הכפתור.", example: { body_text: [["דנה"]] } },
      { type: "FOOTER", text: "להסרה מרשימת התפוצה, השיבו הסר" },
      {
        type: "BUTTONS",
        buttons: [
          { type: "URL", text: "בדיקת זכאות", url: "https://t.test/r/{{1}}", example: ["https://t.test/r/abc"] },
          { type: "QUICK_REPLY", text: "מעוניין" },
          { type: "QUICK_REPLY", text: "הסרה מרשימת התפוצה" },
        ],
      },
    ],
  },
];

function signAndPost(payload) {
  if (!WEBHOOK || !SECRET) return;
  const body = JSON.stringify(payload);
  const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  fetch(WEBHOOK, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body })
    .then((r) => console.log(`[fake-meta] webhook → ${r.status}`))
    .catch((e) => console.log(`[fake-meta] webhook failed: ${e.message}`));
}

const envelope = (value) => ({
  object: "whatsapp_business_account",
  entry: [{ id: WABA, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: DISPLAY.replace(/\D/g, ""), phone_number_id: PHONE_ID }, ...value } }] }],
});
const ts = () => String(Math.floor(Date.now() / 1000));

function status(wamid, to, st, opaque, extra = {}) {
  signAndPost(envelope({ statuses: [{ id: wamid, status: st, timestamp: ts(), recipient_id: to, biz_opaque_callback_data: opaque, ...extra }] }));
}

function inbound(from, message, name = "לקוח בדיקה") {
  signAndPost(envelope({ contacts: [{ profile: { name }, wa_id: from }], messages: [{ from, id: `wamid.in.${++seq}`, timestamp: ts(), ...message }] }));
}

function simulate(to, wamid, opaque, contextWamid, isTemplate) {
  const pricing = { billable: true, pricing_model: "PMP", category: "marketing", type: "regular" };
  setTimeout(() => status(wamid, to, "sent", opaque, { pricing }), 800);
  if (to.endsWith("0005")) {
    setTimeout(() => status(wamid, to, "failed", opaque, { errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "Recipient not on WhatsApp" } }] }), 1600);
    return;
  }
  setTimeout(() => status(wamid, to, "delivered", opaque, { pricing }), 1600);
  if (!to.endsWith("0006")) setTimeout(() => status(wamid, to, "read", opaque), 2600);
  if (!isTemplate) return; // customers only react to campaign messages
  if (to.endsWith("0003")) setTimeout(() => inbound(to, { type: "text", text: { body: "הסר" }, context: { from: DISPLAY, id: contextWamid } }), 3500);
  if (to.endsWith("0004")) setTimeout(() => inbound(to, { type: "button", button: { payload: "מעוניין", text: "מעוניין" }, context: { from: DISPLAY, id: contextWamid } }), 3500);
}

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean); // [version, id, edge?]
  let body = "";
  for await (const c of req) body += c;
  const data = body && req.headers["content-type"]?.includes("json") ? JSON.parse(body) : null;
  if (!req.headers.authorization?.startsWith("Bearer ") && !req.headers.authorization?.startsWith("OAuth ")) return json(res, 401, { error: { message: "Invalid OAuth access token", code: 190 } });

  // Test hook: reconfigure webhook target/secret at runtime
  if (parts[0] === "__config" && req.method === "POST") {
    WEBHOOK = data.webhook ?? WEBHOOK;
    SECRET = data.secret ?? SECRET;
    return json(res, 200, { ok: true });
  }
  if (parts[0] === "__sent") return json(res, 200, sent);

  const [, id, edge] = parts;
  if (id === WABA && !edge) return json(res, 200, { id: WABA, name: "Linder Test WABA", currency: "USD", timezone_id: "1", message_template_namespace: "ns_test" });
  if (id === WABA && edge === "phone_numbers")
    return json(res, 200, { data: [{ id: PHONE_ID, display_phone_number: DISPLAY, verified_name: "לינדר פיננסים (בדיקה)", quality_rating: "GREEN", name_status: "APPROVED", platform_type: "CLOUD_API", throughput: { level: "STANDARD" } }] });
  if (id === PHONE_ID && !edge) {
    const fields = url.searchParams.get("fields") ?? "";
    if (fields.includes("whatsapp_business_manager_messaging_limit")) return json(res, 200, { id: PHONE_ID, whatsapp_business_manager_messaging_limit: "TIER_2K" });
    return json(res, 200, { id: PHONE_ID, display_phone_number: DISPLAY, verified_name: "לינדר פיננסים (בדיקה)", quality_rating: "GREEN", platform_type: "CLOUD_API" });
  }
  if (id === WABA && edge === "subscribed_apps") return json(res, 200, req.method === "POST" ? { success: true } : { data: [{ whatsapp_business_api_data: { id: "1", name: "Campaign Manager (fake)" } }] });
  if (id === WABA && edge === "message_templates") {
    if (req.method === "GET") return json(res, 200, { data: templates, paging: {} });
    if (req.method === "POST") {
      const t = { id: String(900000000000000 + templates.length + 1), status: "PENDING", ...data };
      templates.push(t);
      return json(res, 200, { id: t.id, status: "PENDING", category: data.category });
    }
    if (req.method === "DELETE") return json(res, 200, { success: true });
  }
  if (id === PHONE_ID && edge === "messages" && req.method === "POST") {
    const wamid = `wamid.fake.${++seq}.${crypto.randomBytes(4).toString("hex")}`;
    sent.push({ wamid, to: data.to, type: data.type, template: data.template?.name, at: new Date().toISOString() });
    console.log(`[fake-meta] send ${data.type} → ${data.to} (${wamid})`);
    simulate(data.to, wamid, data.biz_opaque_callback_data, wamid, data.type === "template");
    return json(res, 200, { messaging_product: "whatsapp", contacts: [{ input: data.to, wa_id: data.to }], messages: [{ id: wamid, message_status: "accepted" }] });
  }
  json(res, 404, { error: { message: `Unknown path ${url.pathname}`, code: 100 } });
});

server.listen(PORT, () => console.log(`[fake-meta] listening on http://localhost:${PORT} (WABA ${WABA}, phone ${PHONE_ID})`));
