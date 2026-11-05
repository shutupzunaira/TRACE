import { formatDay, type TrailEntry } from "@/lib/types";

/** Request email -> older / newer emails, with the audit-log change between each. */
export default function IdentityTrail({ trail }: { trail: TrailEntry[] }) {
  if (trail.length === 0) return null;
  // Different addresses can look the same once masked (ja****@outlook.com twice).
  // Then number them, so nobody reads the trail as one email.
  const lookAlike = new Set(trail.map((t) => t.value)).size < trail.length;

  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">Identity trail</p>
      <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-3" aria-label="Email history, oldest first">
        {trail.map((t, i) => (
          <li key={`${t.value}-${i}`} className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex flex-col rounded-lg border px-3 py-1.5 ${
                t.is_current ? "border-white/20 bg-white/[0.06]" : "border-dashed border-white/20"
              }`}
            >
              {lookAlike && (
                <span className="text-[11px] font-medium text-ink-2">
                  Email {i + 1}
                  {t.is_current ? " (current)" : ""}
                </span>
              )}
              <span className="font-mono text-sm text-ink">{t.value}</span>
              <span className="text-[11px] text-muted">
                {[t.is_request && "request email", !lookAlike && (t.is_current ? "current" : "older email")]
                  .filter(Boolean)
                  .join(" · ") || (t.is_current ? "" : "older email")}
              </span>
            </span>
            {t.replaced_by && (
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                <span aria-hidden className="text-muted">→</span>
                <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono">{t.replaced_by.audit_id}</span>
                <span className="text-muted">{formatDay(t.replaced_by.changed_at)}</span>
                <span aria-hidden className="text-muted">→</span>
              </span>
            )}
          </li>
        ))}
      </ol>
      {lookAlike && (
        <p className="mt-2 text-xs text-muted">
          These are different addresses; they only look the same because they are masked.
        </p>
      )}
      {trail.length === 1 && (
        <p className="mt-2 text-xs text-muted">No email changes were recorded before the audit time.</p>
      )}
    </div>
  );
}
