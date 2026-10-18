"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { updateLeadAction } from "./actions";

const LABELS = { NEW: "חדש", CONTACTED: "נוצר קשר", QUALIFIED: "רלוונטי", WON: "נסגר בהצלחה", LOST: "לא רלוונטי" } as const;

export function LeadStatusSelect({ id, status }: { id: string; status: keyof typeof LABELS }) {
  const { run, pending } = useAction();
  return (
    <Select value={status} disabled={pending} onValueChange={(v) => run(() => updateLeadAction({ id, status: v as keyof typeof LABELS }), { success: "הליד עודכן" })}>
      <SelectTrigger size="sm" className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(LABELS).map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
