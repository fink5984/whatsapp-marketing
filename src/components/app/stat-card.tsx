import type { LucideIcon } from "lucide-react";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { QualityTag } from "./badges";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon: Icon,
  quality,
  hint,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  icon?: LucideIcon;
  quality?: "exact" | "partial" | "estimate";
  hint?: string;
  sub?: React.ReactNode;
  tone?: "default" | "primary" | "danger" | "warning";
}) {
  return (
    <Card className="gap-0 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span>{label}</span>
          {hint ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground/70 hover:text-foreground" aria-label={`הסבר: ${label}`}>
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-64 text-xs leading-relaxed">{hint}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        {Icon ? (
          <span
            className={cn(
              "flex size-8 items-center justify-center rounded-lg",
              tone === "primary" && "bg-primary/10 text-primary",
              tone === "danger" && "bg-destructive/10 text-destructive",
              tone === "warning" && "bg-warning/15 text-[color-mix(in_oklch,var(--warning),black_35%)]",
              tone === "default" && "bg-muted text-muted-foreground",
            )}
          >
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="tabular text-2xl font-semibold tracking-tight">{value}</span>
        {quality ? <QualityTag quality={quality} /> : null}
      </div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </Card>
  );
}
