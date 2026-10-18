"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Tag, UsersRound } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pill, StatusBadge } from "@/components/app/badges";
import { useAction } from "@/hooks/use-action";
import { formatPhoneDisplay } from "@/lib/phone";
import { fmtNumber, fmtRelative } from "@/lib/format";
import { withParams, type SP } from "@/lib/search-params";
import { bulkContactsAction } from "./actions";
import { ELIGIBILITY_INFO, eligibilityOf } from "@/lib/consent";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type ContactRow = {
  id: string;
  phone: string;
  name: string | null;
  source: string | null;
  consent: "UNKNOWN" | "GRANTED" | "REVOKED";
  suppressed: boolean;
  tags: string[];
  sentCount: number;
  readCount: number;
  clickCount: number;
  lastSentAt: string | null;
  createdAt: string;
};

const TONE_STATUS = { success: "PASSED", danger: "REVOKED", warning: "NOT_STARTED" } as const;

function Sort({ sp, field, label }: { sp: SP; field: string; label: string }) {
  const current = sp.sort === field;
  const dir = current ? (sp.dir === "asc" ? "asc" : "desc") : null;
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <Link href={withParams("/contacts", sp, { sort: field, dir: current && dir === "desc" ? "asc" : "desc" })} className="inline-flex items-center gap-1 hover:text-foreground">
      {label}
      <Icon className={current ? "size-3.5" : "size-3.5 opacity-40"} />
    </Link>
  );
}

export function ContactsTable({ rows, sp, canWrite, tags, audiences }: { rows: ContactRow[]; sp: SP; canWrite: boolean; tags: { id: string; name: string }[]; audiences: { id: string; name: string }[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { run, pending } = useAction();
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const bulk = (op: "tag_add" | "tag_remove" | "audience_add", targetId: string) =>
    run(() => bulkContactsAction({ ids: [...selected], op, targetId }), { success: (n) => `עודכנו ${n} אנשי קשר`, onSuccess: () => setSelected(new Set()) });

  return (
    <>
      {canWrite && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b bg-accent/50 px-4 py-2 text-sm">
          <span className="font-medium">{selected.size} נבחרו</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={pending || tags.length === 0}>
                <Tag />
                תגיות
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              <DropdownMenuLabel>הוספת תגית</DropdownMenuLabel>
              {tags.map((t) => (
                <DropdownMenuItem key={`a${t.id}`} onSelect={() => bulk("tag_add", t.id)}>
                  {t.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>הסרת תגית</DropdownMenuLabel>
              {tags.map((t) => (
                <DropdownMenuItem key={`r${t.id}`} onSelect={() => bulk("tag_remove", t.id)}>
                  {t.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={pending || audiences.length === 0}>
                <UsersRound />
                הוספה לקבוצה
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              {audiences.map((a) => (
                <DropdownMenuItem key={a.id} onSelect={() => bulk("audience_add", a.id)}>
                  {a.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            ניקוי בחירה
          </Button>
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            {canWrite ? (
              <TableHead className="w-10">
                <Checkbox checked={allSelected} onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} aria-label="בחירת כל השורות" />
              </TableHead>
            ) : null}
            <TableHead>
              <Sort sp={sp} field="name" label="שם" />
            </TableHead>
            <TableHead>טלפון</TableHead>
            <TableHead>כשירות לשליחה</TableHead>
            <TableHead className="hidden lg:table-cell">מקור</TableHead>
            <TableHead className="hidden xl:table-cell">תגיות</TableHead>
            <TableHead className="text-end">
              <Sort sp={sp} field="sentCount" label="נשלחו" />
            </TableHead>
            <TableHead className="hidden text-end md:table-cell">נקראו</TableHead>
            <TableHead className="hidden text-end md:table-cell">
              <Sort sp={sp} field="clickCount" label="קליקים" />
            </TableHead>
            <TableHead className="hidden lg:table-cell">
              <Sort sp={sp} field="lastSentAt" label="שליחה אחרונה" />
            </TableHead>
            <TableHead className="hidden sm:table-cell">
              <Sort sp={sp} field="createdAt" label="נוסף" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id} data-state={selected.has(c.id) ? "selected" : undefined}>
              {canWrite ? (
                <TableCell>
                  <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} aria-label={`בחירת ${c.name ?? c.phone}`} />
                </TableCell>
              ) : null}
              <TableCell className="font-medium">
                <Link href={`/contacts/${c.id}`} className="hover:underline">
                  {c.name || <span className="text-muted-foreground">ללא שם</span>}
                </Link>
              </TableCell>
              <TableCell>
                <span className="ltr tabular text-sm">{formatPhoneDisplay(c.phone)}</span>
              </TableCell>
              <TableCell>
                {(() => {
                  const info = ELIGIBILITY_INFO[eligibilityOf({ consentStatus: c.consent, isSuppressed: c.suppressed })];
                  return (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <StatusBadge status={TONE_STATUS[info.tone]} label={info.label} />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-64 text-xs">{info.explain}</TooltipContent>
                    </Tooltip>
                  );
                })()}
              </TableCell>
              <TableCell className="hidden max-w-36 truncate text-muted-foreground lg:table-cell">{c.source ?? "—"}</TableCell>
              <TableCell className="hidden xl:table-cell">
                <div className="flex max-w-56 flex-wrap gap-1">
                  {c.tags.slice(0, 3).map((t) => (
                    <Pill key={t} tone="muted">
                      {t}
                    </Pill>
                  ))}
                  {c.tags.length > 3 ? <Pill tone="muted">+{c.tags.length - 3}</Pill> : null}
                </div>
              </TableCell>
              <TableCell className="tabular text-end">{fmtNumber(c.sentCount)}</TableCell>
              <TableCell className="tabular hidden text-end md:table-cell">{fmtNumber(c.readCount)}</TableCell>
              <TableCell className="tabular hidden text-end md:table-cell">{fmtNumber(c.clickCount)}</TableCell>
              <TableCell suppressHydrationWarning className="hidden text-muted-foreground lg:table-cell">{c.lastSentAt ? fmtRelative(c.lastSentAt) : "—"}</TableCell>
              <TableCell suppressHydrationWarning className="hidden text-muted-foreground sm:table-cell">{fmtRelative(c.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
