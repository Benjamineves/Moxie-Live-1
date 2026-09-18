import type { Metadata } from "next";
import Link from "next/link";
import { requireSupabaseServerClient } from "@/lib/supabase/server";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveOwnerIds } from "@/lib/vessel-ownership";
import { formatJoinCode, loadMarinaByJoinCode, loadVesselMarinaAccess, normalizeJoinCode } from "@/lib/marina-access";
import { ShareWithMarinaForm, type JoinVessel } from "./ShareWithMarinaForm";

export const metadata: Metadata = { title: "Share with your marina · Moxie" };

/**
 * A tenant enters their marina's code — from the poster in the office, or
 * by scanning its QR, which lands here with ?code= filled in.
 * docs/moxie_digital_marina_access_spec.md §3.
 *
 * Same shape as /transfer/accept: resolve server-side, preview before any
 * write, round-trip through sign-in, then confirm with a button whose
 * server action the RPC re-verifies.
 *
 * THE MARINA'S NAME IS THE OWNER'S ONLY CHECK. There is no verification
 * of marinas (spec §2.1); what protects an owner who mistypes a code is
 * seeing the wrong name before they confirm. So the name is the first and
 * largest thing on the page, it is shown before sign-in as well as after,
 * and nothing can be granted from a screen that doesn't show it.
 */

type Props = { searchParams: Promise<{ code?: string }> };

const shell = "min-h-screen bg-[var(--cream)] px-4 py-8";
const eyebrow = "font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]";
const body = "font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]";

function CodeEntry({ defaultValue, error }: { defaultValue?: string; error?: string }) {
  return (
    <form method="get" action="/marina/join" className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      <label className="block font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--navy)]" htmlFor="code">
        Marina code
      </label>
      <p className={`mt-1 ${body}`}>Eight characters, on the Moxie poster in your marina&apos;s office.</p>
      <input
        id="code"
        name="code"
        defaultValue={defaultValue}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="XXXX-XXXX"
        className="mt-3 w-full rounded-lg border border-[var(--divider)] bg-[var(--white)] px-3 py-2.5 font-mono text-lg uppercase tracking-[0.15em] text-[var(--navy)]"
      />
      {error ? <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}
      <button
        type="submit"
        className="mt-4 w-full rounded-lg bg-[var(--navy)] py-3 font-[family-name:var(--font-dm)] text-xs font-bold uppercase tracking-[0.14em] text-[var(--gold)]"
      >
        Find my marina
      </button>
    </form>
  );
}

export default async function MarinaJoinPage({ searchParams }: Props) {
  const sp = await searchParams;
  const typed = sp.code?.trim() ?? "";

  if (!typed) {
    return (
      <div className={shell}>
        <main className="mx-auto w-full max-w-md space-y-5">
          <header>
            <p className={eyebrow}>Share with your marina</p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
              Enter your marina&apos;s code.
            </h1>
          </header>
          <CodeEntry />
        </main>
      </div>
    );
  }

  const service = requireSupabaseServiceClient("app/marina/join/page");
  const marina = await loadMarinaByJoinCode(service, typed);

  if (!marina) {
    return (
      <div className={shell}>
        <main className="mx-auto w-full max-w-md space-y-5">
          <header>
            <p className={eyebrow}>Share with your marina</p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
              Enter your marina&apos;s code.
            </h1>
          </header>
          <CodeEntry
            defaultValue={typed}
            error={
              normalizeJoinCode(typed)
                ? "That code doesn't match a marina on Moxie. Check the poster, or ask the marina office."
                : "Marina codes are eight letters and numbers, like 7TJY-KFTK. Check the poster and try again."
            }
          />
        </main>
      </div>
    );
  }

  const code = normalizeJoinCode(typed)!;
  const nextPath = `/marina/join?code=${formatJoinCode(code)}`;

  const authClient = await requireSupabaseServerClient("app/marina/join/page");
  const { user, ownerIds } = await resolveOwnerIds(authClient);

  let vessels: JoinVessel[] = [];
  if (user) {
    const { data, error } = await service
      .from("vessels")
      .select("id, mxe_id, vessel_name, qr_status, lifecycle_status, doc_registration_url, doc_insurance_url")
      .in("owner_id", ownerIds)
      .order("vessel_name");
    if (error) throw new Error(`Failed to load vessels: ${error.message}`);
    const rows = (data ?? []) as {
      id: string;
      mxe_id: string;
      vessel_name: string;
      qr_status: string | null;
      lifecycle_status: string | null;
      doc_registration_url: string | null;
      doc_insurance_url: string | null;
    }[];
    // Decommissioned vessels are retired; there is nothing to share.
    const listed = rows.filter((r) => r.lifecycle_status !== "decommissioned");
    const existing = await loadVesselMarinaAccess(
      service,
      listed.map((r) => r.id),
    );
    vessels = listed.map((r) => {
      const grant = existing.find((g) => g.vessel_id === r.id && g.marina_id === marina.id) ?? null;
      return {
        mxeId: r.mxe_id,
        name: r.vessel_name,
        // Same test grant_marina_access applies (MX032); showing it here
        // just saves a round trip to be told no.
        eligible: r.qr_status === "active" && r.lifecycle_status === "active",
        hasRegistration: !!r.doc_registration_url,
        hasInsurance: !!r.doc_insurance_url,
        existing: grant ? { share_registration: grant.share_registration, share_insurance: grant.share_insurance } : null,
      };
    });
  }

  return (
    <div className={shell}>
      <main className="mx-auto w-full max-w-md space-y-5">
        <header className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <p className={eyebrow}>You&apos;re sharing with</p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">{marina.name}</h1>
          {marina.city ? <p className={`mt-0.5 ${body}`}>{marina.city}</p> : null}
          <p className={`mt-3 ${body}`}>
            Not your marina?{" "}
            <Link href="/marina/join" className="text-[var(--gold-deep)] underline underline-offset-2">
              Check the code and enter it again
            </Link>
            . Code {formatJoinCode(code)}.
          </p>
        </header>

        {!user ? (
          <div className="rounded-xl border border-[var(--gold-line)] bg-[var(--gold-dim)] p-5 text-center">
            <p className="font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--navy)]">
              Sign in to choose which vessel to share.
            </p>
            <div className="mt-4 flex justify-center gap-3">
              <Link
                href={`/login?next=${encodeURIComponent(nextPath)}`}
                className="rounded-lg bg-[var(--navy-deep)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--gold)]"
              >
                Sign in
              </Link>
              <Link
                href={`/signup?next=${encodeURIComponent(nextPath)}`}
                className="rounded-lg border border-[var(--divider)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm text-[var(--text)]"
              >
                Create account
              </Link>
            </div>
          </div>
        ) : vessels.length === 0 ? (
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5">
            <p className={body}>
              You don&apos;t have a vessel on Moxie to share yet.{" "}
              <Link href="/dashboard" className="text-[var(--gold-deep)] underline underline-offset-2">
                Go to your dashboard
              </Link>
              .
            </p>
          </div>
        ) : (
          <ShareWithMarinaForm joinCode={code} marinaName={marina.name} vessels={vessels} />
        )}
      </main>
    </div>
  );
}
