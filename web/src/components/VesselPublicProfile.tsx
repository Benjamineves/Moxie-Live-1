export type PublicProfileProps = {
  mxe_id: string;
  vessel_name: string;
  vessel_type: string | null;
  make: string;
  model: string;
  year: number;
  length_ft: number | string | null;
  draft_ft: number | string | null;
  public_notes: string | null;
  photo_url: string | null;
  storage_type: string | null;
  storage_description: string | null;
  storage_state: string | null;
  storage_city: string | null;
  marina_name: string | null;
  marina_city: string | null;
};

const STORAGE_TYPE_LABELS: Record<string, string> = {
  trailer: "Trailer",
  home: "Home / Driveway",
  yard: "Boatyard / Storage",
  other: "Other storage",
};

export function VesselPublicProfile(props: PublicProfileProps & { hideFooter?: boolean }) {
  const {
    mxe_id,
    vessel_name,
    vessel_type,
    make,
    model,
    year,
    length_ft,
    draft_ft,
    public_notes,
    photo_url,
    storage_type,
    storage_description,
    storage_state,
    storage_city,
    marina_name,
    marina_city,
    hideFooter,
  } = props;

  // Prefer the structured city/state captured at intake; fall back to
  // the legacy combined marina_city string for rows registered before
  // those columns existed, so older vessels keep rendering normally.
  const locationLine =
    [storage_city, storage_state].filter(Boolean).join(", ") || marina_city || null;

  // marina + mooring share the "Home Marina" render (same grouping the
  // intake form's storage-type pill uses); trailer/home/yard/other get the
  // generic "Storage" render with a type label + free-text description.
  const isMarinaStorage = storage_type == null || storage_type === "marina" || storage_type === "mooring";
  const marinaLine =
    isMarinaStorage && (marina_name || locationLine)
      ? [marina_name, locationLine].filter(Boolean).join(" · ")
      : null;
  const storageLabel = !isMarinaStorage ? STORAGE_TYPE_LABELS[storage_type ?? ""] ?? "Storage" : null;

  return (
    <article className="mx-auto max-w-lg px-5 pb-16 pt-10 md:px-8">
      <header className="mb-8 border-b border-[var(--divider)] pb-6">
        <p className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--text3)]">
          Registered vessel
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-light italic text-[var(--navy)] md:text-[2.75rem]">
          {vessel_name}
        </h1>
        <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          {make} {model} · {year}
          {vessel_type
            ? ` · ${vessel_type.charAt(0).toUpperCase()}${vessel_type.slice(1).toLowerCase()}`
            : ""}
        </p>
        <p className="mt-4 inline-flex rounded-full bg-[var(--gray-bg)] px-3 py-1 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--gray-fg)]">
          Public view · {mxe_id}
        </p>
      </header>

      <div className="relative mb-8 overflow-hidden rounded-2xl bg-[var(--navy-deep)] shadow-[0_24px_48px_rgba(13,31,53,.12)]">
        <div className="aspect-[16/10] w-full">
          {photo_url?.startsWith("http") ? (
            // eslint-disable-next-line @next/next/no-img-element -- dynamic Supabase / external URLs
            <img src={photo_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 bg-gradient-to-br from-[var(--navy-deep)] via-[var(--navy2)] to-[var(--navy)] px-8 text-center">
              <span className="font-[family-name:var(--font-display)] text-2xl font-light italic text-[var(--gold)]">
                {make}
              </span>
              <span className="font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.2em] text-[rgba(255,255,255,.45)]">
                Photo pending upload
              </span>
            </div>
          )}
        </div>
      </div>

      <dl className="grid gap-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
        <div className="flex justify-between gap-4 border-b border-[var(--divider)] pb-3">
          <dt className="font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.12em] text-[var(--text3)]">
            Length
          </dt>
          <dd className="font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">
            {length_ft != null ? `${length_ft} ft` : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-[var(--divider)] pb-3">
          <dt className="font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.12em] text-[var(--text3)]">
            Draft
          </dt>
          <dd className="font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">
            {draft_ft != null ? `${draft_ft} ft` : "—"}
          </dd>
        </div>
        {marinaLine ? (
          <div className="flex justify-between gap-4 border-b border-[var(--divider)] pb-3">
            <dt className="font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.12em] text-[var(--text3)]">
              Home Marina
            </dt>
            <dd className="text-right font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">
              {marinaLine}
            </dd>
          </div>
        ) : null}
        {storageLabel ? (
          <div className="flex justify-between gap-4 border-b border-[var(--divider)] pb-3">
            <dt className="font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.12em] text-[var(--text3)]">
              Storage
            </dt>
            <dd className="text-right font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">
              {[storageLabel, storage_description, locationLine].filter(Boolean).join(" · ")}
            </dd>
          </div>
        ) : null}
      </dl>

      {public_notes ? (
        <section className="mt-8 border-l-2 border-[var(--gold-line)] pl-4">
          <h2 className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text3)]">
            About this vessel
          </h2>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-sm font-light leading-relaxed text-[var(--text2)]">
            {public_notes}
          </p>
        </section>
      ) : null}

      {!hideFooter ? (
        <footer className="mt-12 border-t border-[var(--divider)] pt-8 text-center">
          <p className="font-[family-name:var(--font-display)] text-lg italic text-[var(--navy)]">
            <span className="text-[var(--gold)]">M</span>oxie
          </p>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
            Marine vessel registry profile
          </p>
        </footer>
      ) : null}
    </article>
  );
}
