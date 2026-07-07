#!/usr/bin/env node
// Output guard: every plan.json suggestion/research item must cite a real file
// under notebooklm/fetches/. Empty arrays are fine (pre-fetch seed state).
import { existsSync, readFileSync } from 'node:fs';

export function validatePlan(plan, existsFn) {
  const errors = [];
  const items = [...(plan.suggestions || []), ...(plan.research || [])];
  for (const it of items) {
    const cite = (it.cite || '').trim();
    if (!cite) { errors.push(`item has empty cite: ${JSON.stringify(it).slice(0, 80)}`); continue; }
    if (!existsFn(`notebooklm/fetches/${cite}`)) errors.push(`cite does not resolve: ${cite}`);
  }
  return { ok: errors.length === 0, errors };
}

// CLI entry (only when run directly, not when imported by the self-check).
if (import.meta.url === `file://${process.argv[1]}`) {
  const plan = JSON.parse(readFileSync('src/data/plan.json', 'utf8'));
  const { ok, errors } = validatePlan(plan, existsSync);
  if (!ok) { console.error('plan.json validation FAILED:'); errors.forEach(e => console.error(' - ' + e)); process.exit(1); }
  console.log('plan.json validation: OK');
}
