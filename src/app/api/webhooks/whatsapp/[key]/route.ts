import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { decryptOptional } from "@/server/crypto";
import { handleEvent, handleVerify } from "@/server/webhooks/http";

export const dynamic = "force-dynamic";

/** Per-account webhook endpoint (manual connection with the business's own Meta App). */
async function account(key: string) {
  if (!/^[A-Za-z0-9]{24}$/.test(key)) return null;
  return db.whatsappAccount.findUnique({ where: { webhookKey: key }, select: { id: true, organizationId: true, appSecretEnc: true, webhookVerifyTokenEnc: true } });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const a = await account((await params).key);
  if (!a) return new NextResponse("Not found", { status: 404 });
  return handleVerify(req, decryptOptional(a.webhookVerifyTokenEnc));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const a = await account((await params).key);
  if (!a) return new NextResponse("Not found", { status: 404 });
  return handleEvent(req, a);
}
