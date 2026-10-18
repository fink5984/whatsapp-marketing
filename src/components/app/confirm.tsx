"use client";

import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";

type Result = { ok: true; data: unknown; message?: string } | { ok: false; error: string };

/**
 * Button that requires confirmation before running a (dangerous) Server
 * Action. Optional `typeToConfirm` forces typing a phrase for destructive ops.
 */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel = "אישור",
  destructive,
  typeToConfirm,
  action,
  success,
  onDone,
  open: openProp,
  onOpenChange,
}: {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  typeToConfirm?: string;
  action: () => Promise<Result>;
  success?: string;
  onDone?: () => void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (o: boolean) => (onOpenChange ? onOpenChange(o) : setOpenState(o));
  const [typed, setTyped] = useState("");
  const { run, pending } = useAction();
  const blocked = !!typeToConfirm && typed.trim() !== typeToConfirm;
  return (
    <AlertDialog open={open} onOpenChange={(o) => (setOpen(o), setTyped(""))}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {typeToConfirm ? (
          <div className="space-y-1.5">
            <p className="text-sm">
              להמשך הקלידו: <strong className="select-all">{typeToConfirm}</strong>
            </p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus aria-label="אישור בהקלדה" />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>ביטול</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={pending || blocked}
              onClick={async (e) => {
                e.preventDefault();
                const res = await run(action, { success });
                if (res.ok) {
                  setOpen(false);
                  onDone?.();
                }
              }}
            >
              {pending ? <Spinner /> : null}
              {confirmLabel}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Non-destructive one-click action with toast feedback. */
export function ActionButton({
  action,
  success,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "onClick" | "action"> & { action: () => Promise<Result>; success?: string }) {
  const { run, pending } = useAction();
  return (
    <Button {...props} disabled={pending || props.disabled} onClick={() => run(action, { success })}>
      {pending ? <Spinner /> : null}
      {children}
    </Button>
  );
}
