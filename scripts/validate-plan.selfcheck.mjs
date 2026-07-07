import assert from 'node:assert/strict';
import { validatePlan } from './validate-plan.mjs';

const exists = (rel) => rel === 'notebooklm/fetches/real.md';   // only this one exists

// Empty arrays → valid (seed state).
assert.deepEqual(validatePlan({ suggestions: [], research: [] }, exists), { ok: true, errors: [] });

// Resolvable citation → valid.
assert.ok(validatePlan({ suggestions: [{ cite: 'real.md' }], research: [] }, exists).ok);

// Missing citation file → invalid.
const bad = validatePlan({ suggestions: [{ cite: 'ghost.md' }], research: [] }, exists);
assert.equal(bad.ok, false);
assert.ok(bad.errors[0].includes('ghost.md'));

// Empty citation string → invalid (a claim with no evidence).
assert.equal(validatePlan({ suggestions: [], research: [{ cite: '' }] }, exists).ok, false);

console.log('validate-plan.selfcheck: OK');
