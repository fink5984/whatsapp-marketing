import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export type PhoneResult =
  | { ok: true; e164: string; isMobile: boolean; country?: string }
  | { ok: false; reason: string };

/**
 * Normalizes user-entered phone numbers to E.164.
 * Handles Israeli formats: 050-1234567, 0501234567, 972501234567, +972-50-123-4567,
 * 00972501234567, and stray characters (spaces, dashes, parentheses, RTL marks).
 */
export function normalizePhone(raw: unknown, defaultCountry: string = "IL"): PhoneResult {
  if (raw === null || raw === undefined) return { ok: false, reason: "חסר מספר טלפון" };
  let input = String(raw)
    .normalize("NFKC")
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .trim();
  if (!input) return { ok: false, reason: "חסר מספר טלפון" };

  // Excel sometimes turns numbers into "9.72501E+11" or "972501234567.0"
  if (/^\d+\.0+$/.test(input)) input = input.replace(/\.0+$/, "");
  if (/e\+/i.test(input)) return { ok: false, reason: "מספר בפורמט מדעי (Excel) — יש לעצב את העמודה כטקסט" };

  const hasPlus = input.startsWith("+");
  let digits = input.replace(/\D/g, "");
  if (!digits) return { ok: false, reason: "המספר אינו מכיל ספרות" };

  if (!hasPlus && digits.startsWith("00")) {
    digits = digits.slice(2);
    input = `+${digits}`;
  } else if (hasPlus) {
    input = `+${digits}`;
  } else if (defaultCountry === "IL" && digits.startsWith("972") && digits.length >= 11) {
    // 972501234567 / 9720501234567 (common mistake: keeping the trunk 0)
    const national = digits.slice(3).replace(/^0/, "");
    input = `+972${national}`;
  } else {
    input = digits;
  }

  const parsed = parsePhoneNumberFromString(input, defaultCountry as CountryCode);
  // Strict range metadata lags newly assigned prefixes, so "possible" numbers
  // (right length/shape for the country) are accepted; WhatsApp itself is the
  // final check (error 131026 for numbers not on WhatsApp).
  if (!parsed || !parsed.isPossible()) return { ok: false, reason: "מספר טלפון לא תקין" };
  const national = String(parsed.nationalNumber);
  if (parsed.countryCallingCode === "972" && !/^(5\d{8}|[2-489]\d{7}|7\d{8})$/.test(national)) {
    return { ok: false, reason: "מספר טלפון ישראלי לא תקין" };
  }
  const type = parsed.isValid() ? parsed.getType() : undefined;
  const isMobile =
    type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE" || (parsed.countryCallingCode === "972" && national.startsWith("5"));
  return { ok: true, e164: parsed.number, isMobile, country: parsed.country ?? (parsed.countryCallingCode === "972" ? "IL" : undefined) };
}

/** WhatsApp wa_id (digits only, with country code) → E.164 */
export function waIdToE164(waId: string): string {
  return `+${waId.replace(/\D/g, "")}`;
}

/** E.164 → the digits-only "to" format expected by the Cloud API */
export function e164ToWaId(e164: string): string {
  return e164.replace(/\D/g, "");
}

export function formatPhoneDisplay(e164: string | null | undefined): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === "IL" ? parsed.formatNational() : parsed.formatInternational();
}
