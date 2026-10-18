import type { OutboundStatus } from "@/generated/prisma/enums";

export type IncomingStatus = "sent" | "delivered" | "read" | "failed";

const RANK: Partial<Record<OutboundStatus, number>> = {
  QUEUED: 0,
  SENDING: 0,
  UNCERTAIN: 0,
  SUBMITTED: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
};

/**
 * Status webhooks can arrive out of order and more than once. Status only
 * moves forward (submitted → sent → delivered → read). "failed" never
 * overrides confirmed delivery; a later delivered/read overrides a failure.
 * Returns the new status, or null when the event doesn't change it.
 */
export function nextOutboundStatus(current: OutboundStatus, incoming: IncomingStatus): OutboundStatus | null {
  if (current === "CANCELLED" || current === "SKIPPED") return null;
  if (incoming === "failed") {
    if (current === "DELIVERED" || current === "READ" || current === "FAILED") return null;
    return "FAILED";
  }
  const target: OutboundStatus = incoming === "sent" ? "SENT" : incoming === "delivered" ? "DELIVERED" : "READ";
  if (current === "FAILED") return incoming === "sent" ? null : target;
  return (RANK[target] ?? 0) > (RANK[current] ?? 0) ? target : null;
}
