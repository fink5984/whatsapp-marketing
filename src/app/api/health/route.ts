import { NextResponse } from "next/server";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness/readiness for Railway. 200 when the DB answers; reports worker freshness without failing on it. */
export async function GET() {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const worker = await db.workerHeartbeat.findFirst({ orderBy: { beatAt: "desc" }, select: { beatAt: true } });
    const workerAgeSec = worker ? Math.round((Date.now() - worker.beatAt.getTime()) / 1000) : null;
    return NextResponse.json(
      { status: "ok", db: "ok", dbLatencyMs: Date.now() - started, worker: workerAgeSec !== null && workerAgeSec < 60 ? "ok" : "stale", workerLastBeatSec: workerAgeSec },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ status: "error", db: "unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
