# results/

Generated outputs that are kept for reference.

| File | Produced by | What it is |
|---|---|---|
| `sample_predictions.csv` | `python evaluation/main.py` | TRACE's answers for the 32 public sample requests, scored against `dataset/sample_output.csv` in `evaluation/evaluation_report.md` |

The submission answer file stays at the repository root: `output.csv` (518 rows), written by
`python code/main.py`. The website's masked data lives in `web/data/` (`python code/export_web_data.py`).
