# Usage Report — final full-dataset run

Run that produced the submitted `output.csv`: `python code/main.py` over the 518 requests in
`dataset/deletion_requests.csv`, re-run on 2026-11-05 (wall time about 9 seconds on a laptop,
including the audit.db write for the website; 0 failed cases). Result: COMPLETE 153, INCOMPLETE 355,
NOT_APPLICABLE 10, byte-identical to the 2026-11-04 run.

## Model usage

The final pipeline makes **no language-model calls**. Every stage is deterministic code:

| Stage | Owner | Technique | Model calls |
|---|---|---|---|
| Request classification | P1 (`request_classifier.py`) | multilingual keyword / pattern rules | 0 |
| Identity resolution | P1 (`identity_resolver.py`) | current snapshot + audit-log roll-back to `audit_at` | 0 |
| Evidence discovery | P2 (`code/evidence/`) | parsers for SQL, JSON, logs, PDF text (pypdf), text; screenshot text from the committed OCR cache (`ocr_mode="cache_only"`) | 0 |
| Policy and evidence validation | P3 (`policy_engine.py`, `rules.py`, `activity.py`) | rule book loaded from `deletion_rules.csv`, evidence-state reconstruction | 0 |
| Step building | `step_builder.py` | numbering and contract validation | 0 |
| Website data (display only) | P1 (`audit_db.py`, `lineage.py`, `case_timeline.py`, `export_web_data.py`) | SQLite + static JSON export, masking | 0 |

Screenshot text was produced earlier by P2 with the local RapidOCR engine (an ONNX OCR model, not
a language model, no API and no tokens) and committed to `code/evidence/ocr_cache/`. The final run
reads that cache only and runs no OCR.

## Totals

| Provider | Model | Calls | Input tokens | Output tokens | Total tokens | Avg tokens / request | Est. cost | Est. cost / request |
|---|---|---|---|---|---|---|---|---|
| — (none) | — | 0 | 0 | 0 | 0 | 0 | $0.00 | $0.00 |
| **Overall** | | **0** | **0** | **0** | **0** | **0** | **$0.00** | **$0.00** |

Requests processed: 518 (508 deletion requests assessed, 10 NOT_APPLICABLE).

Not included above, because it was not part of the pipeline run: the AI coding assistant used to
write the code (Claude Code, `claude-opus-5-5`). The harness exposed no token or cost counters for
those development sessions, so they are not estimated here; the sessions are recorded in the root
`log.txt`.
