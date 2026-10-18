import Link from "next/link";
import { AlertTriangle, CircleCheck, CircleDashed } from "lucide-react";
import { db } from "@/server/db";
import { ageMs } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Compact system status: WhatsApp connection + background worker liveness. */
export async function HeaderStatus({ orgId }: { orgId: string }) {
  const [accounts, worker, running] = await Promise.all([
    db.whatsappAccount.findMany({ where: { organizationId: orgId }, select: { status: true } }),
    db.workerHeartbeat.findFirst({ orderBy: { beatAt: "desc" } }),
    db.campaign.count({ where: { organizationId: orgId, status: "RUNNING" } }),
  ]);
  const workerOk = !!worker && ageMs(worker.beatAt) < 60_000;
  const connected = accounts.some((a) => a.status === "CONNECTED");
  const accountError = accounts.some((a) => a.status === "ERROR");
  return (
    <div className="flex items-center gap-3 text-xs">
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href="/accounts" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
            {accountError ? <AlertTriangle className="size-3.5 text-destructive" /> : connected ? <CircleCheck className="size-3.5 text-success" /> : <CircleDashed className="size-3.5 text-warning" />}
            <span className="hidden sm:inline">{accountError ? "שגיאת חיבור" : connected ? "WhatsApp מחובר" : "ממתין לחיבור WhatsApp"}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent>מצב החיבור לחשבונות WhatsApp Business</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className={`size-2 rounded-full ${workerOk ? "bg-success" : "bg-destructive"}`} />
            <span className="hidden sm:inline">{workerOk ? (running ? `שולח · ${running} פעילים` : "מנוע שליחה פעיל") : "מנוע שליחה לא פעיל"}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          {workerOk ? "שירות ה-Worker פעיל ומעבד את תור ההודעות." : "שירות ה-Worker אינו מדווח. הודעות לא יישלחו עד שיופעל (pnpm worker / שירות Worker ב-Railway)."}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
