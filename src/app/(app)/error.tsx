"use client";

import { ShieldAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = error.message.includes("הרשאה");
  const notFound = error.message.includes("לא נמצא");
  return (
    <div className="py-10">
      <EmptyState
        icon={forbidden ? ShieldAlert : TriangleAlert}
        title={forbidden ? "אין הרשאה" : notFound ? "הפריט לא נמצא" : "אירעה שגיאה"}
        description={
          forbidden
            ? "אין לך הרשאה לצפות בעמוד זה. פנה/י למנהל המערכת."
            : notFound
              ? "ייתכן שהפריט נמחק או שאינו שייך לעסק הפעיל."
              : `לא ניתן היה לטעון את העמוד.${error.digest ? ` (קוד: ${error.digest})` : ""}`
        }
      >
        {!forbidden && !notFound ? <Button onClick={reset}>נסו שוב</Button> : null}
      </EmptyState>
    </div>
  );
}
