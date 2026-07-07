import { useState, useMemo, useRef } from 'react';
import { ALLOCATION_TEMPLATES } from '../../lib/strategy.js';
import { useClickOutside } from '../../lib/useClickOutside.js';

// Build the editable draft from the committed buckets.
const draftFromBuckets = (buckets) => buckets.map(b => ({ id: b.id, name: b.name, target: b.target }));

const SEED_OPTIONS = [{ id: 'current', name: 'My current' }, ...ALLOCATION_TEMPLATES.map(t => ({ id: t.id, name: t.name }))];

export default function AllocationWorkbench({ plan }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => draftFromBuckets(plan.buckets));
  const [seed, setSeed] = useState('current');
  const [seedOpen, setSeedOpen] = useState(false);
  const seedRef = useRef(null);
  useClickOutside(seedRef, () => setSeedOpen(false));

  const sum = useMemo(() => draft.reduce((s, b) => s + (Number(b.target) || 0), 0), [draft]);
  const sumOk = Math.abs(sum - 100) < 0.001;
  const seedName = SEED_OPTIONS.find(o => o.id === seed)?.name || 'My current';

  const applyTemplate = (tplId) => {
    setSeed(tplId);
    if (tplId === 'current') { setDraft(draftFromBuckets(plan.buckets)); return; }
    const tpl = ALLOCATION_TEMPLATES.find(t => t.id === tplId);
    if (tpl) setDraft(tpl.buckets.map(b => ({ ...b })));
  };

  const setTarget = (id, v) => setDraft(d => d.map(b => b.id === id ? { ...b, target: v } : b));
  const commitTarget = (id, v) => setDraft(d => d.map(b => b.id === id ? { ...b, target: Number(v) || 0 } : b));

  // One-line instruction the user hands to Claude to persist.
  const instruction = useMemo(() => {
    const parts = draft.map(b => `${b.name} ${b.target}%`).join(', ');
    return `set targets: ${parts}`;
  }, [draft]);

  const minCash = plan.guardrails?.minCash ?? 0;
  const cashBucket = draft.find(b => /cash|ballast/i.test(b.name));
  const cashViol = cashBucket && cashBucket.target < minCash;

  return (
    <div className="card wb">
      <div className="wb-head" onClick={() => setOpen(o => !o)}>
        <div>
          <div className="card-title">Allocation Workbench</div>
          <div className="card-sub">draft a target — nothing saves until you commit</div>
        </div>
        <svg className={`wb-caret ${open ? 'open' : ''}`} width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {open && (
        <div className="wb-body">
          <div className="wb-seeds">
            <div className="dropdown" ref={seedRef} style={{ position: 'relative' }}>
              <button type="button" className={`pill-btn ${seedOpen ? 'open' : ''}`} onClick={() => setSeedOpen(o => !o)}>
                <span className="dim">Seed:</span>
                <span className="b">{seedName}</span>
                <svg className="caret" width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: 'var(--text-dim)', transition: 'transform 0.18s', transform: seedOpen ? 'rotate(180deg)' : 'none' }}>
                  <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {seedOpen && (
                <div className="dropdown-menu" style={{ left: 0, right: 'auto', minWidth: 180 }}>
                  {SEED_OPTIONS.map(o => (
                    <button key={o.id} type="button" className={`dropdown-item ${o.id === seed ? 'selected' : ''}`} onClick={() => { applyTemplate(o.id); setSeedOpen(false); }}>
                      <span>{o.name}</span>
                      {o.id === seed && <span style={{ color: 'var(--accent)' }}>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="wb-note">Tip: ask Claude to “propose an allocation from my research” to seed from NotebookLM.</span>
          </div>

          {draft.map(b => (
            <div className="wb-row" key={b.id}>
              <span className="wb-name">{b.name}</span>
              <input type="range" min="0" max="100" step="1" aria-label={b.name}
                style={{ '--val': `${Number(b.target) || 0}%` }}
                value={Number(b.target) || 0} onChange={e => commitTarget(b.id, e.target.value)} />
              <input className="field-input wb-num" type="number" min="0" max="100" value={b.target}
                onChange={e => setTarget(b.id, e.target.value)} onBlur={e => commitTarget(b.id, e.target.value)} />
              <span className="wb-pct">%</span>
            </div>
          ))}

          <div className={`wb-sum ${sumOk ? 'ok' : 'bad'}`}>Sum: {sum.toFixed(1)}% {sumOk ? '✓' : '— must equal 100%'}</div>
          {cashViol && <div className="wb-guard">⚠ Ballast/cash {cashBucket.target}% is below your {minCash}% minimum</div>}

          <div className="wb-commit">
            <span className="wb-label">To commit:</span>
            <code className="wb-instruction">{instruction}</code>
            <div className="wb-note">Paste that to Claude — it writes plan.json and pushes. (Sliders reset on refresh.)</div>
          </div>
        </div>
      )}
    </div>
  );
}
