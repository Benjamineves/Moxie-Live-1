import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveOwnerIds, loadOwnedVessel } from "@/lib/vessel-ownership";
import { isShareFieldFlags, type ShareFieldFlags } from "@/lib/share-filter";
import { RevokeButton } from "./RevokeButton";

type ShareRow = {
  id: string;
  label: string | null;
  preset: string | null;
  field_flags: unknown;
  expires_at: string | null;
  one_time: boolean;
  view_count: number;
  last_viewed_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

const TAG_LABELS: Record<keyof ShareFieldFlags, string> = {
  location: "Location",
  contact: "Contact",
  docs: "Documents",
  ownership: "Ownership",
  access: "Access",
};

function tagsFor(flags: unknown): string[] {
  if (!isShareFieldFlags(flags)) return [];
  return (Object.keys(TAG_LABELS) as (keyof ShareFieldFlags)[]).filter((k) => flags[k]).map((k) => TAG_LABELS[k]);
}

function isThisMonth(iso: string): boolean {
  return new Date(iso).getMonth() === new Date().getMonth();
}

function isShareActive(share: { revoked_at: string | null; expires_at: string | null }): boolean {
  if (share.revoked_at) return false;
  if (!share.expires_at) return true;
  return new Date(share.expires_at).getTime() > Date.now();
}

function timeUntil(iso: string | null): string {
  if (!iso) return "No expiry";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours < 24) return `Expires in ${hours}h`;
  const days = Math.round(hours / 24);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

type Props = { params: Promise<{ mxeId: string }> };

export default async function ActiveSharesPage({ params }: Props) {
  const { mxeId } = await params;

  const authClient = await createSupabaseServerClient();
  if (!authClient) redirect(`/login?next=/dashboard/${encodeURIComponent(mxeId)}/shares`);

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) redirect(`/login?next=/dashboard/${encodeURIComponent(mxeId)}/shares`);

  const service = createSupabaseServiceClient();
  if (!service) redirect("/dashboard");

  const vessel = await loadOwnedVessel(service, mxeId, ownerIds);
  if (!vessel) redirect("/dashboard");

  const { data: rows } = await service
    .from("vessel_shares")
    .select("id, label, preset, field_flags, expires_at, one_time, view_count, last_viewed_at, revoked_at, created_at")
    .eq("vessel_id", vessel.id)
    .order("created_at", { ascending: false });

  const shares = (rows ?? []) as ShareRow[];
  const active = shares.filter(isShareActive);
  const inactive = shares.filter((s) => !isShareActive(s));
  const viewedThisMonth = shares
    .filter((s) => s.last_viewed_at && isThisMonth(s.last_viewed_at))
    .reduce((sum, s) => sum + s.view_count, 0);

  return (
    <div className="min-h-screen bg-[var(--cream)] pb-16">
      <header className="border-b-[3px] border-[var(--gold)] bg-[var(--navy-deep)] px-5 pb-6 pt-7">
        <div className="mx-auto max-w-lg">
          <p className="font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.2em] text-[rgba(255,255,255,.4)]">
            {mxeId.toUpperCase()}
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light text-white">
            Active <em className="text-[var(--gold)] not-italic">Shares</em>
          </h1>
          <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-[rgba(255,255,255,.08)]">
            <div className="bg-[var(--navy-deep)] p-3.5">
              <p className="font-[family-name:var(--font-display)] text-2xl font-light text-[var(--aqua-bright)]">
                {active.length}
              </p>
              <p className="font-[family-name:var(--font-dm)] text-[9px] uppercase tracking-[0.1em] text-[rgba(255,255,255,.35)]">
                Active links
              </p>
            </div>
            <div className="bg-[var(--navy-deep)] p-3.5">
              <p className="font-[family-name:var(--font-display)] text-2xl font-light text-[var(--gold)]">
                {viewedThisMonth}
              </p>
              <p className="font-[family-name:var(--font-dm)] text-[9px] uppercase tracking-[0.1em] text-[rgba(255,255,255,.35)]">
                Views this month
              </p>
            </div>
            <div className="bg-[var(--navy-deep)] p-3.5">
              <p className="font-[family-name:var(--font-display)] text-2xl font-light text-[rgba(255,255,255,.4)]">
                {inactive.length}
              </p>
              <p className="font-[family-name:var(--font-dm)] text-[9px] uppercase tracking-[0.1em] text-[rgba(255,255,255,.35)]">
                Expired / revoked
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-5">
        <Link
          href={`/${encodeURIComponent(mxeId.toUpperCase())}?role=owner`}
          className="mt-4 block w-full bg-[var(--navy)] py-3.5 text-center font-[family-name:var(--font-dm)] text-xs font-bold uppercase tracking-[0.14em] text-[var(--gold)] transition hover:bg-[var(--navy2)]"
        >
          Back to profile to share
        </Link>

        <p className="mb-2 mt-8 font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.2em] text-[var(--text3)]">
          Active · {active.length} link{active.length === 1 ? "" : "s"}
        </p>
        {active.length === 0 ? (
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-6 text-center">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              No active shares yet — use the Share button on your vessel profile.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--divider)] bg-[var(--white)]">
            {active.map((share) => (
              <div key={share.id} className="flex items-start gap-3.5 border-b border-[var(--divider)] p-4 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
                    {share.label || "Trusted contact"}
                  </p>
                  <p className="mt-0.5 font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
                    Created {new Date(share.created_at).toLocaleDateString()} · {share.view_count} view
                    {share.view_count === 1 ? "" : "s"}
                    {share.last_viewed_at ? ` · last viewed ${new Date(share.last_viewed_at).toLocaleDateString()}` : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {tagsFor(share.field_flags).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-lg bg-[var(--blue-bg)] px-2 py-0.5 font-[family-name:var(--font-dm)] text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--blue-fg)]"
                      >
                        {tag}
                      </span>
                    ))}
                    {share.one_time ? (
                      <span className="rounded-lg bg-[var(--amber-bg)] px-2 py-0.5 font-[family-name:var(--font-dm)] text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--amber-fg)]">
                        One-time
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <RevokeButton mxeId={mxeId.toUpperCase()} shareId={share.id} />
                  <p className="font-[family-name:var(--font-dm)] text-[10px] text-[var(--text3)]">
                    {timeUntil(share.expires_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {inactive.length > 0 ? (
          <>
            <p className="mb-2 mt-8 font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.2em] text-[var(--text3)]">
              Expired / revoked
            </p>
            <div className="overflow-hidden rounded-xl border border-[var(--divider)] bg-[var(--white)] opacity-60">
              {inactive.map((share) => (
                <div key={share.id} className="flex items-start gap-3.5 border-b border-[var(--divider)] p-4 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
                      {share.label || "Trusted contact"}
                    </p>
                    <p className="mt-0.5 font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
                      {share.revoked_at ? "Revoked" : "Expired"} · {share.view_count} view{share.view_count === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
