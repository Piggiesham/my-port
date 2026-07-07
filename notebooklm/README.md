# Local NotebookLM research agent

One-time setup:
1. Install `uv` (needed to provide Python ≥3.10; the package won't run on 3.9):
   `pip3 install --user uv`  — then ensure `uv` is on PATH.
2. `uv tool install --python 3.12 "notebooklm-py[browser]"`
   (the `[browser]` extra bundles Playwright; first login auto-downloads Chromium.)
3. `notebooklm login` — **run this in a real terminal (Terminal.app / iTerm)**, not
   through an editor/agent: it opens a browser for Google sign-in and needs
   interactive control.
4. In NotebookLM, create the notebook and title it exactly `claude:my-port`, and
   add your research sources to it. The agent targets ONLY that title.
   (Override with `NOTEBOOKLM_NAME` if you must.)

Verify auth any time (non-interactive): `notebooklm status` / `notebooklm doctor`.

Monthly loop:
1. `node scripts/refresh-strategy.mjs` — resolves the `claude:my-port` notebook by
   title (halts if missing or duplicated), fills the standing questions with your
   current buckets from `plan.json`, asks each via `notebooklm ask -n <id> --json`
   (grounded answers with source references), and writes them to
   `notebooklm/fetches/`, updating `log.jsonl` and `last-run.json`.
2. Tell Claude: "update my Strategy plan." Claude distills the fetched answers +
   current holdings into `src/data/plan.json`; `validate-plan.mjs` gates the commit
   (every citation must resolve to a fetched file); Claude shows a diff and pushes.

Real CLI reference (v0.7.x): `notebooklm list [--json]`, `notebooklm ask -n <id>
"<question>" --json`, `notebooklm use <id>` (set a default), `notebooklm status`.

Fail-safe:
- Notebook missing / ambiguous → the script HALTS; no notebook is queried and no
  answers are written.
- API broke / not logged in → `last-run.json` shows `failed`; paste answers into
  `notebooklm/fetches/answer-<ts>-qN.md` by hand and continue. The validator still
  enforces that every plan.json citation resolves.

This tooling is LOCAL only — never deployed, never imported by the web app.
