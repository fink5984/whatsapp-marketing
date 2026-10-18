"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

function useParamSetter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const q = next.toString();
    start(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
  };
  return { set, params, pending };
}

export function SearchInput({ placeholder = "חיפוש…", param = "q", className }: { placeholder?: string; param?: string; className?: string }) {
  const { set, params, pending } = useParamSetter();
  const [value, setValue] = useState(params.get(param) ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => set({ [param]: value.trim() || null }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <InputGroup className={className ?? "w-full sm:w-72"}>
      <InputGroupAddon>{pending ? <Spinner /> : <Search />}</InputGroupAddon>
      <InputGroupInput value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value ? (
        <InputGroupAddon align="inline-end">
          <button type="button" onClick={() => setValue("")} aria-label="ניקוי חיפוש" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}

export function FilterSelect({ param, options, placeholder, allLabel = "הכל", className }: { param: string; options: { value: string; label: string }[]; placeholder: string; allLabel?: string; className?: string }) {
  const { set, params } = useParamSetter();
  const current = params.get(param) ?? "__all";
  return (
    <Select value={current} onValueChange={(v) => set({ [param]: v === "__all" ? null : v })}>
      <SelectTrigger className={className ?? "w-full sm:w-44"} aria-label={placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">
          {placeholder}: {allLabel}
        </SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TableToolbar({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>;
}
