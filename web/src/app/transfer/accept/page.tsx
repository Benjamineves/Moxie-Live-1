import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { hashShareToken } from "@/lib/share-token";
import { AcceptTransferButton } from "./AcceptTransferButton";

type Props = {
  searchParams: Promise<{ token?: string }>;
};

type TransferRow = {
  id: string;
  mxe_id: string;
  buyer_email: string;
  status: string;
  expires_at: string;
};

type VesselPreview = {
  vessel_name: string;
  make: string;
  model: string;
  year: number;
  photo_url: string | null;
};

function TerminalMessage({ headline, body }: { headline: string; body: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--cream)] px-6 text-center">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
        {headline}
      </h1>
      <p className="max-w-sm font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">{body}</p>
      <Link href="/dashboard" className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--blue-fg)] underline">
        Go to your dashboard
      </Link>
    </div>
  );
}

export default async function AcceptTransferPage({ searchParams }: Props) {
  const sp = await searchParams;
  const token = sp.token?.trim();

  if (!token) {
    return (
      <TerminalMessage
        headline="Link not active."
        body="This transfer link is missing or malformed. Ask the seller to resend it."
      />
    );
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return <TerminalMessage headline="Not available." body="This page isn't configured correctly right now." />;
  }

  const { data: transferRow } = await service
    .from("ownership_transfers")
    .select("id, mxe_id, buyer_email, status, expires_at")
    .eq("token_hash", hashShareToken(token))
    .maybeSingle();
  let transfer = transferRow as TransferRow | null;

  if (!transfer) {
    return (
      <TerminalMessage
        headline="Link not active."
        body="This transfer link doesn't match an active transfer. It may have been mistyped, or the transfer was canceled."
      />
    );
  }

  // Lazy expiry check — no cron job in this app; the deadline is
  // evaluated whenever the link is actually opened, same approach as
  // every other read path that touches this table.
  if (transfer.status === "pending" && new Date(transfer.expires_at) < new Date()) {
    await service
      .from("ownership_transfers")
      .update({ status: "expired", expired_at: new Date().toISOString() })
      .eq("id", transfer.id)
      .eq("status", "pending");
    transfer = { ...transfer, status: "expired" };
  }

  if (transfer.status === "expired") {
    return (
      <TerminalMessage
        headline="Link expired."
        body="This transfer link is no longer active. Ask the seller to send a new one."
      />
    );
  }
  if (transfer.status === "canceled") {
    return (
      <TerminalMessage headline="Transfer canceled." body="The seller canceled this transfer before it was accepted." />
    );
  }
  if (transfer.status === "reversed") {
    return (
      <TerminalMessage headline="Transfer reversed." body="This transfer was completed and later reversed by Moxie." />
    );
  }
  if (transfer.status === "awaiting_payment") {
    return (
      <TerminalMessage
        headline="Already accepted."
        body={`You've already accepted ${transfer.mxe_id} — it'll appear in your account once the seller completes the transfer fee payment.`}
      />
    );
  }
  if (transfer.status === "completed") {
    return <TerminalMessage headline="Already transferred." body={`${transfer.mxe_id} has already changed owners.`} />;
  }

  // status === 'pending' from here down.
  const { data: vesselRow } = await service
    .from("vessels")
    .select("vessel_name, make, model, year, photo_url")
    .eq("mxe_id", transfer.mxe_id)
    .maybeSingle();
  const vessel = vesselRow as VesselPreview | null;

  const authClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = authClient ? await authClient.auth.getUser() : { data: { user: null } };
  const signedInEmail = user?.email?.trim().toLowerCase() ?? null;
  const nextPath = `/transfer/accept?token=${encodeURIComponent(token)}`;

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8">
      <main className="mx-auto w-full max-w-xl">
        <header className="mb-6">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
            Ownership transfer
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
            You&apos;re being offered <em className="text-[var(--gold)] not-italic">{transfer.mxe_id}.</em>
          </h1>
          {vessel ? (
            <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              {vessel.vessel_name} — {vessel.year} {vessel.make} {vessel.model}
            </p>
          ) : null}
        </header>

        {vessel?.photo_url?.startsWith("http") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={vessel.photo_url}
            alt={vessel.vessel_name}
            className="mb-6 aspect-[16/10] w-full rounded-xl object-cover"
          />
        ) : null}

        <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            Accepting transfers the vessel&apos;s identity, title history, and USCG documentation to your account.
            Your own contact info, storage details, and documents start blank — you&apos;ll fill those in after.
          </p>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
            The transfer fee is charged to the seller once you accept — nothing is charged to you.
          </p>
        </div>

        <div className="mt-6">
          {signedInEmail === transfer.buyer_email ? (
            <AcceptTransferButton transferId={transfer.id} />
          ) : (
            <div className="rounded-xl border border-[var(--gold-line)] bg-[var(--gold-dim)] p-5 text-center">
              <p className="font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--navy)]">
                Sign in as {transfer.buyer_email} to accept this transfer.
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
          )}
        </div>
      </main>
    </div>
  );
}
