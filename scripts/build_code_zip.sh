#!/bin/sh
# Build the submission archive code.zip at the repository root.
# Excludes the dataset, dependencies, build output, the unmasked audit.db,
# caches, secrets and nested archives (AGENTS.md section 6.9).
set -e
cd "$(dirname "$0")/.."
rm -f code.zip
zip -rq code.zip README.md pytest.ini code evaluation tests docs results scripts web \
  -x 'web/node_modules/*' 'web/.next/*' '*/__pycache__/*' '*/.pytest_cache/*' '*.pyc' \
     '*.zip' '*.env' '*/.env*' '*.DS_Store' 'audit.db*' '*/audit.db*' '*.tmp' \
     'web/next-env.d.ts' 'web/tsconfig.tsbuildinfo'
echo "code.zip: $(unzip -l code.zip | tail -1)"
