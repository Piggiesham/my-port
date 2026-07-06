# Local NotebookLM research agent

One-time setup:
1. `uv tool install notebooklm-py` (or `pipx install notebooklm-py`)
2. `notebooklm login` — authenticates with your Google account (Playwright).
3. In NotebookLM, create the notebook and title it exactly `claude:my-port`.
   The agent targets ONLY that name. (Override with `NOTEBOOKLM_NAME` if needed.)

Monthly loop:
1. `node scripts/refresh-strategy.mjs` — resolves the `claude:my-port` notebook
   by name (halts if missing or duplicated), asks the standing questions, and
   writes grounded answers to `notebooklm/fetches/`, updating `log.jsonl` and
   `last-run.json`.
2. Tell Claude: "update my Strategy plan." Claude distills the fetched answers +
   current holdings into `src/data/plan.json`; `validate-plan.mjs` gates the
   commit (every citation must resolve to a fetched file); Claude shows a diff
   and pushes.

Fail-safe:
- Notebook missing / ambiguous → the script HALTS; nothing changes.
- API broke → `last-run.json` shows `failed`; paste answers into
  `notebooklm/fetches/answer-<ts>-qN.md` by hand and continue. The validator
  still enforces that every plan.json citation resolves.

This tooling is LOCAL only — never deployed, never imported by the web app.
