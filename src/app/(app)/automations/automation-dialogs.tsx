"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Pencil, Plus, Trash2, Webhook } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { createApiKeyAction, createWebhookAction, saveRuleAction, toggleRuleAction } from "./actions";

type Action =
  | { type: "TAG_CONTACT"; tagId: string }
  | { type: "CREATE_LEAD" }
  | { type: "SET_CONVERSATION_STATUS"; status: "OPEN" | "HANDLED" | "INTERESTED" | "NOT_INTERESTED" | "NEEDS_AGENT" }
  | { type: "ASSIGN"; userId: string };

export function RuleToggle({ id, isActive, disabled }: { id: string; isActive: boolean; disabled?: boolean }) {
  const { run, pending } = useAction();
  return <Switch checked={isActive} disabled={disabled || pending} onCheckedChange={(v) => run(() => toggleRuleAction({ id, isActive: v }))} aria-label="הפעלת כלל" />;
}

export function RuleDialog({
  tags,
  members,
  rule,
}: {
  tags: { id: string; name: string }[];
  members: { id: string; name: string }[];
  rule?: { id: string; name: string; trigger: string; isActive: boolean; conditions: { keywords: string[]; match: "exact" | "contains" }; actions: Action[] };
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(rule?.name ?? "");
  const [trigger, setTrigger] = useState(rule?.trigger ?? "INBOUND_KEYWORD");
  const [keywords, setKeywords] = useState(rule?.conditions.keywords.join(", ") ?? "");
  const [match, setMatch] = useState<"exact" | "contains">(rule?.conditions.match ?? "contains");
  const [actions, setActions] = useState<Action[]>(rule?.actions ?? [{ type: "SET_CONVERSATION_STATUS", status: "NEEDS_AGENT" }]);
  const { run, pending } = useAction();
  const setAt = (i: number, a: Action) => setActions(actions.map((x, j) => (j === i ? a : x)));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {rule ? (
          <Button size="icon-sm" variant="ghost" aria-label="עריכה">
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus />
            כלל חדש
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? "עריכת כלל" : "כלל אוטומציה חדש"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="r-name">שם</Label>
            <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>כאשר</Label>
              <Select value={trigger} onValueChange={setTrigger}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INBOUND_KEYWORD">הודעה מכילה מילת מפתח</SelectItem>
                  <SelectItem value="BUTTON_REPLY">לחיצה על כפתור תגובה</SelectItem>
                  <SelectItem value="ANY_INBOUND">כל הודעה נכנסת</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {trigger !== "ANY_INBOUND" ? (
              <div className="space-y-1.5">
                <Label>התאמה</Label>
                <Select value={match} onValueChange={(v) => setMatch(v as "exact" | "contains")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contains">מכיל</SelectItem>
                    <SelectItem value="exact">התאמה מלאה</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          {trigger !== "ANY_INBOUND" ? (
            <div className="space-y-1.5">
              <Label htmlFor="r-kw">{trigger === "BUTTON_REPLY" ? "טקסט הכפתור (ריק = כל כפתור)" : "מילות מפתח"}</Label>
              <Input id="r-kw" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="מופרדות בפסיק" />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>אז</Label>
            {actions.map((a, i) => (
              <div key={i} className="flex gap-2">
                <Select
                  value={a.type}
                  onValueChange={(v) =>
                    setAt(i, v === "TAG_CONTACT" ? { type: "TAG_CONTACT", tagId: tags[0]?.id ?? "" } : v === "ASSIGN" ? { type: "ASSIGN", userId: members[0]?.id ?? "" } : v === "CREATE_LEAD" ? { type: "CREATE_LEAD" } : { type: "SET_CONVERSATION_STATUS", status: "NEEDS_AGENT" })
                  }
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SET_CONVERSATION_STATUS">עדכון סטטוס שיחה</SelectItem>
                    <SelectItem value="CREATE_LEAD">יצירת ליד</SelectItem>
                    <SelectItem value="TAG_CONTACT" disabled={!tags.length}>
                      הוספת תגית
                    </SelectItem>
                    <SelectItem value="ASSIGN">שיוך לנציג</SelectItem>
                  </SelectContent>
                </Select>
                {a.type === "SET_CONVERSATION_STATUS" ? (
                  <Select value={a.status} onValueChange={(v) => setAt(i, { ...a, status: v as typeof a.status })}>
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NEEDS_AGENT">ממתין לנציג</SelectItem>
                      <SelectItem value="INTERESTED">מתעניין</SelectItem>
                      <SelectItem value="NOT_INTERESTED">לא מעוניין</SelectItem>
                      <SelectItem value="HANDLED">טופל</SelectItem>
                      <SelectItem value="OPEN">פתוחה</SelectItem>
                    </SelectContent>
                  </Select>
                ) : a.type === "TAG_CONTACT" ? (
                  <Select value={a.tagId} onValueChange={(v) => setAt(i, { ...a, tagId: v })}>
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {tags.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : a.type === "ASSIGN" ? (
                  <Select value={a.userId} onValueChange={(v) => setAt(i, { ...a, userId: v })}>
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex-1" />
                )}
                <Button variant="ghost" size="icon" aria-label="הסרת פעולה" disabled={actions.length === 1} onClick={() => setActions(actions.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setActions([...actions, { type: "CREATE_LEAD" }])}>
              <Plus />
              פעולה
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              run(
                () =>
                  saveRuleAction({
                    id: rule?.id,
                    name,
                    trigger,
                    isActive: rule?.isActive ?? true,
                    conditions: { keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean), match },
                    actions,
                  }),
                { success: "הכלל נשמר", onSuccess: () => setOpen(false) },
              )
            }
          >
            {pending ? <Spinner /> : null}
            שמירה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SecretOnce({ secret, note }: { secret: string; note: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <Alert className="border-warning/40">
        <AlertDescription>{note}</AlertDescription>
      </Alert>
      <div className="flex gap-1">
        <Input readOnly dir="ltr" className="font-mono text-xs" value={secret} onFocus={(e) => e.target.select()} />
        <Button
          size="icon"
          variant="outline"
          aria-label="העתקה"
          onClick={async () => {
            await navigator.clipboard.writeText(secret);
            setCopied(true);
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

export function ApiKeyDialog({ scopes }: { scopes: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("n8n");
  const [selected, setSelected] = useState<string[]>(["contacts:write", "consents:read"]);
  const [expires, setExpires] = useState("365");
  const [secret, setSecret] = useState<string | null>(null);
  const { run, pending } = useAction();
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), !o && setSecret(null))}>
      <DialogTrigger asChild>
        <Button>
          <KeyRound />
          מפתח חדש
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>מפתח API חדש</DialogTitle>
          <DialogDescription>תנו למפתח רק את ההרשאות הנדרשות. המפתח נשמר כגיבוב בלבד ויוצג פעם אחת.</DialogDescription>
        </DialogHeader>
        {secret ? (
          <SecretOnce secret={secret} note="העתיקו את המפתח עכשיו — לא ניתן יהיה להציג אותו שוב." />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="k-name">שם</Label>
              <Input id="k-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>הרשאות</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {scopes.map((s) => (
                  <label key={s.value} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={selected.includes(s.value)} onCheckedChange={(v) => setSelected(v ? [...selected, s.value] : selected.filter((x) => x !== s.value))} />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>תוקף</Label>
              <Select value={expires} onValueChange={setExpires}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="90">90 יום</SelectItem>
                  <SelectItem value="365">שנה</SelectItem>
                  <SelectItem value="0">ללא תפוגה</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          {secret ? (
            <Button onClick={() => (setOpen(false), setSecret(null))}>סיום</Button>
          ) : (
            <Button disabled={pending || !selected.length || !name.trim()} onClick={() => run(() => createApiKeyAction({ name, scopes: selected, expiresInDays: Number(expires) || null }), { onSuccess: setSecret })}>
              {pending ? <Spinner /> : null}
              יצירה
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WebhookDialog({ events }: { events: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("n8n");
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<string[]>(["contact.unsubscribed", "lead.created"]);
  const [secret, setSecret] = useState<string | null>(null);
  const { run, pending } = useAction();
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), !o && setSecret(null))}>
      <DialogTrigger asChild>
        <Button>
          <Webhook />
          Webhook חדש
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Webhook יוצא חדש</DialogTitle>
          <DialogDescription>למשל כתובת Webhook Trigger של n8n (HTTPS).</DialogDescription>
        </DialogHeader>
        {secret ? (
          <SecretOnce secret={secret} note="סוד החתימה — שמרו אותו ב-n8n לאימות הכותרת X-WCM-Signature. יוצג פעם אחת." />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <div className="space-y-1.5">
                <Label htmlFor="wh-name">שם</Label>
                <Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wh-url">כתובת</Label>
                <Input id="wh-url" dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://n8n.example.com/webhook/…" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>אירועים</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {events.map((e) => (
                  <label key={e.value} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={selected.includes(e.value)} onCheckedChange={(v) => setSelected(v ? [...selected, e.value] : selected.filter((x) => x !== e.value))} />
                    {e.label}
                    <span className="ltr text-xs text-muted-foreground">{e.value}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          {secret ? (
            <Button onClick={() => (setOpen(false), setSecret(null))}>סיום</Button>
          ) : (
            <Button disabled={pending || !url || !selected.length} onClick={() => run(() => createWebhookAction({ name, url, events: selected }), { onSuccess: setSecret })}>
              {pending ? <Spinner /> : null}
              יצירה
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
