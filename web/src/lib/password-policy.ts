/**
 * Mirrors Supabase Auth's server-side minimum (Authentication → Sign In /
 * Providers → Email → Minimum password length), set to 8 on 2026-09-25.
 * The server setting is what enforces; this only makes the forms say the
 * same thing before a round trip. Change both together.
 */
export const MIN_PASSWORD_LENGTH = 8;
