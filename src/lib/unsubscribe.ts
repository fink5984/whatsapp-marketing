export const DEFAULT_UNSUBSCRIBE_KEYWORDS = [
  "הסר",
  "הסרה",
  "להסיר",
  "אסר",
  "הסירו",
  "תסירו",
  "תסיר",
  "STOP",
  "UNSUBSCRIBE",
  "REMOVE",
];

/** Quick-reply payload the system attaches to unsubscribe buttons. */
export const UNSUBSCRIBE_BUTTON_PAYLOAD = "WCM_UNSUBSCRIBE";

const FINAL_LETTERS: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };

/**
 * Canonical form for keyword matching: Unicode NFKC, no niqqud/cantillation,
 * no bidi/zero-width marks, Hebrew final letters folded, Latin lowercased,
 * punctuation and emoji removed, letters repeated 3+ times collapsed.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[֑-ׇ]/g, "")
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[ךםןףץ]/g, (c) => FINAL_LETTERS[c])
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/(\p{L})\1{2,}/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_WORDS_FOR_CONTAINS = 6;

/**
 * True when an inbound text is an unsubscribe request. Exact match on the
 * whole (normalized) message, or a short message (≤ 6 words) that contains a
 * keyword as a whole word / phrase — e.g. "הסר אותי בבקשה", "Stop!!".
 * Errs on the side of honoring the request.
 */
export function isUnsubscribeText(text: string | null | undefined, keywords: string[] = DEFAULT_UNSUBSCRIBE_KEYWORDS): boolean {
  if (!text) return false;
  const norm = normalizeForMatch(text);
  if (!norm) return false;
  const words = norm.split(" ");
  const padded = ` ${norm} `;
  for (const kw of keywords) {
    const k = normalizeForMatch(kw);
    if (!k) continue;
    if (norm === k) return true;
    if (words.length <= MAX_WORDS_FOR_CONTAINS && padded.includes(` ${k} `)) return true;
  }
  return false;
}

export function isUnsubscribeButton(payload: string | null | undefined, buttonText: string | null | undefined, keywords?: string[]): boolean {
  if (payload && payload.trim().toUpperCase() === UNSUBSCRIBE_BUTTON_PAYLOAD) return true;
  if (payload && isUnsubscribeText(payload, keywords)) return true;
  return isUnsubscribeText(buttonText, keywords);
}
