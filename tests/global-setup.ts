import { execSync } from "node:child_process";
import { config } from "dotenv";

/** Applies migrations to the dedicated test database (non-destructive). */
export default function setup() {
  config();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set to run tests (never point it at production)");
  if (!/\/[^/?]+_test(\?|$)/.test(url)) throw new Error("TEST_DATABASE_URL database name must end with _test");
  execSync("pnpm exec prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "pipe",
  });
}
