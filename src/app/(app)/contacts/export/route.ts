import { NextResponse, type NextRequest } from "next/server";
import { getAppContext } from "@/server/auth/current";
import { exportContactsCsv } from "@/server/services/contacts";
import { filterFromSearchParams } from "@/server/services/contact-filter";
import { rateLimit } from "@/server/rate-limit";

export async function GET(req: NextRequest) {
  const ctx = await getAppContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));
  if (!ctx.can("contacts:export")) return new NextResponse("Forbidden", { status: 403 });
  const rl = await rateLimit(`export:${ctx.user.id}`, 10, 3600);
  if (!rl.allowed) return new NextResponse("יותר מדי ייצואים. נסו שוב מאוחר יותר.", { status: 429 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const csv = await exportContactsCsv(ctx, filterFromSearchParams(sp));
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="contacts-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
