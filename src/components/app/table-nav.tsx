import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtNumber } from "@/lib/format";
import { withParams, type SP } from "@/lib/search-params";

export function Pager({ path, sp, page, pageSize, total }: { path: string; sp: SP; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row">
      <span className="tabular">
        מציג {fmtNumber(from)}–{fmtNumber(to)} מתוך {fmtNumber(total)}
      </span>
      <div className="flex items-center gap-1">
        {/* In RTL "previous" points right */}
        <Button variant="outline" size="sm" asChild disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
          <Link href={withParams(path, sp, { page: page - 1 })} aria-label="הקודם">
            <ChevronRight className="size-4" />
            הקודם
          </Link>
        </Button>
        <span className="tabular px-2">
          {page} / {pages}
        </span>
        <Button variant="outline" size="sm" asChild className={page >= pages ? "pointer-events-none opacity-50" : ""}>
          <Link href={withParams(path, sp, { page: page + 1 })} aria-label="הבא">
            הבא
            <ChevronLeft className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function SortHeader({ path, sp, field, label, defaultDir = "desc" }: { path: string; sp: SP; field: string; label: string; defaultDir?: "asc" | "desc" }) {
  const current = sp.sort === field;
  const dir = current ? (sp.dir === "asc" ? "asc" : "desc") : null;
  const nextDir = current ? (dir === "asc" ? "desc" : "asc") : defaultDir;
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <Link href={withParams(path, sp, { sort: field, dir: nextDir })} className="inline-flex items-center gap-1 hover:text-foreground" aria-label={`מיון לפי ${label}`}>
      {label}
      <Icon className={current ? "size-3.5" : "size-3.5 opacity-40"} />
    </Link>
  );
}
