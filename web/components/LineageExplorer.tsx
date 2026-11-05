"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import LineageMap, { type NodeTime } from "@/components/LineageMap";
import {
  eventBasis,
  formatUtc,
  REPORTED_LABELS,
  STATUS_META,
  type Basis,
  type Lineage,
  type TimelineEvent,
} from "@/lib/types";

const STEP_MS = 700; // Play speed: one moment per step

// ---------------------------------------------------------------------------
// "Replay the ghost": plain-English captions for each slider moment
// ---------------------------------------------------------------------------

/** Caption tone: claim = amber, proof = red (data proven present), gone = proof of absence, record = neutral. */
type Tone = "claim" | "proof" | "gone" | "record";

type CaptionLine = { tone: Tone; text: string };

const TONE_STYLE: Record<Tone, { text: string; tag: string; label: string }> = {
  claim: { text: "text-[#e8b43a]", tag: "border-[#e8b43a]/60 text-[#e8b43a]", label: "claim" },
  proof: { text: "text-[#ff6b6b]", tag: "border-[#e5484d]/70 bg-[#e5484d]/10 text-[#ff6b6b]", label: "proof" },
  gone: { text: "text-ink-2", tag: "border-white/25 text-ink-2", label: "proof" },
  record: { text: "text-ink-2", tag: "border-transparent bg-white/[0.06] text-muted", label: "record" },
};

const VERBS: Record<string, string> = {
  DELETE_RECORD: "deleting",
  REDACT_RECORD: "redacting",
  ANONYMIZE_RECORD: "anonymising",
};

/** account_service -> "account", support_platform -> "support" */
function friendly(systemId: string): string {
  const s = systemId.replace(/_(service|platform|system|cluster|store)$/, "").replace(/_/g, " ");
  return s || "unknown";
}

const shortDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One moment's events, told in plain English. Proof/absence events are grouped into one line each. */
function caption(events: TimelineEvent[]): CaptionLine[] {
  const lines: CaptionLine[] = [];
  const present = new Set<string>();
  const gone = new Set<string>();
  let presentAt = -1;
  let goneAt = -1;
  let audit = false;
  for (const e of events) {
    const basis = eventBasis(e);
    const sys = friendly(e.system_id);
    if (e.event === "DELETION_REQUESTED") {
      lines.push({ tone: "record", text: "The person asks the shop to delete their data" });
    } else if (e.event === "AUDIT") {
      audit = true;
    } else if (e.event === "IDENTITY_CHANGE") {
      lines.push({ tone: "record", text: `The person's ${e.resource_id || "identity"} changes (audit log)` });
    } else if (basis === "claim") {
      const result = e.state_after || "no result";
      if (e.event === "EVIDENCE_CLAIM") {
        lines.push({ tone: "claim", text: `A second-hand ledger says the ${sys} copy is ${result}` });
      } else if (VERBS[e.event]) {
        lines.push({
          tone: "claim",
          text:
            result === "SUCCESS"
              ? `The shop reports ${VERBS[e.event]} the ${sys} copy: SUCCESS`
              : `${VERBS[e.event][0].toUpperCase()}${VERBS[e.event].slice(1)} the ${sys} copy ${result}`,
        });
      } else {
        const what = e.event.toLowerCase().replace(/_record$/, "").replace(/_/g, " ");
        lines.push({ tone: "claim", text: `The shop logs “${what}” on the ${sys} copy: ${result}` });
      }
    } else if (basis === "proof" && e.state_after === "PRESENT") {
      if (presentAt < 0) presentAt = lines.push({ tone: "proof", text: "" }) - 1;
      present.add(e.system_id);
    } else if (basis === "proof" && e.state_after === "ABSENT") {
      if (goneAt < 0) goneAt = lines.push({ tone: "gone", text: "" }) - 1;
      gone.add(e.system_id);
    } else if (basis === "proof") {
      lines.push({ tone: "proof", text: `Direct evidence about the ${sys} copy: ${e.state_after || "seen"}` });
    }
  }
  const list = (s: Set<string>) => Array.from(s).map(friendly).join(", ");
  if (presentAt >= 0)
    lines[presentAt].text = `Direct evidence proves the data is still in ${plural(present.size, "system")} (${list(present)})`;
  if (goneAt >= 0)
    lines[goneAt].text = `Direct evidence shows no copy in ${plural(gone.size, "system")} (${list(gone)})`;
  if (audit) lines.push({ tone: "record", text: "Audit time: TRACE decides from the proof, not the claims" });
  return lines;
}

/** How long the replay lingers on a moment: longer when something important happens. */
function dwell(lines: CaptionLine[]): number {
  if (lines.some((l) => l.tone === "claim" || l.tone === "proof")) return 2600;
  if (lines.some((l) => l.tone === "record")) return 1800;
  return 650;
}

/** Boxes the moment's events are about: amber for a claim, red for proof the data is there. */
function pulseFor(lineage: Lineage, events: TimelineEvent[]): Record<string, "claim" | "proof"> {
  const out: Record<string, "claim" | "proof"> = {};
  for (const e of events) {
    if (!e.resource_id) continue;
    const basis = eventBasis(e);
    const kind = basis === "claim" ? "claim" : basis === "proof" && e.state_after === "PRESENT" ? "proof" : null;
    if (!kind) continue;
    const key = `${e.system_id}|${e.resource_id}`.toLowerCase();
    for (const n of lineage.nodes) {
      if (`${n.system_id}|${n.resource_id}`.toLowerCase() !== key) continue;
      if (out[n.id] !== "proof") out[n.id] = kind;
    }
  }
  return out;
}

export type ReplayOutcome = { reported: string; ours: string; exposed: number };

const BASIS_STYLE: Record<Basis, string> = {
  proof: "border-white/30 bg-white/10 text-ink",
  claim: "border-dashed border-white/25 text-ink-2",
  record: "border-transparent bg-white/[0.04] text-muted",
};

function describe(e: TimelineEvent): string {
  const where = [e.system_id, e.resource_id].filter(Boolean).join(" · ");
  switch (e.event) {
    case "IDENTITY_CHANGE":
      return `Identity changed: ${e.resource_id} (${e.evidence_id})`;
    case "DELETION_REQUESTED":
      return "Deletion requested";
    case "AUDIT":
      return "Audit time: the answer is decided here";
    case "EVIDENCE_PROOF":
      return `${e.evidence_id} shows ${where}: ${e.state_after}`;
    case "EVIDENCE_CLAIM":
      return `${e.evidence_id} (second-hand ledger) reports ${where}: ${e.state_after}`;
    case "ABSENCE_PROOF":
      return `${e.evidence_id} snapshot has no ${where}`;
    default: {
      const what = e.event.toLowerCase().replace(/_record$/, "").replace(/_/g, " ");
      return `${what} ${where}${e.state_after ? ` · reported ${e.state_after}` : ""}${
        e.evidence_id ? ` (${e.evidence_id})` : ""
      }`;
    }
  }
}

/** Latest proof (else latest second-hand claim) about each node, up to `at`. */
function nodeStates(lineage: Lineage, events: TimelineEvent[], at: string): Record<string, NodeTime> {
  const latest = new Map<string, { proof?: TimelineEvent; claim?: TimelineEvent }>();
  for (const e of events) {
    if (e.time > at || !e.resource_id) continue;
    const basis = eventBasis(e);
    const isState = e.state_after === "PRESENT" || e.state_after === "ABSENT";
    if (!isState || basis === "record" || e.evidence_id.startsWith("activity_")) continue;
    const key = `${e.system_id}|${e.resource_id}`.toLowerCase();
    const slot = latest.get(key) ?? {};
    if (basis === "proof") slot.proof = e;
    else slot.claim = e;
    latest.set(key, slot);
  }
  const out: Record<string, NodeTime> = {};
  for (const n of lineage.nodes) {
    const slot = latest.get(`${n.system_id}|${n.resource_id}`.toLowerCase());
    const e = slot?.proof ?? slot?.claim;
    out[n.id] = e
      ? {
          state: e.state_after === "PRESENT" ? "present" : "absent",
          basis: slot?.proof ? "proof" : "claim",
          evidence_id: e.evidence_id,
        }
      : { state: "none", basis: null, evidence_id: "" };
  }
  return out;
}

export default function LineageExplorer({
  lineage,
  timeline,
  auditAt,
  replaySignal = 0,
  outcome,
}: {
  lineage: Lineage;
  timeline: TimelineEvent[];
  auditAt: string;
  /** bump to start "Replay the ghost" (from the button at the top of the case page) */
  replaySignal?: number;
  /** what the final replay card says */
  outcome?: ReplayOutcome;
}) {
  // Slider stops: every distinct moment, earliest -> audit_at
  const events = useMemo(
    () => [...timeline].filter((e) => !auditAt || e.time <= auditAt).sort((a, b) => a.time.localeCompare(b.time)),
    [timeline, auditAt],
  );
  const moments = useMemo(() => {
    const times = Array.from(new Set(events.map((e) => e.time)));
    if (auditAt && !times.includes(auditAt)) times.push(auditAt);
    return times.sort();
  }, [events, auditAt]);

  const last = Math.max(0, moments.length - 1);
  const [index, setIndex] = useState(last);
  const [playing, setPlaying] = useState(false);
  const [replayOn, setReplayOn] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => setIndex(last), [last]);

  const at = moments[index] ?? auditAt;
  const nowEvents = useMemo(() => events.filter((e) => e.time === at), [events, at]);
  const lines = useMemo(() => caption(nowEvents), [nowEvents]);

  // One timer for both the plain Play button and the replay; the replay lingers on important moments
  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIndex((i) => Math.min(i + 1, last)), replayOn ? dwell(lines) : STEP_MS);
    return () => clearTimeout(t);
  }, [playing, index, last, replayOn, lines]);

  const startReplay = () => {
    setReplayOn(true);
    setIndex(0);
    setPlaying(true);
  };

  // Started from the button at the top of the page
  useEffect(() => {
    if (!replaySignal) return;
    startReplay();
    root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [replaySignal]);

  const pulse = useMemo(() => (replayOn ? pulseFor(lineage, nowEvents) : undefined), [replayOn, lineage, nowEvents]);
  const finished = replayOn && index >= last && !playing;
  const states = useMemo(() => nodeStates(lineage, events, at), [lineage, events, at]);
  const shown = events.filter((e) => e.time <= at);
  const withProof = lineage.nodes.filter((n) => states[n.id]?.state === "present" && states[n.id]?.basis === "proof");
  const withClaim = lineage.nodes.filter((n) => states[n.id]?.state === "present" && states[n.id]?.basis === "claim");
  const systemsOf = (ns: typeof lineage.nodes) => Array.from(new Set(ns.map((n) => n.system_id)));

  // Keep the newest event in view as the slider moves
  const list = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [at]);

  const play = () => {
    if (index >= last) setIndex(0);
    setPlaying((p) => !p);
  };

  if (lineage.nodes.length === 0 || moments.length === 0) {
    return <LineageMap lineage={lineage} />;
  }

  return (
    <div ref={root} className="scroll-mt-20">
      {replayOn && (
        <div
          className="sticky top-16 z-10 mb-5 rounded-lg border border-white/15 bg-surface/95 p-4 shadow-lg backdrop-blur"
          role="region"
          aria-label="Replay the ghost"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-muted">
              Replaying the ghost · moment {index + 1} of {moments.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => (finished ? startReplay() : setPlaying((p) => !p))}
                className="rounded-md border border-white/15 bg-white/[0.06] px-3 py-1 text-xs text-ink hover:bg-white/10"
              >
                {playing ? "Pause" : finished ? "Play again" : "Resume"}
              </button>
              <button
                type="button"
                onClick={startReplay}
                className="rounded-md border border-white/15 px-3 py-1 text-xs text-ink-2 hover:bg-white/10"
              >
                Restart
              </button>
              <button
                type="button"
                onClick={() => {
                  setReplayOn(false);
                  setPlaying(false);
                }}
                aria-label="Close the replay"
                className="rounded-md px-2 py-1 text-xs text-muted hover:text-ink"
              >
                ✕
              </button>
            </div>
          </div>

          <ul className="mt-3 space-y-1.5" aria-live="polite">
            {lines.length === 0 && <li className="text-sm text-muted">{shortDay(at)} · Nothing new happens</li>}
            {lines.map((l, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-px text-[10px] uppercase tracking-wide ${TONE_STYLE[l.tone].tag}`}>
                  {TONE_STYLE[l.tone].label}
                </span>
                <span className={TONE_STYLE[l.tone].text}>
                  <span className="tabular-nums text-muted">{shortDay(at)} · </span>
                  {l.text}
                  {l.tone !== "record" && <span className="text-muted"> ({TONE_STYLE[l.tone].label})</span>}
                </span>
              </li>
            ))}
          </ul>

          {finished && outcome && (
            <div className="mt-4 rounded-lg border border-white/15 bg-white/[0.04] p-4">
              <p className="text-base text-ink">
                <span className="text-muted">The shop said:</span>{" "}
                <span className="font-semibold text-[#e8b43a]">{outcome.reported}</span>
                <span className="text-muted"> · TRACE found: </span>
                <span className="font-semibold" style={{ color: STATUS_META[outcome.ours]?.color }}>
                  {outcome.ours}
                </span>
                <span className="text-muted"> · </span>
                <span className="font-semibold text-ink">
                  {plural(outcome.exposed, "record")} still exposed
                </span>
              </p>
              <p className="mt-1 text-xs text-muted">
                {REPORTED_LABELS[outcome.reported] ? "The shop's status is a claim; " : ""}TRACE&apos;s verdict comes
                only from evidence captured before the audit time.
              </p>
            </div>
          )}
          <p className="mt-3 text-[11px] text-muted">
            <span className="text-[#e8b43a]">Amber</span> = a claim the shop reported ·{" "}
            <span className="text-[#ff6b6b]">red</span> = direct proof the data is still there. Matching boxes are
            ringed on the map.
          </p>
        </div>
      )}

      <LineageMap lineage={lineage} timeState={states} at={at} pulse={pulse} />

      <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-wide text-muted">Time travel</p>
          <p className="text-sm tabular-nums text-ink" aria-live="polite">
            {formatUtc(at)}
            {at === auditAt && <span className="ml-2 text-xs text-muted">audit time</span>}
          </p>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={play}
            aria-label={playing ? "Pause" : "Play the timeline"}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-ink hover:bg-white/10"
          >
            {playing ? (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><rect x="1" y="1" width="3.5" height="10" fill="currentColor" /><rect x="7.5" y="1" width="3.5" height="10" fill="currentColor" /></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2 1 L11 6 L2 11 Z" fill="currentColor" /></svg>
            )}
          </button>
          <div className="relative flex-1">
            <input
              type="range"
              min={0}
              max={last}
              step={1}
              value={index}
              onChange={(e) => {
                setPlaying(false);
                setIndex(Number(e.target.value));
              }}
              aria-label="Move through the case's timeline"
              aria-valuetext={formatUtc(at)}
              className="w-full accent-[#f0efec]"
            />
          </div>
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted">
          <span>{formatUtc(moments[0])}</span>
          <span>{formatUtc(auditAt || moments[last])}</span>
        </div>

        <p className="mt-3 text-sm text-ink-2">
          At this moment: proof of the person&apos;s data in{" "}
          <span className="font-medium text-ink">{systemsOf(withProof).length}</span> system
          {systemsOf(withProof).length === 1 ? "" : "s"}
          {withProof.length > 0 && <span className="text-muted"> ({systemsOf(withProof).join(", ")})</span>}
          {withClaim.length > 0 && (
            <>
              ; claimed in <span className="font-medium text-ink">{systemsOf(withClaim).length}</span> more
              <span className="text-muted"> ({systemsOf(withClaim).join(", ")})</span>
            </>
          )}
          .
        </p>

        <ol ref={list} className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1 text-xs" aria-label="Events up to this moment">
          {shown.map((e, i) => {
            const basis = eventBasis(e);
            const isNow = e.time === at;
            return (
              <li key={`${e.time}-${e.evidence_id}-${e.resource_id}-${i}`} className={`flex gap-2 ${isNow ? "" : "opacity-70"}`}>
                <span className="w-[8.75rem] shrink-0 whitespace-nowrap tabular-nums text-muted">{formatUtc(e.time)}</span>
                <span className={`h-fit shrink-0 rounded border px-1.5 py-px text-[10px] uppercase tracking-wide ${BASIS_STYLE[basis]}`}>
                  {basis}
                </span>
                <span className="min-w-0 break-words text-ink-2">{describe(e)}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-[11px] text-muted">
          A box lights up when the latest proof up to that moment shows the data (dashed when only a second-hand claim
          says so). Claims come from the shop&apos;s logs and ledgers, proof from direct evidence.
        </p>
      </div>
    </div>
  );
}
