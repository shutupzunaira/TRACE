# TRACE: Ghost Data Audit

TRACE checks whether a "deleted" customer's personal data is really gone.
For each of 518 deletion requests it decides whether the person actually asked for deletion,
finds every current and past identifier, and searches databases, logs, documents, screenshots and backups.
It then applies `deletion_rules.csv` to every copy it finds, at the case's audit time, ignoring what workflows claim.
The answer is `COMPLETE`, `INCOMPLETE` or `NOT_APPLICABLE`, with an ordered findings → remediation → verification plan, plus a website that explains each case.

## Architecture

```text
deletion_requests.csv
   │
   ├─ 1. Classify          request_classifier.py   rules in 6 languages: does the text authorise deletion?
   │                                              no -> NOT_APPLICABLE, []
   ├─ 2. Resolve identity  identity_resolver.py    current + historical emails, phones, hashes, as of audit_at
   ├─ 3. Find evidence     evidence/ (scanner)     parses all 94 evidence files once; records, links and
   │                       evidence_search.py      absence proofs available at or before audit_at
   ├─ 4. Decide            policy_engine.py        state of every copy at audit_at + deletion_rules.csv
   │                       rules.py, activity.py   -> decision (resources, flows, restore risks)
   │                       step_builder.py         -> numbered FINDING / REMEDIATION / VERIFICATION steps
   │                                              -> output.csv
   └─ 5. Explain           audit_db.py             every case's results -> audit.db (local, unmasked)
                           lineage.py              data-lineage map (display only, activity = claims)
                           case_timeline.py        time-travel timeline (display only)
                           export_web_data.py      audit.db -> masked JSON in web/data/
                           web/                    Next.js site + API routes (Vercel)
```

`code/main.py` runs stages 1–5 and isolates every case: an error in one case writes `INCOMPLETE []`
for that case and the run continues. Stage 5 never changes an answer. Interfaces between stages are
in [`docs/CONTRACTS.md`](docs/CONTRACTS.md); identity and classification are documented in
[`docs/README_identity.md`](docs/README_identity.md).

## Repository layout

```text
code/          the pipeline: main.py (entry point) and every stage; code/evidence/ is the scanner
dataset/       participant data (read-only input; not in code.zip)
docs/          design notes: CONTRACTS.md, README_identity.md, P4_CONTRACT_CONFIRMATION.md, project guide PDF
evaluation/    evaluation_report.md, usage_report.md, main.py (sample scorer)
results/       generated reference outputs (sample_predictions.csv)
scripts/       shortcuts: run_pipeline.sh, run_tests.sh, export_web.sh, build_code_zip.sh
tests/         the whole test suite (pytest, configured by pytest.ini at the root)
web/           Next.js website and API (deployed on Vercel; reads web/data/)
output.csv     the submitted answers (518 rows)     log.txt   agent chat transcript
```

## Setup

Python 3.11+ (developed on 3.12/3.13) and, for the website, Node.js 20.9+. Run every command from
the repository root.

```bash
python -m venv .venv
source .venv/bin/activate              # Windows: .venv\Scripts\activate
pip install pypdf==6.21.4 pytest==9.2.0 Pillow==13.0.0
# optional, only to rebuild the OCR cache: pip install -r code/requirements.txt
```

**`pypdf` is required.** Without it PDF evidence is skipped and at least one answer changes
(`case_33`). No API keys or network access are needed: the pipeline makes no model calls, and
screenshot text comes from the committed OCR cache (`code/evidence/ocr_cache/`). Output is
deterministic.

## Run

```bash
python code/main.py                  # 518 requests -> output.csv (+ audit.db), ~9 s
python code/validate_output.py       # contract check of output.csv; must print VALID
sh scripts/run_pipeline.sh           # the three commands above in one go
python evaluation/main.py            # 32 public samples: run, validate, score -> results/sample_predictions.csv
```

`python code/main.py --requests sample_deletion_requests.csv --output <file>` runs any request
file in `dataset/`; only the default 518-case run writes `audit.db`.

Tests:

```bash
python -m pytest -q                  # whole suite from the repo root (608 passed, 1 skipped)
```

## Website (local)

```bash
python code/main.py && python code/export_web_data.py     # refresh web/data/*.json (masked)
cd web
npm install
npm run dev                                               # http://localhost:3000
```

Pages: **Overview** (status counts, claim vs reality, languages, lie detector by system), **Cases**
(search and filters) and **Case** (verdict banner, request and classifier reason, identity and
identity trail, lineage map with time-travel slider, evidence, decision per record, steps). API
routes: `/api/summary`, `/api/cases?status=&q=`, `/api/cases/[id]`, `/api/lie-detector`.

Privacy: `audit.db` holds unmasked identifiers and is git-ignored. The website only reads
`web/data/`, where emails, phones, names and hashes are masked (also inside free text); a test
fails if any dataset email or phone appears in the export.

## Deploy (Vercel)

Vercel cannot run the Python pipeline, so the site serves the JSON that is committed in `web/data/`.

1. Import the repository in Vercel, **Root Directory** `web`, framework Next.js (defaults for build,
   install and output), Node.js 24.x, no environment variables.
2. `web/next.config.ts` adds `data/**/*.json` to the API functions (`outputFileTracingIncludes`),
   so the data is deployed with them; `web/data/` is outside `public/`, so it is only reachable
   through the API.
3. To publish new results: run `python code/main.py`, then `python code/export_web_data.py`,
   commit `web/data/` and push. Vercel redeploys automatically.

## Extend

**Add an evidence type** (e.g. `.csv` exports):
1. Write a parser in `code/evidence/parsers/` that returns `ObservedRecord`s
   (`code/evidence/models.py`). Set `claim_only=True` for second-hand reports (a system saying
   what it found) and `False` for direct store state.
2. Register its file extension in `_parser_for()` in `code/evidence/parsers/__init__.py`.
3. Add a test in `tests/` with a small real-format file. Nothing else changes: the scanner,
   policy engine and website pick the new records up.

**Add a policy rule:**
1. Add a row to `dataset/deletion_rules.csv` (`rule_id, data_category, condition, required_action`).
2. If the condition uses new wording, add a predicate to `_CONDITION_KINDS` in `code/rules.py`.
   An unrecognised condition raises at start-up instead of being silently ignored.
3. Add a compliant and a non-compliant record for it in `tests/test_policy_engine.py`
   (`test_each_rule_*`).

## Policy engine notes

* Every observation must be timezone-aware, and both its `observed_at` and its file's
  `captured_at` must be at or before `audit_at`. A name-only match is weak and is used only when a
  stable reference confirms it; records that a strong identifier ties to another person are dropped.
* Copies (primary, replica, table) are assessed separately. A copy's state is its latest
  authoritative observation. Ledger claims can show a record or risk still exists, but never prove
  it is gone.
* Absence proofs must be COMPLETE, error-free, for the same system, category, collection and copy,
  not contradicted, and newer than the last sighting.
* Activity is used only for catalog links, observed risks (a connector still enabled, an archive
  still restorable, a job that repopulated data) and workflow attribution. Success messages are
  never accepted as proof.
* Remediation order: disable data flows → block restores → delete → redact → anonymise, each sorted
  by `system_id` then `resource_id`. Verification covers the final state of every relevant resource.

## Evaluation and submission

* Results, custom test cases and the failures fixed: [`evaluation/evaluation_report.md`](evaluation/evaluation_report.md).
  Token and cost usage of the final run (no model calls): [`evaluation/usage_report.md`](evaluation/usage_report.md).
* Challenge contract: [`problem_statement.md`](problem_statement.md); agent rules and logging: [`AGENTS.md`](AGENTS.md).
* Submit `code.zip` (code, README, evaluation reports; no `dataset/`, `node_modules`, `.next`,
  `audit.db`, caches or nested archives), the root `output.csv`, and `log.txt` as the chat transcript:
  https://www.hackerrank.com/contests/hackerrank-orchestrate-october26/challenges/ghost-data-still-exists
