/**
 * Creates an isolated, clearly-labelled test organization + owner for local
 * E2E runs against scripts/fake-meta.mjs. Never run against production.
 */
import "dotenv/config";
import { db, disconnectDb } from "@/server/db";
import { createOrganizationWithOwner } from "@/server/services/organizations";
import { FINANCIAL_INDUSTRY } from "@/server/services/compliance";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to create test data in production");
  const email = process.env.E2E_EMAIL ?? "e2e@test.local";
  const existing = await db.user.findUnique({ where: { email }, include: { memberships: true } });
  if (existing) {
    for (const m of existing.memberships) await db.organization.delete({ where: { id: m.organizationId } });
    await db.user.delete({ where: { id: existing.id } });
  }
  await db.whatsappAccount.deleteMany({ where: { wabaId: "123456789012345" } });
  const { org } = await createOrganizationWithOwner({
    orgName: "סביבת בדיקה (נתוני בדיקה בלבד)",
    industry: FINANCIAL_INDUSTRY,
    owner: { email, name: "בודק E2E", password: process.env.E2E_PASSWORD ?? "E2eTest2026!" },
  });
  console.log(`test org ${org.id} / ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(disconnectDb);
