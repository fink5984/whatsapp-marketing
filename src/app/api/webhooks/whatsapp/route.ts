import type { NextRequest } from "next/server";
import { env } from "@/server/env";
import { handleEvent, handleVerify } from "@/server/webhooks/http";

export const dynamic = "force-dynamic";

/** Shared webhook endpoint for the platform Meta App (META_APP_SECRET / META_WEBHOOK_VERIFY_TOKEN). */
export function GET(req: NextRequest) {
  return handleVerify(req, env().META_WEBHOOK_VERIFY_TOKEN || null);
}

export function POST(req: NextRequest) {
  return handleEvent(req, null);
}
