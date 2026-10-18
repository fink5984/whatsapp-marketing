"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

type Result<T> = { ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Calls a Server Action with pending state, toast feedback and a router
 * refresh on success. Returns the result so callers can react to field errors.
 */
export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run<T>(
    action: () => Promise<Result<T>>,
    opts: { success?: string | ((data: T) => string); onSuccess?: (data: T) => void; onError?: (r: Extract<Result<T>, { ok: false }>) => void; refresh?: boolean } = {},
  ): Promise<Result<T>> {
    return new Promise((resolve) => {
      startTransition(async () => {
        let res: Result<T>;
        try {
          res = await action();
        } catch {
          res = { ok: false, error: "אירעה שגיאת תקשורת. נסו שוב." };
        }
        if (res.ok) {
          const msg = typeof opts.success === "function" ? opts.success(res.data) : (opts.success ?? res.message);
          if (msg) toast.success(msg);
          opts.onSuccess?.(res.data);
          if (opts.refresh !== false) router.refresh();
        } else {
          toast.error(res.error);
          opts.onError?.(res);
        }
        resolve(res);
      });
    });
  }

  return { run, pending };
}
