import { ExternalLink, FileText, Image as ImageIcon, Phone, Reply, Video } from "lucide-react";
import { getComponent, renderText, type TemplateComponent } from "@/lib/templates";
import { cn } from "@/lib/utils";

/** Renders WhatsApp *bold* _italic_ ~strike~ formatting safely (no HTML injection). */
function formatWa(text: string) {
  const parts: React.ReactNode[] = [];
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    const inner = t.slice(1, -1);
    parts.push(t[0] === "*" ? <strong key={i++}>{inner}</strong> : t[0] === "_" ? <em key={i++}>{inner}</em> : <s key={i++}>{inner}</s>);
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Visual approximation of how the template renders in WhatsApp. */
export function WhatsAppPreview({ components, values = {}, className, businessName }: { components: TemplateComponent[]; values?: Record<string, string>; className?: string; businessName?: string }) {
  const header = getComponent(components, "HEADER");
  const body = getComponent(components, "BODY");
  const footer = getComponent(components, "FOOTER");
  const buttons = getComponent(components, "BUTTONS")?.buttons ?? [];
  const MediaIcon = header?.format === "IMAGE" ? ImageIcon : header?.format === "VIDEO" ? Video : FileText;
  return (
    <div className={cn("overflow-hidden rounded-2xl border bg-wa-bg shadow-sm", className)} dir="rtl">
      <div className="flex items-center gap-2 bg-[color-mix(in_oklch,var(--primary),black_25%)] px-3 py-2 text-sm text-white">
        <div className="size-7 rounded-full bg-white/25" />
        <span className="font-medium">{businessName ?? "העסק שלך"}</span>
      </div>
      <div className="min-h-48 p-3 [background-image:radial-gradient(circle_at_1px_1px,color-mix(in_oklch,var(--foreground),transparent_93%)_1px,transparent_0)] [background-size:16px_16px]">
        <div className="max-w-[92%] rounded-xl rounded-ss-sm bg-wa-bubble text-sm shadow-sm">
          {header ? (
            header.format === "TEXT" ? (
              <div className="px-3 pt-2 font-semibold">{renderText(header.text, values)}</div>
            ) : (
              <div className="m-1 flex h-32 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <MediaIcon className="size-8" />
              </div>
            )
          ) : null}
          <div className="whitespace-pre-wrap break-words px-3 py-2 leading-relaxed">{body?.text ? formatWa(renderText(body.text, values)) : <span className="text-muted-foreground">גוף ההודעה…</span>}</div>
          {footer?.text ? <div className="px-3 pb-1 text-xs text-muted-foreground">{footer.text}</div> : null}
          <div className="px-3 pb-1.5 text-start text-[10px] text-muted-foreground" dir="ltr">
            12:00
          </div>
          {buttons.length ? (
            <div className="divide-y border-t">
              {buttons.map((b, i) => (
                <div key={i} className="flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-info">
                  {b.type === "URL" ? <ExternalLink className="size-3.5" /> : b.type === "PHONE_NUMBER" ? <Phone className="size-3.5" /> : <Reply className="size-3.5" />}
                  {b.text || "כפתור"}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
