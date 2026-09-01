import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-verify";

/**
 * TEMPORARY — delete this route once you've read what you need from it.
 * Do not leave it deployed.
 *
 * Reports presence + first-8-characters-only for each env var below, so
 * you can confirm what's actually set in this deployed environment
 * (Vercel "Secret" type vars show as an empty field with placeholder text
 * in the dashboard either way — no way to distinguish "set" from "unset"
 * from there). Never renders a full value. Same requireAdmin() gate as
 * every other admin page — real server-side enforcement, not a hidden
 * link.
 */
const ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID_BADGE",
  "STRIPE_PRICE_ID_FULL",
  "ADMIN_EMAILS",
  "NEXT_PUBLIC_BASE_URL",
] as const;

export default async function EnvDiagnosticPage() {
  const admin = await requireAdmin();
  if (!admin) {
    redirect("/dashboard");
  }

  const rows = ENV_VARS.map((name) => {
    const value = process.env[name];
    return {
      name,
      present: !!value && value.trim().length > 0,
      prefix: value ? value.slice(0, 8) : null,
    };
  });

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-2xl">
        <header className="mb-6">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--red-fg)]">
            Temporary diagnostic — delete after use
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
            Env var check
          </h1>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            First 8 characters only, never full values.
          </p>
        </header>

        {/* Not one of the requested vars, but Vercel sets this
            automatically and it's not secret — knowing which deployment
            target (production/preview/development) actually served this
            page is essential context for reading the table below. */}
        <div className="mb-6 rounded-xl border border-[var(--divider)] bg-[var(--cream2)] p-4">
          <p className="font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.1em] text-[var(--text3)]">
            Deployment context
          </p>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
            VERCEL_ENV: <span className="font-semibold">{process.env.VERCEL_ENV ?? "(not set — not running on Vercel?)"}</span>
          </p>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
            VERCEL_URL: <span className="font-semibold">{process.env.VERCEL_URL ?? "(not set)"}</span>
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-[var(--divider)] bg-[var(--white)]">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[var(--divider)] bg-[var(--cream2)]">
                <th className="p-3 text-left font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.08em] text-[var(--text3)]">
                  Variable
                </th>
                <th className="p-3 text-left font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.08em] text-[var(--text3)]">
                  Status
                </th>
                <th className="p-3 text-left font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.08em] text-[var(--text3)]">
                  First 8 chars
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-b border-[var(--divider)] last:border-b-0">
                  <td className="p-3 font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">{r.name}</td>
                  <td className="p-3 font-[family-name:var(--font-dm)] text-sm">
                    {r.present ? (
                      <span className="text-[var(--aqua-lagoon)]">Set</span>
                    ) : (
                      <span className="font-semibold text-[var(--red-fg)]">NOT SET</span>
                    )}
                  </td>
                  <td className="p-3 font-mono text-sm text-[var(--text2)]">
                    {r.prefix ? `${r.prefix}…` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
          Prefix reference: Stripe secret/publishable keys should read <code>sk_test_</code> / <code>pk_test_</code>
          right now, not <code>sk_live_</code> / <code>pk_live_</code>.
        </p>
      </main>
    </div>
  );
}
