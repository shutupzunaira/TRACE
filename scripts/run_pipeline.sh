#!/bin/sh
# Full run: 518 requests -> output.csv (+ audit.db), contract check, sample scoring.
set -e
cd "$(dirname "$0")/.."
PY="${PYTHON:-python3}"
"$PY" code/main.py
"$PY" code/validate_output.py
"$PY" evaluation/main.py
