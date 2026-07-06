#!/usr/bin/env node
// Wrapper around the notebooklm-py CLI. Resolves the target notebook BY NAME
// (fail-safe: halt on 0 or 2+ matches), asks each standing question, and writes
// grounded answers to notebooklm/fetches/. Run locally only (`notebooklm login`
// first). Verify exact subcommands/flags with `notebooklm --help` and adjust.
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

// --- Input guard: resolve notebook by exact title -------------------------
let notebooks;
try {
  // Expect JSON array of { id, title }. Adjust flags to the tool's CLI.
  notebooks = JSON.parse(execFileSync('notebooklm', ['notebooks', 'list', '--json'], { encoding: 'utf8' }));
} catch (e) {
  halt(`could not list notebooks (auth/API?): ${e.message}`);
}
if (!Array.isArray(notebooks)) halt('unexpected response from `notebooks list` (expected a JSON array of notebooks)');
const matches = notebooks.filter(n => n.title === NAME);
if (matches.length === 0) halt(`no notebook titled "${NAME}" — did you rename it?`);
if (matches.length > 1)  halt(`multiple notebooks titled "${NAME}" — refusing to guess`);
const notebookId = matches[0].id;

// --- Ask each standing question, write grounded answers --------------------
let questions;
try {
  questions = readFileSync('notebooklm/questions.md', 'utf8')
    .split('\n').filter(l => /^\d+\./.test(l)).map(l => l.replace(/^\d+\.\s*/, '').trim());
} catch (e) {
  halt(`could not read notebooklm/questions.md: ${e.message}`);
}

mkdirSync('notebooklm/fetches', { recursive: true });
try {
  questions.forEach((q, i) => {
    console.log(`[${i + 1}/${questions.length}] ${q}`);
    const answer = execFileSync('notebooklm', ['chat', '--notebook', notebookId, '--query', q], { encoding: 'utf8' });
    const file = `notebooklm/fetches/answer-${TS}-q${i + 1}.md`;
    writeFileSync(file, `# ${q}\n\n_ts: ${TS} · notebook: ${NAME} (${notebookId})_\n\n${answer}\n`);
    appendFileSync('notebooklm/log.jsonl', JSON.stringify({ ts: TS, question: q, answer_file: file, notebook: NAME, status: 'ok' }) + '\n');
  });
} catch (e) {
  halt(`fetch failed mid-run: ${e.message}`);
}

writeFileSync('notebooklm/last-run.json', JSON.stringify({ ts: TS, status: 'ok', notebook: NAME, count: questions.length }, null, 2));
console.log('Done. Now tell Claude: "update my Strategy plan".');
