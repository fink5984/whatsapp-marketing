/**
 * First-run bootstrap: creates the first organization and its owner.
 *   BOOTSTRAP_ORG_NAME, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_PASSWORD
 * Idempotent and safe to run on every deploy: does nothing if an organization
 * already exists, and never fails the deploy when the variables are missing.
 * No demo data is created.
 */
import "dotenv/config";
import { db, disconnectDb } from "@/server/db";
import { createOrganizationWithOwner } from "@/server/services/organizations";
import { FINANCIAL_INDUSTRY } from "@/server/services/compliance";

async function main() {
  if ((await db.organization.count()) > 0) {
    console.log("Organizations already exist — bootstrap skipped.");
    return;
  }
  const orgName = process.env.BOOTSTRAP_ORG_NAME || "לינדר פיננסים";
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const name = process.env.BOOTSTRAP_ADMIN_NAME || "מנהל מערכת";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn("No organization yet — set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD to create the first owner on the next deploy.");
    return;
  }
  const { org, user } = await createOrganizationWithOwner({
    orgName,
    industry: process.env.BOOTSTRAP_INDUSTRY ?? FINANCIAL_INDUSTRY,
    owner: { email, name, password },
  });
  console.log(`Created organization "${org.name}" (${org.id}) with owner ${user.email}.`);
  console.log("Remove BOOTSTRAP_ADMIN_PASSWORD from the environment now.");
}

main()
  .catch((err) => {
    // Never block a deploy on bootstrap problems (e.g. weak password) — report and continue.
    console.error("Bootstrap skipped:", err instanceof Error ? err.message : err);
  })
  .finally(disconnectDb);
