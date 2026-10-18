"use client";

import { useState } from "react";
import { Ban } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { addSuppressionAction } from "./actions";

export function AddSuppressionDialog() {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [detail, setDetail] = useState("");
  const { run, pending } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">
          <Ban />
          הוספת מספר לחסימה
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>הוספה לרשימת ההסרה</DialogTitle>
          <DialogDescription>למשל: בקשת הסרה טלפונית או בדוא״ל. המספר ייחסם גם אם אינו קיים עדיין כאיש קשר.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="sup-phone">מספר טלפון</Label>
            <Input id="sup-phone" dir="ltr" className="text-start" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="050-1234567" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sup-detail">פירוט / מקור הבקשה</Label>
            <Input id="sup-detail" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="ביקש בשיחת טלפון ב-18/10" />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={pending || !phone.trim()}
            onClick={() => run(() => addSuppressionAction({ phone, detail }), { success: "המספר נחסם", onSuccess: () => (setOpen(false), setPhone(""), setDetail("")) })}
          >
            {pending ? <Spinner /> : null}
            חסימה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
