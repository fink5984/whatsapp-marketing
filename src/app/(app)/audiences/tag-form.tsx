"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { createTagAction } from "../contacts/actions";

export function TagForm() {
  const [name, setName] = useState("");
  const { run, pending } = useAction();
  return (
    <form
      className="mb-4 flex max-w-md gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) run(() => createTagAction({ name }), { success: "התגית נוצרה", onSuccess: () => setName("") });
      }}
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם תגית חדשה" aria-label="שם תגית חדשה" maxLength={50} />
      <Button type="submit" disabled={pending || !name.trim()}>
        <Plus />
        הוספה
      </Button>
    </form>
  );
}
