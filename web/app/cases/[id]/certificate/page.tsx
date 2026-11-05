"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { formatUtc, REPORTED_LABELS, STATUS_META, type CaseDetail, type Step } from "@/lib/types";

// Printable one-page audit certificate. Reads the same API as the case page and changes nothing.

type Load =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error"; message: string }
  | { state: "ok"; data: CaseDetail; fingerprint: string | null };

/** SHA-256 (hex) of the exact JSON text the API returned, computed in the browser. */
async function sha256Hex(text: string): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null; // needs https or localhost
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const numeric = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? Number.MAX_SAFE_INTEGER);

const OP_TEXT: Record<string, string> = {
  DISABLE_DATA_FLOW: "Disable data flow",
  BLOCK_RESTORE: "Block restore",
  DELETE_RECORD: "Delete record",
  REDACT_RECORD: "Redact record",
  ANONYMIZE_RECORD: "Anonymize record",
  VERIFY_RECORD_ABSENT: "Verify record absent",
  VERIFY_RECORD_PRESENT: "Verify record kept",
  VERIFY_RECORD_REDACTED: "Verify record redacted",
  VERIFY_RECORD_ANONYMIZED: "Verify record anonymized",
  VERIFY_DATA_FLOW_DISABLED: "Verify data flow disabled",
  VERIFY_RESTORE_BLOCKED: "Verify restore blocked",
};

const CLASSIFICATION_TEXT: Record<string, string> = {
  IS_DELETION: "Asks for deletion",
  NOT_APPLICABLE: "Not a deletion request",
};

export default function CertificatePage() {
  const { id } = useParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cases/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (res.status === 404) return { state: "missing" } as const;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const fingerprint = await sha256Hex(text).catch(() => null);
        return { state: "ok", data: JSON.parse(text) as CaseDetail, fingerprint } as const;
      })
      .then((l) => !cancelled && setLoad(l))
      .catch((err: Error) => !cancelled && setLoad({ state: "error", message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // The title becomes the default file name in "Save as PDF"
  useEffect(() => {
    document.title = `TRACE audit certificate · ${id}`;
  }, [id]);

  return (
    <main className="certificate-page mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/cases/${encodeURIComponent(id)}`} className="text-sm text-muted hover:text-ink-2">
          ← Back to {id}
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={load.state !== "ok"}
          className="rounded-full border border-white/20 bg-white/[0.08] px-4 py-2 text-sm font-medium text-ink hover:bg-white/[0.14] disabled:opacity-40"
        >
          Print / Save as PDF
        </button>
      </div>

      {load.state === "loading" && <div className="h-[60vh] animate-pulse rounded-lg bg-white/5" aria-busy />}
      {load.state === "missing" && <p className="text-ink-2">There is no case called {id}.</p>}
      {load.state === "error" && (
        <p role="alert" className="text-ink-2">
          Could not load this case ({load.message}).
        </p>
      )}
      {load.state === "ok" && <Certificate c={load.data} fingerprint={load.fingerprint} />}
    </main>
  );
}

function Certificate({ c, fingerprint }: { c: CaseDetail; fingerprint: string | null }) {
  const files = Array.from(new Set(c.evidence_hits.map((h) => h.file_id).filter(Boolean))).sort(
    (a, b) => numeric(a) - numeric(b) || a.localeCompare(b),
  );
  const plan = c.steps.filter((s) => s.phase === "REMEDIATION" || s.phase === "VERIFICATION");
  const findings = c.steps.filter((s) => s.phase === "FINDING").length;
  const verdict = STATUS_META[c.our_status];

  return (
    <article className="certificate rounded-lg bg-white p-6 text-[13px] leading-snug text-neutral-900 shadow-xl sm:p-10">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-neutral-900 pb-3">
        <div>
          <p className="text-2xl font-bold tracking-[0.2em]">TRACE</p>
          <p className="text-xs uppercase tracking-wide text-neutral-500">Deletion audit certificate</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-semibold">{c.case_id}</p>
          <p className="text-xs text-neutral-500">Audit time {formatUtc(c.audit_at)}</p>
        </div>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        <Field label="Email (masked)">
          <span className="break-all font-mono">{c.email}</span>
        </Field>
        <Field label="Requested">{formatUtc(c.requested_at)}</Field>
        <Field label="Audited at">{formatUtc(c.audit_at)}</Field>
      </dl>

      <section className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded border border-neutral-300 p-3">
          <p className="text-[10px] uppercase tracking-wide text-neutral-500">The shop&apos;s claim</p>
          <p className="mt-0.5 text-lg font-semibold">{REPORTED_LABELS[c.reported_status] ?? c.reported_status}</p>
          <p className="text-[11px] text-neutral-500">Reported by the deletion workflow</p>
        </div>
        <div className="rounded border-2 p-3" style={{ borderColor: verdict?.color ?? "#555" }}>
          <p className="text-[10px] uppercase tracking-wide text-neutral-500">TRACE verdict</p>
          <p className="mt-0.5 text-lg font-semibold">{verdict?.label ?? c.our_status}</p>
          <p className="text-[11px] text-neutral-500">
            {c.our_status === "INCOMPLETE"
              ? `${findings} finding${findings === 1 ? "" : "s"} from evidence captured before the audit time`
              : verdict?.hint}
          </p>
        </div>
      </section>

      <Block title="Request decision">
        <p>
          <span className="font-semibold">{CLASSIFICATION_TEXT[c.classification] ?? (c.classification || "—")}</span>
          {c.confidence && <span className="text-neutral-500"> · {c.confidence.toLowerCase()} confidence</span>}
        </p>
        {c.reason && <p className="mt-0.5 text-neutral-700">{c.reason}</p>}
      </Block>

      <Block title={`Evidence files (${files.length})`}>
        {files.length === 0 ? (
          <p className="text-neutral-500">No evidence files were matched to this person.</p>
        ) : (
          <p className="font-mono text-[11px] leading-relaxed">{files.join(" · ")}</p>
        )}
      </Block>

      <Block title={`Remediation and verification (${plan.length})`}>
        {plan.length === 0 ? (
          <p className="text-neutral-500">
            {c.our_status === "NOT_APPLICABLE" ? "No deletion was requested, so no plan applies." : "No steps."}
          </p>
        ) : (
          <PlanTable steps={plan} />
        )}
      </Block>

      <Block title="Fingerprint (SHA-256)">
        <p className="break-all font-mono text-[11px]">
          {fingerprint ?? "Not available: this browser only computes it on https or localhost."}
        </p>
        <p className="mt-1 text-[11px] text-neutral-500">
          SHA-256 of this case&apos;s JSON data, computed in your browser. Any change to the data changes this
          fingerprint.
        </p>
      </Block>

      <footer className="mt-5 border-t border-neutral-300 pt-2 text-[10px] text-neutral-500">
        Generated by TRACE from evidence available at or before the audit time. Identifiers are masked. The
        shop&apos;s status is a claim; the verdict comes from direct evidence.
      </footer>
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 break-inside-avoid">
      <h2 className="mb-1 border-b border-neutral-200 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
        {title}
      </h2>
      {children}
    </section>
  );
}

function PlanTable({ steps }: { steps: Step[] }) {
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr className="text-left text-neutral-500">
          <th className="py-0.5 pr-2 font-medium">#</th>
          <th className="py-0.5 pr-2 font-medium">Phase</th>
          <th className="py-0.5 pr-2 font-medium">Action</th>
          <th className="py-0.5 pr-2 font-medium">System</th>
          <th className="py-0.5 pr-2 font-medium">Resource</th>
          <th className="py-0.5 font-medium">Evidence</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s) => (
          <tr key={s.step_no} className="border-t border-neutral-200 align-top">
            <td className="py-0.5 pr-2 tabular-nums">{s.step_no}</td>
            <td className="py-0.5 pr-2">{s.phase === "REMEDIATION" ? "Fix" : "Check"}</td>
            <td className="py-0.5 pr-2">{OP_TEXT[s.operation] ?? s.operation}</td>
            <td className="py-0.5 pr-2">{s.system_id}</td>
            <td className="py-0.5 pr-2 font-mono">{s.resource_id}</td>
            <td className="py-0.5 font-mono">{s.evidence_id || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
