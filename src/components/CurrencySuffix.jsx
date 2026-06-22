import { useState, useRef } from 'react';
import { useClickOutside } from '../lib/useClickOutside.js';

// USD/THB toggle rendered as a field suffix. Shared by AddTransactionModal and
// TransactionDetailModal.
export function CurrencySuffix({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useClickOutside(wrapRef, () => setOpen(false));
  return (
    <span
      className="field-suffix"
      ref={wrapRef}
      style={{ userSelect: 'none' }}
      onClick={() => setOpen(o => !o)}
    >
      {value}
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transition: 'transform 0.18s', transform: open ? 'rotate(180deg)' : 'none' }}>
        <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {open && (
        <div className="dropdown-menu" style={{ minWidth: 96, right: 0, top: 'calc(100% + 6px)' }}>
          {['USD', 'THB'].map(c => (
            <button
              key={c}
              type="button"
              className={`dropdown-item${c === value ? ' selected' : ''}`}
              onClick={(e) => { e.stopPropagation(); onChange(c); setOpen(false); }}
            >
              <span>{c}</span>
              {c === value && <span style={{ color: 'var(--accent)' }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
