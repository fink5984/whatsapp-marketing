"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Copy, Pause, Play, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionButton, ConfirmAction } from "@/components/app/confirm";
import { useAction } from "@/hooks/use-action";
import { cancelCampaignAction, duplicateCampaignAction, pauseCampaignAction, requeueUncertainAction, resumeCampaignAction } from "../actions";

export function CampaignControls({ id, status, uncertain, canLaunch, canWrite }: { id: string; status: string; uncertain: number; canLaunch: boolean; canWrite: boolean }) {
  const router = useRouter();
  const { run, pending } = useAction();
  return (
    <>
      {canWrite ? (
        <Button variant="outline" disabled={pending} onClick={() => run(() => duplicateCampaignAction({ id }), { success: "נוצר עותק כטיוטה", onSuccess: (newId) => router.push(`/campaigns/${newId}/setup`) })}>
          <Copy />
          שכפול
        </Button>
      ) : null}
      {canLaunch && ["RUNNING", "QUEUED", "SCHEDULED"].includes(status) ? (
        <ActionButton variant="outline" action={() => pauseCampaignAction({ id })} success="הקמפיין הושהה — הודעות חדשות לא יישלחו">
          <Pause />
          השהיה
        </ActionButton>
      ) : null}
      {canLaunch && status === "PAUSED" ? (
        <ActionButton action={() => resumeCampaignAction({ id })} success="הקמפיין חודש">
          <Play />
          חידוש
        </ActionButton>
      ) : null}
      {canLaunch && uncertain > 0 ? (
        <ConfirmAction
          trigger={
            <Button variant="outline">
              <RotateCcw />
              שליחה חוזרת ({uncertain})
            </Button>
          }
          title="שליחה חוזרת להודעות לא ודאיות"
          description={`${uncertain} הודעות לא קיבלו אישור מ-Meta במשך יותר מ-30 דקות. ייתכן שחלקן נמסרו בפועל — שליחה חוזרת עלולה לגרום לנמענים לקבל את ההודעה פעמיים.`}
          confirmLabel="שליחה חוזרת"
          action={() => requeueUncertainAction({ id })}
          success="ההודעות הוחזרו לתור"
        />
      ) : null}
      {canLaunch && ["RUNNING", "QUEUED", "SCHEDULED", "PAUSED"].includes(status) ? (
        <ConfirmAction
          trigger={
            <Button variant="destructive">
              <Square />
              ביטול
            </Button>
          }
          title="ביטול הקמפיין"
          description="כל ההודעות שטרם נשלחו יבוטלו. הודעות שכבר נשלחו אינן ניתנות לביטול. לא ניתן לחדש קמפיין שבוטל."
          confirmLabel="ביטול הקמפיין"
          destructive
          typeToConfirm="בטל"
          action={() => cancelCampaignAction({ id })}
          success="הקמפיין בוטל"
        />
      ) : null}
    </>
  );
}

/** Refreshes server data periodically while a campaign is live. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
