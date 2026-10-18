import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Meta's X-Hub-Signature-256 header ("sha256=<hex>") — an HMAC-SHA256
 * of the exact raw request body keyed with the App Secret.
 */
export function verifyMetaSignature(rawBody: Buffer | string, header: string | null | undefined, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const [algo, sig] = header.split("=", 2);
  if (algo !== "sha256" || !sig || !/^[0-9a-f]{64}$/i.test(sig)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
