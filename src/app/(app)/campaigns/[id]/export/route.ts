import { NextResponse, type NextRequest } from "next/server";
import { getAppContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { audit } from "@/server/audit";

function esc(v: unknown) {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAppContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));
  if (!ctx.can("contacts:export")) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await params;
  const campaign = await db.campaign.findFirst({ where: { id, organizationId: ctx.orgId }, select: { id: true, name: true } });
  if (!campaign) return new NextResponse("Not found", { status: 404 });
  const rows = await db.campaignRecipient.findMany({
    where: { campaignId: id, organizationId: ctx.orgId },
    include: { contact: { select: { name: true } }, message: true },
    orderBy: { createdAt: "asc" },
  });
  const header = ["phone", "name", "eligibility", "exclusion_reason", "status", "submitted_at", "sent_at", "delivered_at", "read_at", "failed_at", "error_code", "billable"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const m = r.message;
    lines.push([r.phoneE164, r.contact?.name, r.eligibility, r.exclusionReason, m?.status, m?.submittedAt, m?.sentAt, m?.deliveredAt, m?.readAt, m?.failedAt, m?.errorCode, m?.billable].map(esc).join(","));
  }
  await audit(ctx, "contact.export", { type: "campaign", id }, { kind: "campaign_recipients", count: rows.length });
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="campaign-${id}.csv"`, "cache-control": "no-store" },
  });
}
