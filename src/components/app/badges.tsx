import { cn } from "@/lib/utils";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary" | "muted";

const TONES: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground border-border",
  success: "bg-success/12 text-[color-mix(in_oklch,var(--success),black_25%)] border-success/25 dark:text-success",
  warning: "bg-warning/18 text-[color-mix(in_oklch,var(--warning),black_45%)] border-warning/30 dark:text-warning",
  danger: "bg-destructive/10 text-destructive border-destructive/25",
  info: "bg-info/12 text-[color-mix(in_oklch,var(--info),black_25%)] border-info/25 dark:text-info",
  primary: "bg-primary/10 text-primary border-primary/25",
  muted: "bg-muted text-muted-foreground border-transparent",
};

export function Pill({ tone = "neutral", children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONES[tone], className)}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  // campaigns
  DRAFT: "muted",
  SCHEDULED: "info",
  QUEUED: "info",
  RUNNING: "primary",
  PAUSED: "warning",
  COMPLETED: "success",
  CANCELLED: "muted",
  FAILED: "danger",
  // messages
  SENDING: "info",
  SUBMITTED: "info",
  SENT: "primary",
  DELIVERED: "success",
  READ: "success",
  SKIPPED: "muted",
  UNCERTAIN: "warning",
  // templates
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  DISABLED: "danger",
  IN_APPEAL: "warning",
  ARCHIVED: "muted",
  DELETED: "muted",
  UNKNOWN: "muted",
  // connection
  CONNECTED: "success",
  PENDING_SETUP: "warning",
  ERROR: "danger",
  DISCONNECTED: "muted",
  // consent
  GRANTED: "success",
  REVOKED: "danger",
  // conversation
  OPEN: "info",
  HANDLED: "muted",
  INTERESTED: "success",
  NOT_INTERESTED: "neutral",
  NEEDS_AGENT: "warning",
  // leads
  NEW: "info",
  CONTACTED: "primary",
  QUALIFIED: "success",
  WON: "success",
  LOST: "muted",
  // compliance
  PASSED: "success",
  NOT_STARTED: "warning",
  EXPIRED: "danger",
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <Pill tone={STATUS_TONES[status] ?? "neutral"} dot className={className}>
      {label ?? status}
    </Pill>
  );
}

export const MESSAGE_STATUS_LABELS: Record<string, string> = {
  QUEUED: "בתור",
  SENDING: "בשליחה",
  SUBMITTED: "התקבל ב-Meta",
  SENT: "נשלח",
  DELIVERED: "נמסר",
  READ: "נקרא",
  FAILED: "נכשל",
  SKIPPED: "דולג",
  CANCELLED: "בוטל",
  UNCERTAIN: "לא ודאי",
};

const QUALITY: Record<string, { label: string; className: string }> = {
  exact: { label: "מדויק", className: "text-success" },
  partial: { label: "חלקי", className: "text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning" },
  estimate: { label: "הערכה", className: "text-info" },
};

export function QualityTag({ quality }: { quality: "exact" | "partial" | "estimate" }) {
  const q = QUALITY[quality];
  return <span className={cn("text-[10px] font-medium uppercase tracking-wide", q.className)}>{q.label}</span>;
}

export function PhoneQualityBadge({ rating }: { rating: string | null | undefined }) {
  if (!rating) return <Pill tone="muted">איכות לא ידועה</Pill>;
  const map: Record<string, [Tone, string]> = { GREEN: ["success", "איכות גבוהה"], YELLOW: ["warning", "איכות בינונית"], RED: ["danger", "איכות נמוכה"] };
  const [tone, label] = map[rating] ?? ["muted", rating];
  return (
    <Pill tone={tone} dot>
      {label}
    </Pill>
  );
}

export function PendingExternal({ children = "ממתין להגדרה חיצונית" }: { children?: React.ReactNode }) {
  return (
    <Pill tone="warning" className="border-dashed">
      {children}
    </Pill>
  );
}
