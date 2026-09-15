import { detailCard, escapeHtml, notice, paragraph, button, renderEmailLayout, EMAIL_COLORS } from "../email/layout.ts";
import { renderPlainText } from "../email/plain-text.ts";
import type { StepMode, StepName } from "./config.ts";
import { brief } from "./describe.ts";
import type { Finding } from "./types.ts";

/**
 * THE ADMIN DIGEST (spec §7). One email per run that found something or
 * didn't finish cleanly; a clean run with nothing to report sends nothing.
 *
 * Built to be read in five seconds: the subject and the first line say
 * whether anything needs a person. Then the things that do, then the things
 * that don't, each a plain sentence naming the account by email and vessels
 * by MXE ID (lib/scheduler/describe.ts). Run details come last.
 *
 * Goes to every role = 'admin' account through sendEmail — not notifyOwner:
 * a digest is an operational report, not an event on the admin's account.
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

const FOOTER = "Sent to Moxie admins because a scheduler run found something or didn't finish cleanly.";

function origin(baseUrl?: string) {
  return (baseUrl ?? process.env.NEXT_PUBLIC_BASE_URL ?? "https://moxieyacht.com").replace(/\/$/, "");
}

function isReportOnly(modes: Record<StepName, StepMode>) {
  return Object.values(modes).every((m) => m === "report");
}

const REPORT_ONLY_LINE = "Report-only: nothing was changed and no owner was emailed. Each line says what would happen once that step is switched on.";

export function digestNeeded(input: { status: string; findings: Finding[] }): boolean {
  if (input.status !== "succeeded") return true;
  return input.findings.some((f) => f.kind === "would_change" || f.kind === "changed" || f.kind === "anomaly" || f.kind === "failed" || f.kind === "skipped");
}

export function digestSubject(input: Pick<DigestInput, "status" | "findings" | "modes" | "summary">): string {
  const b = brief({ findings: input.findings, status: input.status, summary: input.summary });
  const lead = b.needsYou.length === 0 ? "nothing needs you" : `${b.needsYou.length} ${b.needsYou.length === 1 ? "thing needs" : "things need"} you`;
  const rest = b.noAction.length > 0 ? `, ${b.noAction.length} for information` : "";
  return `Moxie scheduler: ${lead}${rest}${isReportOnly(input.modes) ? " (report-only)" : ""}`;
}

function runDetails(input: DigestInput) {
  return [
    { label: "Run", value: input.status },
    { label: "Started", value: `${input.startedAt.replace("T", " ").slice(0, 16)} UTC (${input.trigger})` },
    { label: "Accounts checked", value: String(input.summary.accounts_visited ?? "?") },
  ];
}

export function renderDigestHtml(input: DigestInput): string {
  const b = brief({ findings: input.findings, status: input.status, summary: input.summary });
  const runUrl = `${origin(input.baseUrl)}/admin/scheduler?run=${encodeURIComponent(input.runId)}`;
  const list = (items: string[]) =>
    `<ul style="margin:0 0 20px;padding-left:18px;font-size:15px;line-height:1.55;color:${EMAIL_COLORS.navy};">${items
      .map((t) => `<li style="margin:0 0 10px;">${escapeHtml(t)}</li>`)
      .join("")}</ul>`;

  const blocks: string[] = [];
  if (b.needsYou.length > 0) {
    blocks.push(paragraph("<strong>Needs you</strong>"));
    blocks.push(list(b.needsYou));
  }
  if (b.noAction.length > 0) {
    blocks.push(paragraph("<strong>No action needed</strong>"));
    blocks.push(list(b.noAction));
  }
  if (isReportOnly(input.modes)) blocks.push(notice(escapeHtml(REPORT_ONLY_LINE)));
  blocks.push(button(runUrl, "Open this run"));
  blocks.push(detailCard(runDetails(input)));

  return renderEmailLayout({
    subject: digestSubject(input),
    headerLabel: "Scheduler",
    title: b.headline,
    intro: [],
    blocks,
    footerReason: FOOTER,
  });
}

export function renderDigestText(input: DigestInput): string {
  const b = brief({ findings: input.findings, status: input.status, summary: input.summary });
  const paragraphs: string[] = [];
  if (b.needsYou.length > 0) paragraphs.push(`NEEDS YOU\n${b.needsYou.map((t) => `- ${t}`).join("\n")}`);
  if (b.noAction.length > 0) paragraphs.push(`NO ACTION NEEDED\n${b.noAction.map((t) => `- ${t}`).join("\n")}`);
  if (isReportOnly(input.modes)) paragraphs.push(REPORT_ONLY_LINE);
  return renderPlainText({
    title: b.headline,
    paragraphs,
    details: runDetails(input),
    action: { label: "Open this run", url: `${origin(input.baseUrl)}/admin/scheduler?run=${encodeURIComponent(input.runId)}` },
    footerReason: FOOTER,
  });
}
