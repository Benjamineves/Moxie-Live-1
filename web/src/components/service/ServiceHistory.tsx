import {
  attachmentSummary,
  groupByCategory,
  loggingPattern,
  wasEditedAfterLogging,
  type ServiceRecord,
} from "@/lib/service-records";

/**
 * The service history, read-only. Used by the owner's own page and by
 * anyone the owner shows the vessel to.
 *
 * A HISTORY, NOT A DOCUMENT LIST. Grouped by category, newest first
 * within each group, every entry showing both dates. What a reader is
 * looking for is cadence — how often the bottom gets cleaned, when the
 * engine was last touched — and a flat list of files cannot show that.
 *
 * FILES ARE NEVER RENDERED HERE. Not gated, absent: the component takes no
 * file path and has no way to link to one. The owner's own page renders
 * its own download control alongside. What a reader gets instead is the
 * count — "14 of 22 entries have documents" — which is enough to ask about
 * three specific entries rather than making a blanket request.
 */

const label = "font-[family-name:var(--font-dm)] text-[11px] uppercase tracking-[0.14em] text-[var(--text3)]";
const body = "font-[family-name:var(--font-dm)] text-sm font-light leading-relaxed text-[var(--text2)]";

function formatDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function ServiceHistory({
  records,
  now,
  emptyNote,
  children,
}: {
  records: ServiceRecord[];
  /** Passed in rather than read, so a server render is deterministic. */
  now: Date;
  emptyNote?: string;
  /** Per-entry controls the owner's page supplies; absent for every other reader. */
  children?: (record: ServiceRecord) => React.ReactNode;
}) {
  const groups = groupByCategory(records);
  const summary = attachmentSummary(records);
  const pattern = loggingPattern(records, now);

  if (records.length === 0) {
    return (
      <p className={body}>
        {emptyNote ?? "No service records yet. Entries you add here stay with the boat when it's sold."}
      </p>
    );
  }

  return (
    <div>
      <div className="mb-6 rounded-xl border border-[var(--divider)] bg-[var(--white)] px-5 py-4">
        <p className="font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--navy)]">{summary.text}</p>
        {/*
          The logging pattern, stated plainly. It verifies nothing about
          whether the work happened — nothing can, short of ringing the
          yard — only when each entry was written down, which is the one
          thing the owner could not choose.
        */}
        <p className={`mt-1 ${body}`}>{pattern.text}</p>
      </div>

      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.category}>
            <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-[var(--divider)] pb-2">
              <h3 className={label}>{group.label}</h3>
              <p className="font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
                {group.records.length} {group.records.length === 1 ? "entry" : "entries"}
                {group.withFile > 0 ? ` · ${group.withFile} with a document` : null}
              </p>
            </div>

            <ul className="flex flex-col gap-4">
              {group.records.map((r) => (
                <li key={r.id} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
                      {formatDate(r.service_date)}
                    </span>
                    {r.file_was_attached ? (
                      <span
                        className="rounded-full bg-[var(--gray-bg)] px-2 py-0.5 font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text3)]"
                        title="This entry has a supporting document"
                      >
                        Document
                      </span>
                    ) : null}
                  </div>
                  <p className={body}>{r.description}</p>
                  {r.provider ? <p className={`${body} italic`}>{r.provider}</p> : null}
                  {/*
                    Both dates, always. The service date is the owner's
                    claim; the logged date is ours, and it is the half a
                    seller cannot arrange after the fact.
                  */}
                  <p className="font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
                    Serviced {formatDate(r.service_date)} · Logged {formatDate(r.logged_at)}
                    {/*
                      Only when it differs. Editing stays allowed and
                      logged_at still cannot move, so the cadence argument
                      holds — but an entry's text can change after someone
                      has read it, and showing the edit date is what stops
                      that being silent.
                    */}
                    {wasEditedAfterLogging(r) ? <> · Edited {formatDate(r.updated_at)}</> : null}
                  </p>
                  {children ? <div className="mt-1">{children(r)}</div> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * Why a reader cannot open the seller's documents from here. Shown to
 * everyone who is not the owner, rather than leaving them to discover it
 * by looking for a link that does not exist.
 */
export function AttachmentPolicyNote() {
  return (
    <div className="mt-8 rounded-xl border border-[var(--divider)] bg-[var(--cream2)] px-5 py-4">
      <p className={body}>
        The history stays with the boat. The documents behind it belong to whoever uploaded them, so they are not
        handed over automatically — an invoice can carry a name, an address or a price the seller did not intend to
        pass on. Ask them directly for the entries you care about; Moxie does not sit in the middle of that.
      </p>
    </div>
  );
}
