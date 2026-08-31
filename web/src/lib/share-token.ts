import { randomBytes, createHash } from "crypto";

/**
 * Genuinely net new — nothing in this codebase generates or hashes
 * tokens (the closest prior art, qr_tokens in supabase/seed.sql, stores
 * raw human-readable slugs, not a hashed random token; not reusable
 * here). Spec (§5): 32-byte cryptographically random token, returned
 * once; only sha256(token) is ever persisted.
 */
export function generateShareToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashShareToken(token) };
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
