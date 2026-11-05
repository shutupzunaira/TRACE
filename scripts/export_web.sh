#!/bin/sh
# Refresh the website data: audit.db -> masked JSON in web/data/ (run the pipeline first).
set -e
cd "$(dirname "$0")/.."
"${PYTHON:-python3}" code/export_web_data.py
