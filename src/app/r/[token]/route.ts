import { NextResponse, type NextRequest } from "next/server";
import { recordClick } from "@/server/services/links";
import { rateLimit } from "@/server/rate-limit";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * Tracked-link redirect. The destination is looked up server-side from a
 * random token — never taken from the request — so this cannot be abused as
 * an open redirect. No personal data appears in the URL.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
  const rl = await rateLimit(`click:${ip}`, 120, 60);
  if (!rl.allowed) return new NextResponse("Too Many Requests", { status: 429 });
  let res: Awaited<ReturnType<typeof recordClick>> = null;
  try {
    res = await recordClick(token, { ip, userAgent: req.headers.get("user-agent") });
  } catch (err) {
    logger.error("click tracking failed", { err });
  }
  if (!res) {
    return new NextResponse("<!doctype html><html lang=he dir=rtl><meta charset=utf-8><title>קישור לא תקין</title><body style=\"font-family:sans-serif;text-align:center;padding:4rem\">הקישור אינו תקין או שפג תוקפו.</body></html>", {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" },
    });
  }
  return NextResponse.redirect(res.destination, { status: 302, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex" } });
}
