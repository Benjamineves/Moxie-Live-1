/**
 * Minimal stand-in for a generated Supabase `Database` type, until real
 * generated types are wired in (tracked as a follow-up in the build spec —
 * §9 item 11).
 *
 * Why this exists instead of just leaving the generic unset: `SupabaseClient`
 * defaults `Database` to `any`, but its later type parameters (`SchemaName`,
 * `Schema`) resolve through several layers of conditional types that
 * reference `Database`. TypeScript distributes a *naked* `any` over a
 * conditional type into the union of both branches rather than picking one,
 * and in this SDK version that collapses `.from(table)` row/insert/update
 * types to `never` — confirmed against real tsc output, not assumed. A
 * concrete (if permissive) object type sidesteps that: it isn't `any`
 * itself, so every downstream conditional resolves normally, structurally
 * satisfies Supabase's `GenericSchema` shape (checked against the installed
 * SDK's actual type, not guessed), and every table/view/function still ends
 * up typed `any` for Row/Insert/Update — permissive, but never `never`.
 */
export type PermissiveDatabase = {
  public: {
    Tables: Record<string, { Row: any; Insert: any; Update: any; Relationships: any[] }>;
    Views: Record<string, { Row: any; Relationships: any[] }>;
    Functions: Record<string, { Args: any; Returns: any }>;
  };
};
