/**
 * Badge tokens — the opaque identifier encoded in every badge QR as
 * `/s/<token>` (docs/moxie_digital_badge_provisioning_spec.md §1.4).
 *
 * WHAT THE TOKEN IS FOR, and just as importantly what it is not for.
 *
 * Its jobs are uniqueness and *unlinkability*. It must not be derivable
 * from the sequential MXE ID, or unsold inventory sitting in a warehouse
 * becomes enumerable by counting upwards. Hence random, never derived.
 *
 * It is NOT a secret, and must never be used to authorise anything. The
 * token ends up printed on a QR code stuck to the outside of a boat, in
 * public, permanently, photographable by anyone who walks past the dock.
 * Guessing one gets you a vessel profile that is already public at
 * /MXE-XXXXX. The genuinely secret value for unbound claiming is a
 * separate `claim_code_hash` that lives under a scratch-off panel and
 * never in a QR (§4.2).
 *
 * FORMAT: 9 characters of Crockford Base32, canonical uppercase.
 *
 * Crockford drops I, L, O and U from the alphabet — the first three
 * because they are visually confusable with 1, 1 and 0 on a printed
 * badge, and U because dropping it avoids accidentally spelling things
 * nobody wants on a customer's hull.
 *
 * 32^9 ≈ 3.5 × 10^13. At a million badges the birthday probability of at
 * least one collision is roughly 1.4%, which is deliberately not being
 * hand-waved: it does not need to be small, because the UNIQUE
 * constraint in 20260921_badge_identities.sql is the actual guarantee
 * and generateUniqueBadgeTokens retries around it. The entropy only
 * governs how often that retry fires, which is essentially never.
 */

/** Crockford Base32: 0-9 and A-Z minus I, L, O, U. Exactly 32 symbols. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const BADGE_TOKEN_LENGTH = 9;

/**
 * Must stay byte-identical to the CHECK constraint on
 * badge_identities.token. badge-token.test.mts asserts that against the
 * migration file itself rather than trusting this comment — the database
 * and the generator disagreeing about what a valid token looks like is
 * exactly the kind of drift that only shows up in production.
 */
export const BADGE_TOKEN_PATTERN = new RegExp(`^[0-9A-HJKMNP-TV-Z]{${BADGE_TOKEN_LENGTH}}$`);

/**
 * One token's worth of cryptographic randomness.
 *
 * `byte & 31` rather than `byte % ALPHABET.length` is the whole reason a
 * 32-symbol alphabet is worth having here: 32 is a power of two, so the
 * low 5 bits of a uniformly random byte are themselves uniform across
 * all 32 indices, with no modulo bias and no rejection sampling. A
 * 58-symbol alphabet would need one or the other, and the version that
 * gets written by accident is the biased one.
 *
 * Web Crypto rather than node:crypto so this module stays importable
 * from any runtime — Node, edge, or browser — without a conditional.
 */
export function generateBadgeToken(): string {
  const bytes = new Uint8Array(BADGE_TOKEN_LENGTH);
  crypto.getRandomValues(bytes);

  let token = "";
  for (let i = 0; i < BADGE_TOKEN_LENGTH; i += 1) {
    token += ALPHABET[bytes[i] & 31];
  }
  return token;
}

export function isValidBadgeToken(value: string): boolean {
  return BADGE_TOKEN_PATTERN.test(value);
}

/**
 * Canonicalises a token arriving from outside — specifically the
 * `/s/<token>` route (§1.7). Returns null for anything that isn't a
 * well-formed token, so the caller has one thing to check rather than
 * two.
 *
 * Uppercasing only. Crockford's decoding rules also map I and L to 1 and
 * O to 0 for human-typed input, and that is deliberately NOT applied
 * here: nothing in this product ever asks anyone to type a token (§7
 * settled that the badge face carries the MXE ID and not the token), so
 * the only inputs are machine-read from a QR and already exact. Adding
 * the mapping would only widen what counts as a valid token in exchange
 * for tolerance nobody needs.
 */
export function normalizeBadgeToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return isValidBadgeToken(normalized) ? normalized : null;
}

/** Reported when the retry budget is exhausted, so callers can tell this apart from a database error. */
export class BadgeTokenExhaustionError extends Error {
  constructor(requested: number, attempts: number) {
    super(
      `Could not generate ${requested} unique badge token(s) in ${attempts} attempts. ` +
        `This should be statistically impossible and almost certainly means the uniqueness check is misreporting.`,
    );
    this.name = "BadgeTokenExhaustionError";
  }
}

/**
 * `count` distinct tokens, none of which already exist.
 *
 * Two different collision problems, handled separately because they have
 * different causes:
 *
 *  - Within the batch being generated right now — handled in memory by
 *    the Set, since a batch of 100 must not contain the same token twice
 *    even before the database is consulted.
 *  - Against tokens already stored — handled by `findTaken`, which the
 *    caller supplies. Injected rather than importing a Supabase client
 *    here so this module stays pure and the retry logic is testable
 *    without a database.
 *
 * `findTaken` is called with the whole candidate list, not one token at
 * a time: a mint of 100 should cost one round trip, not 100.
 *
 * Throws rather than returning fewer tokens than asked for, or reusing
 * one. Failing a mint is strictly better than minting a duplicate — the
 * same call 20260904_mxe_id_sequence.sql made when it deleted the
 * MAX(mxe_id) fallback rather than let it hand out a used ID.
 */
export async function generateUniqueBadgeTokens(
  count: number,
  findTaken: (candidates: string[]) => Promise<Iterable<string>>,
  maxAttempts = 5,
): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`generateUniqueBadgeTokens: count must be a positive integer, got ${count}`);
  }

  const accepted = new Set<string>();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidates = new Set<string>();
    // Generate only the shortfall, and never a candidate we already hold.
    while (candidates.size < count - accepted.size) {
      const candidate = generateBadgeToken();
      if (!accepted.has(candidate)) candidates.add(candidate);
    }

    const taken = new Set(await findTaken([...candidates]));
    for (const candidate of candidates) {
      if (!taken.has(candidate)) accepted.add(candidate);
    }

    if (accepted.size === count) return [...accepted];
  }

  throw new BadgeTokenExhaustionError(count, maxAttempts);
}
