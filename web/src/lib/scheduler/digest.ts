import { detailCard, escapeHtml, notice, paragraph, button, renderEmailLayout } from "../email/layout.ts";
import { renderPlainText } from "../email/plain-text.ts";
import { STEP_ORDER, type StepMode, type StepName } from "./config.ts";
import type { Finding } from "./types.ts";

/**
 * THE ADMIN DIGEST (spec §7). One email per run that found something,
 * changed something or didn't finish cleanly. A clean run with nothing to
 * report sends nothing, so an email means something happened.
 *
 * Goes to every role = 'admin' account, directly through sendEmail — not
 * notifyOwner, because a digest is an operational report, not an event on
 * the admin's own account.
 */

export type DigestInput = {
  runId: string;
  status: string;
  trigger: string;
  modes: Record<StepName, StepMode>;
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown>;
  findings: (Finding & { owner_id: string | null })[];
  baseUrl?: string;
};

const STEP_LABEL: Record<StepName | "run", string> = {
  run: "Run",
  tier: "Tier reconciliation",
  no_plan_window: "No-plan window",
  dormancy: "Dormancy",
  reminders: "Expiry reminders",
};

const KIND_LABEL: Record<Finding["kind"], string> = {
  changed: "changed",
  would_change: "would change",
  exempt: "exempt",
  skipped: "skipped",
  failed: "FAILED",
  anomaly: "anomaly",
};

function origin(baseUrl?: string) {
  return (baseUrl ?? process.env.NEXT_PUBLIC_BASE_URL ?? "https://moxieyacht.com").replace(/\/$/, "");
}

function shortId(id: string | null) {
  return id ? `${id.slice(0, 8)}…` : "run";
}

function describe(f: Finding & { owner_id: string | null }): string {
  const d = f.detail ?? {};
  const bits: string[] = [];
  if (typeof d.action === "string") bits.push(d.action);
  if (typeof d.from === "string" || typeof d.to === "string") bits.push(`${d.from ?? "?"} → ${d.to ?? "?"}`);
  if (typeof d.applies === "string") bits.push(`applies ${d.applies}`);
  if (typeof d.deadline === "string") bits.push(`deadline ${d.deadline.slice(0, 10)}`);
  if (typeof d.mxe_id === "string") bits.push(`${d.mxe_id} ${d.doc} expires ${d.expiry_date} (${d.days_remaining} days)`);
  if (typeof d.reason === "string") bits.push(d.reason);
  if (typeof d.error === "string") bits.push(d.error);
  return bits.join(" · ");
}

export function digestNeeded(input: { status: string; findings: Finding[] }): boolean {
  if (input.status !== "succeeded") return true;
  return input.findings.some((f) => f.kind === "would_change" || f.kind === "changed" || f.kind === "anomaly" || f.kind === "failed" || f.kind === "skipped");
}

export function digestSubject(input: Pick<DigestInput, "status" | "findings" | "modes">): string {
  const reportOnly = Object.values(input.modes).every((m) => m === "report");
  const counts = input.findings.filter((f) => f.kind === "would_change" || f.kind === "changed").length;
  const problems = input.findings.filter((f) => f.kind === "failed" || f.kind === "anomaly").length;
  const lead = input.status === "succeeded" ? "Scheduler" : `Scheduler run ${input.status}`;
  return `${lead}: ${counts} finding${counts === 1 ? "" : "s"}${problems ? `, ${problems} problem${problems === 1 ? "" : "s"}` : ""}${reportOnly ? " (report-only)" : ""}`;
}

function grouped(findings: DigestInput["findings"]) {
  const steps: (StepName | "run")[] = ["run", ...STEP_ORDER];
  return steps
    .map((step) => ({ step, items: findings.filter((f) => f.step === step && f.kind !== "exempt") }))
    .filter((g) => g.items.length > 0);
}

export function renderDigestHtml(input: DigestInput): string {
  const reportOnly = Object.values(input.modes).every((m) => m === "report");
  const runUrl = `${origin(input.baseUrl)}/admin/scheduler?run=${encodeURIComponent(input.runId)}`;
  const blocks: string[] = [];

  blocks.push(
    detailCard([
      { label: "Status", value: input.status, emphasis: input.status !== "succeeded" },
      { label: "Trigger", value: input.trigger },
      { label: "Started", value: input.startedAt },
      { label: "Accounts visited", value: String(input.summary.accounts_visited ?? "?") },
      { label: "Not reached", value: String(input.summary.accounts_not_reached ?? 0) },
    ]),
  );

  for (const group of grouped(input.findings)) {
    const lines = group.items
      .map((f) => {
        const note = typeof f.detail?.review_note === "string" ? `<br><em>Known: ${escapeHtml(f.detail.review_note)}</em>` : "";
        return `<li style="margin:0 0 8px;"><strong>${escapeHtml(KIND_LABEL[f.kind])}</strong> · ${escapeHtml(shortId(f.owner_id))} · ${escapeHtml(f.signature ?? "")}<br>${escapeHtml(describe(f))}${note}</li>`;
      })
      .join("");
    blocks.push(paragraph(`<strong>${escapeHtml(STEP_LABEL[group.step])}</strong>`));
    blocks.push(`<ul style="margin:0 0 16px;padding-left:18px;font-size:14px;line-height:1.5;">${lines}</ul>`);
  }

  const breakers = input.summary.breakers as Record<string, { count: number; limit: number; trips: boolean }> | undefined;
  if (breakers && Object.values(breakers).some((b) => b.trips)) {
    blocks.push(notice(escapeHtml(`Circuit breaker would trip: ${Object.entries(breakers).filter(([, b]) => b.trips).map(([k, b]) => `${k} ${b.count} > ${b.limit}`).join("; ")}.`)));
  }

  blocks.push(button(runUrl, "Open this run"));

  return renderEmailLayout({
    subject: digestSubject(input),
    headerLabel: "Scheduler",
    title: reportOnly ? "What the scheduler would do" : "What the scheduler did",
    intro: [
      paragraph(
        escapeHtml(
          reportOnly
            ? "Report-only: nothing below was changed, and no owner was emailed. Each line is what the step would do once it is switched on."
            : "Actions this run took, and anything that needs a look.",
        ),
        { last: true },
      ),
    ],
    blocks,
    footerReason: "Sent to Moxie admins because a scheduler run found something or didn't finish cleanly.",
  });
}

export function renderDigestText(input: DigestInput): string {
  const reportOnly = Object.values(input.modes).every((m) => m === "report");
  const paragraphs: string[] = [
    reportOnly
      ? "Report-only: nothing below was changed, and no owner was emailed. Each line is what the step would do once it is switched on."
      : "Actions this run took, and anything that needs a look.",
  ];
  for (const group of grouped(input.findings)) {
    paragraphs.push(
      `${STEP_LABEL[group.step]}:\n` +
        group.items
          .map((f) => {
            const note = typeof f.detail?.review_note === "string" ? `\n    Known: ${f.detail.review_note}` : "";
            return `  - ${KIND_LABEL[f.kind]} · ${shortId(f.owner_id)} · ${f.signature ?? ""}\n    ${describe(f)}${note}`;
          })
          .join("\n"),
    );
  }
  return renderPlainText({
    title: reportOnly ? "What the scheduler would do" : "What the scheduler did",
    paragraphs,
    details: [
      { label: "Status", value: input.status },
      { label: "Trigger", value: input.trigger },
      { label: "Started", value: input.startedAt },
      { label: "Accounts visited", value: String(input.summary.accounts_visited ?? "?") },
      { label: "Not reached", value: String(input.summary.accounts_not_reached ?? 0) },
    ],
    action: { label: "Open this run", url: `${origin(input.baseUrl)}/admin/scheduler?run=${encodeURIComponent(input.runId)}` },
    footerReason: "Sent to Moxie admins because a scheduler run found something or didn't finish cleanly.",
  });
}
