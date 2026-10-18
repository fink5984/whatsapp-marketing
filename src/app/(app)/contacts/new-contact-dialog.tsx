"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { createContactAction } from "./actions";

export function NewContactDialog({ tags }: { tags: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ phone: "", name: "", source: "", notes: "" });
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, pending } = useAction();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          איש קשר חדש
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>איש קשר חדש</DialogTitle>
          <DialogDescription>הסכמה לשיווק מתועדת בנפרד, בעמוד איש הקשר, עם נוסח ואסמכתה.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createContactAction({ ...form, tagIds }), {
              success: "איש הקשר נוסף",
              onSuccess: (id) => {
                setOpen(false);
                router.push(`/contacts/${id}`);
              },
              onError: (r) => setErrors(r.fieldErrors ?? {}),
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="nc-phone">מספר טלפון *</Label>
            <Input id="nc-phone" dir="ltr" className="text-start" placeholder="050-1234567" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required aria-invalid={!!errors.phone} />
            <p className="text-xs text-muted-foreground">ינורמל אוטומטית לפורמט בינלאומי (‎+972…‎)</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nc-name">שם</Label>
              <Input id="nc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-source">מקור</Label>
              <Input id="nc-source" placeholder="למשל: אתר, כנס, הפניה" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nc-notes">הערות</Label>
            <Textarea id="nc-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {tags.length ? (
            <div className="space-y-1.5">
              <Label>תגיות</Label>
              <div className="flex flex-wrap gap-3">
                {tags.map((t) => (
                  <label key={t.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={tagIds.includes(t.id)} onCheckedChange={(v) => setTagIds(v ? [...tagIds, t.id] : tagIds.filter((x) => x !== t.id))} />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              שמירה
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
