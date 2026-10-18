import { db } from "../db";
import { audit } from "../audit";
import { systemContext } from "../context";
import { purgeExpiredSessions } from "../auth/sessions";
import { purgeExpiredRateLimits } from "../rate-limit";

const DAY = 86400_000;

/** Applies each organization's data-retention policy. Suppression entries are never purged. */
export async function applyRetention() {
  const orgs = await db.businessSettings.findMany();
  for (const s of orgs) {
    const now = Date.now();
    const [inbound, clicks, audits] = await Promise.all([
      db.inboundMessage.updateMany({
        where: { organizationId: s.organizationId, receivedAt: { lt: new Date(now - s.retentionInboundDays * DAY) }, text: { not: null } },
        data: { text: null, raw: undefined, buttonText: null },
      }),
      db.linkClick.deleteMany({ where: { organizationId: s.organizationId, clickedAt: { lt: new Date(now - s.retentionClicksDays * DAY) } } }),
      db.auditLog.deleteMany({ where: { organizationId: s.organizationId, createdAt: { lt: new Date(now - s.retentionAuditDays * DAY) } } }),
    ]);
    // Message payloads contain personal data; keep metadata, drop the body after the inbound retention period.
    const payloads = await db.outboundMessage.updateMany({
      where: {
        organizationId: s.organizationId,
        createdAt: { lt: new Date(now - s.retentionInboundDays * DAY) },
        status: { notIn: ["QUEUED", "SENDING"] },
        NOT: { payload: { equals: { redacted: true } } },
      },
      data: { payload: { redacted: true } },
    });
    if (inbound.count + clicks.count + audits.count + payloads.count > 0) {
      await audit(systemContext(s.organizationId, "retention"), "retention.purge", {}, {
        inboundRedacted: inbound.count,
        clicksDeleted: clicks.count,
        auditDeleted: audits.count,
        payloadsRedacted: payloads.count,
      });
    }
  }
  const maxWebhookDays = Math.min(...orgs.map((o) => o.retentionWebhookRawDays), 30);
  await db.webhookEvent.deleteMany({ where: { processedAt: { not: null, lt: new Date(Date.now() - maxWebhookDays * DAY) } } });
  await db.webhookDelivery.deleteMany({ where: { status: { in: ["SUCCEEDED", "DEAD"] }, createdAt: { lt: new Date(Date.now() - 30 * DAY) } } });
  await purgeExpiredSessions();
  await purgeExpiredRateLimits();
}
