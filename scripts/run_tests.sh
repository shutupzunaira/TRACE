#!/bin/sh
# Whole test suite (pipeline, scanner, policy engine, website data). Needs pytest.
set -e
cd "$(dirname "$0")/.."
"${PYTHON:-python3}" -m pytest -q "$@"
