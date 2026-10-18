import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

const ENC_VERSION = "v1";

/** 32-byte key from a secret: base64 of exactly 32 bytes is used as-is; anything else is SHA-256 hashed. */
export function keyBytes(secret: string): Buffer {
  const b = Buffer.from(secret, "base64");
  return b.length === 32 && /^[A-Za-z0-9+/]{43}=$/.test(secret) ? b : createHash("sha256").update(secret, "utf8").digest();
}

function encryptionKey(): Buffer {
  return keyBytes(env().ENCRYPTION_KEY);
}

/** AES-256-GCM. Output: "v1:<base64(iv | tag | ciphertext)>". */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

export function decryptSecret(value: string): string {
  const [version, data] = value.split(":", 2);
  if (version !== ENC_VERSION || !data) throw new Error("Unsupported secret format");
  const buf = Buffer.from(data, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function decryptOptional(value: string | null | undefined): string | null {
  return value ? decryptSecret(value) : null;
}

/** Shows only the last 4 characters of a secret. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return "";
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(secret: string | Buffer, input: string | Buffer): string {
  return createHmac("sha256", secret).update(input).digest("hex");
}

/** Keyed hash of an E.164 phone number. Used by the suppression list so blocks survive deletion. */
export function hashPhone(e164: string): string {
  return hmacSha256Hex(keyBytes(env().HASH_PEPPER), `phone:${e164}`);
}

/** Visitor fingerprint for unique-click counting; rotates daily so it cannot track people over time. */
export function visitorHash(ip: string, userAgent: string, day: string): string {
  return hmacSha256Hex(keyBytes(env().HASH_PEPPER), `visitor:${day}:${ip}:${userAgent}`).slice(0, 32);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

const ALPHANUM = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** URL-safe alphanumeric token (no ambiguous punctuation) for tracked links. */
export function randomAlphanumeric(length: number): string {
  const out: string[] = [];
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      // Rejection sampling keeps the distribution uniform.
      if (b < 248 && out.length < length) out.push(ALPHANUM[b % 62]);
    }
  }
  return out.join("");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
