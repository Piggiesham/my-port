#!/usr/bin/env node
// Wrapper around the notebooklm-py CLI (v0.7.x). Resolves the target notebook
// BY EXACT TITLE (fail-safe: halt on 0 or 2+ matches), then asks each standing
// question against THAT notebook with `ask -n <id> --json` (grounded answer
// with source references) and writes the results to notebooklm/fetches/.
// Local only — run `notebooklm login` first (in a real terminal).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';

const NAME = process.env.NOTEBOOKLM_NAME || 'claude:my-port';
const TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
mkdirSync('notebooklm', { recursive: true });

const halt = (reason) => {
  writeFileSync('notebooklm/last-run.json', JSON.stringify({ ts: TS, status: 'failed', error: reason }, null, 2));
  console.error(`HALT: ${reason}`);
  process.exit(1);
};

const nb = (args) => execFileSync('notebooklm', args, { encoding: 'utf8' });

// --- Input guard: resolve the notebook by EXACT title, or halt --------------
let listed;
try {
  listed = JSON.parse(nb(['list', '--json']));
} catch (e) {
  halt(`could not list notebooks (logged in? run \`notebooklm login\`): ${e.message}`);
}
// `list --json` returns an array (or an object wrapping one). Field names are
// read defensively and confirmed on the first real run.
const notebooks = Array.isArray(listed) ? listed : (listed.notebooks || listed.items || listed.data || []);
if (!Array.isArray(notebooks) || notebooks.length === 0) halt('`notebooklm list --json` returned no notebooks');
const titleOf = (n) => n.title ?? n.name ?? n.displayName ?? '';
const idOf = (n) => n.id ?? n.notebook_id ?? n.notebookId ?? n.uuid ?? '';
const matches = notebooks.filter((n) => titleOf(n) === NAME);
if (matches.length === 0) halt(`no notebook titled "${NAME}" — create it in NotebookLM with that exact title`);
if (matches.length > 1) halt(`multiple notebooks titled "${NAME}" — refusing to guess`);
const notebookId = idOf(matches[0]);
if (!notebookId) halt(`matched "${NAME}" but could not read its id from \`list --json\``);

// --- Read the standing questions, filling in the live plan ------------------
let questions;
try {
  questions = readFileSync('notebooklm/questions.md', 'utf8')
    .split('\n').filter((l) => /^\d+\./.test(l)).map((l) => l.replace(/^\d+\.\s*/, '').trim());
} catch (e) {
  halt(`could not read notebooklm/questions.md: ${e.message}`);
}
if (questions.length === 0) halt('no standing questions found in notebooklm/questions.md');

// Substitute the current target into the question templates so NotebookLM is
// asked about the real buckets, not the literal "[buckets + %]" placeholder.
let bucketsStr = '';
let risk = 'moderate';
try {
  const plan = JSON.parse(readFileSync('src/data/plan.json', 'utf8'));
  bucketsStr = (plan.buckets || []).map((b) => `${b.name} ${b.target}%`).join(', ');
  risk = plan.meta?.riskProfile || risk;
} catch { /* templates left as-is if plan.json is unreadable */ }
const fill = (q) => q
  .replace(/\[buckets \+ %\]/gi, bucketsStr || '[buckets + %]')
  .replace(/\[moderate\]/gi, risk);

// --- Ask each question against the resolved notebook ------------------------
mkdirSync('notebooklm/fetches', { recursive: true });
try {
  questions.forEach((raw, i) => {
    const q = fill(raw);
    console.log(`[${i + 1}/${questions.length}] ${q}`);
    // Non-destructive: `ask` continues the notebook's conversation. --json
    // yields the answer plus source references (and implies --yes so it never
    // hangs on a prompt). -n targets the resolved notebook explicitly.
    const answer = nb(['ask', '-n', notebookId, '--json', q]);
    const file = `notebooklm/fetches/answer-${TS}-q${i + 1}.md`;
    writeFileSync(file, `# ${q}\n\n_ts: ${TS} · notebook: ${NAME} (${notebookId})_\n\n\`\`\`json\n${answer}\n\`\`\`\n`);
    appendFileSync('notebooklm/log.jsonl', JSON.stringify({ ts: TS, question: q, answer_file: file, notebook: NAME, status: 'ok' }) + '\n');
  });
} catch (e) {
  halt(`fetch failed mid-run: ${e.message}`);
}

writeFileSync('notebooklm/last-run.json', JSON.stringify({ ts: TS, status: 'ok', notebook: NAME, count: questions.length }, null, 2));
console.log('Done. Now tell Claude: "update my Strategy plan".');
