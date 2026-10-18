import { z } from "zod";
import { e164ToWaId } from "@/lib/phone";
import { analyzeTemplate, getComponent, mediaHeaderFormat, templateSlots, type TemplateComponent } from "@/lib/templates";
import { UNSUBSCRIBE_BUTTON_PAYLOAD } from "@/lib/unsubscribe";

export const variableSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("contact_field"), field: z.enum(["name", "first_name", "phone"]), fallback: z.string().max(200).optional() }),
  z.object({ type: z.literal("attribute"), key: z.string().min(1).max(100), fallback: z.string().max(200).optional() }),
  z.object({ type: z.literal("static"), value: z.string().min(1).max(1000) }),
  z.object({ type: z.literal("tracked_link") }),
]);
export type VariableSource = z.infer<typeof variableSourceSchema>;
export const variableMappingSchema = z.record(z.string(), variableSourceSchema);
export type VariableMapping = z.infer<typeof variableMappingSchema>;

export type RecipientData = {
  phoneE164: string;
  name: string | null;
  attributes: Record<string, unknown>;
  clickToken: string | null;
};

export type TemplateRef = {
  name: string;
  language: string;
  components: TemplateComponent[];
};

export class MissingVariableError extends Error {
  constructor(public readonly slot: string) {
    super(`Missing value for ${slot}`);
  }
}

function resolve(source: VariableSource | undefined, r: RecipientData, slotKind: "header" | "body" | "button", trackingBase: string): string {
  if (!source) return "";
  switch (source.type) {
    case "static":
      return source.value;
    case "contact_field": {
      const v =
        source.field === "phone" ? r.phoneE164 : source.field === "first_name" ? (r.name ?? "").trim().split(/\s+/)[0] ?? "" : (r.name ?? "").trim();
      return v || source.fallback || "";
    }
    case "attribute": {
      const v = r.attributes?.[source.key];
      return (v === undefined || v === null ? "" : String(v)).trim() || source.fallback || "";
    }
    case "tracked_link":
      if (!r.clickToken) return "";
      // URL buttons carry only the dynamic suffix; the template holds the base URL.
      return slotKind === "button" ? r.clickToken : `${trackingBase}/r/${r.clickToken}`;
  }
}

/**
 * Builds the Cloud API `template` message payload for one recipient.
 * Throws MissingVariableError when a required parameter would be empty
 * (Meta rejects empty parameters).
 */
export function buildTemplatePayload(
  template: TemplateRef,
  mapping: VariableMapping,
  recipient: RecipientData,
  opts: { trackingBase: string; headerMediaUrl?: string | null; bizOpaqueId?: string },
) {
  const components: Record<string, unknown>[] = [];
  const slots = templateSlots(template.components);
  const valueOf = (key: string, kind: "header" | "body" | "button") => {
    const v = resolve(mapping[key], recipient, kind, opts.trackingBase).replace(/[\n\t]+/g, " ").replace(/ {5,}/g, "    ");
    if (!v) throw new MissingVariableError(key);
    return v;
  };

  const media = mediaHeaderFormat(template.components);
  const headerSlots = slots.filter((s) => s.component === "header");
  if (media) {
    if (!opts.headerMediaUrl) throw new MissingVariableError("header.media");
    const key = media.toLowerCase();
    // "media:<id>" = file uploaded to Meta; otherwise a public https link.
    const ref = opts.headerMediaUrl.startsWith("media:") ? { id: opts.headerMediaUrl.slice(6) } : { link: opts.headerMediaUrl };
    components.push({ type: "header", parameters: [{ type: key, [key]: ref }] });
  } else if (headerSlots.length) {
    components.push({
      type: "header",
      parameters: headerSlots.map((s) => ({ type: "text", text: valueOf(s.key, "header"), ...(/^\d+$/.test(s.name) ? {} : { parameter_name: s.name }) })),
    });
  }

  const bodySlots = slots.filter((s) => s.component === "body");
  if (bodySlots.length) {
    const ordered = [...bodySlots].sort((a, b) => (/^\d+$/.test(a.name) && /^\d+$/.test(b.name) ? Number(a.name) - Number(b.name) : 0));
    components.push({
      type: "body",
      parameters: ordered.map((s) => ({ type: "text", text: valueOf(s.key, "body"), ...(/^\d+$/.test(s.name) ? {} : { parameter_name: s.name }) })),
    });
  }

  for (const s of slots.filter((s) => s.component === "button")) {
    components.push({ type: "button", sub_type: "url", index: String(s.buttonIndex), parameters: [{ type: "text", text: valueOf(s.key, "button") }] });
  }

  // Tag the unsubscribe quick-reply so the webhook can recognize it reliably.
  const analysis = analyzeTemplate(template.components);
  if (analysis.unsubscribeButtonIndex !== null) {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(analysis.unsubscribeButtonIndex),
      parameters: [{ type: "payload", payload: UNSUBSCRIBE_BUTTON_PAYLOAD }],
    });
  }

  return {
    to: e164ToWaId(recipient.phoneE164),
    type: "template",
    template: { name: template.name, language: { code: template.language }, ...(components.length ? { components } : {}) },
  };
}

export function buildTextPayload(toE164: string, text: string) {
  return { to: e164ToWaId(toE164), type: "text", text: { preview_url: false, body: text.slice(0, 4096) } };
}

/** True when the template's URL buttons/body require a tracked link mapping. */
export function mappingUsesTrackedLink(mapping: VariableMapping): boolean {
  return Object.values(mapping).some((m) => m.type === "tracked_link");
}

export function bodyText(components: TemplateComponent[]) {
  return getComponent(components, "BODY")?.text ?? "";
}
