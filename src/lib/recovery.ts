import crypto from "crypto";

/** Human-friendly recovery code, e.g. "K7QF2-M9XTB-3WRHP-ZL4NC" (~100 bits). */
export function newRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const bytes = crypto.randomBytes(20);
  let out = "";
  for (let i = 0; i < 20; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 5 === 4 && i < 19) out += "-";
  }
  return out;
}

/** Normalize what the user typed: uppercase, strip spaces and dashes. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
