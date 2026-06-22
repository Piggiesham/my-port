import { useState, useRef, useEffect } from 'react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEK = ['Mo','Tu','We','Th','Fr','Sa','Su'];

function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function parseIso(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
}

const chevBtn = {
  width: 32, height: 32, borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--border-strong)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', cursor: 'pointer',
};
const selectBtn = {
  width: '100%', height: 32, padding: '0 12px', borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--border-strong)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const menuStyle = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 200, overflowY: 'auto',
  background: 'var(--panel-2)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: 4, zIndex: 70,
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
};

export function DatePopover({ value, onPick, onClose, anchorRef }) {
  const popRef = useRef(null);
  const initial = parseIso(value) || new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const [monthOpen, setMonthOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);

  // Bespoke (not useClickOutside): must also ignore clicks on the anchor button
  // so toggling the calendar icon doesn't immediately re-close it.
  useEffect(() => {
    const onClick = (e) => {
      if (popRef.current && !popRef.current.contains(e.target) && (!anchorRef?.current || !anchorRef.current.contains(e.target))) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [onClose, anchorRef]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(viewYear, viewMonth, 1 - startWeekday);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    return d;
  });
  const todayIso = isoDate(new Date());
  const selectedIso = value;

  const years = (() => {
    const cy = new Date().getFullYear();
    const arr = [];
    for (let y = cy + 1; y >= cy - 30; y--) arr.push(y);
    return arr;
  })();

  const stepMonth = (delta) => {
    let m = viewMonth + delta, y = viewYear;
    if (m < 0) { m = 11; y--; }
    else if (m > 11) { m = 0; y++; }
    setViewMonth(m); setViewYear(y);
  };

  return (
    <div
      ref={popRef}
      style={{
        position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 60,
        background: 'var(--panel-2)', border: '1px solid var(--border-strong)', borderRadius: 16,
        padding: 14, width: 320, boxShadow: '0 18px 40px rgba(0,0,0,0.5)',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => stepMonth(-1)} style={chevBtn} aria-label="Previous month">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3l-4 4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div style={{ position: 'relative', flex: 1 }}>
          <button type="button" onClick={() => { setMonthOpen(o => !o); setYearOpen(false); }} style={selectBtn}>
            <span>{MONTHS[viewMonth]}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {monthOpen && (
            <div style={menuStyle}>
              {MONTHS.map((m, i) => (
                <button key={m} type="button" className="dropdown-item" onClick={() => { setViewMonth(i); setMonthOpen(false); }} style={{ display: 'block', width: '100%', textAlign: 'left' }}>
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative', width: 96 }}>
          <button type="button" onClick={() => { setYearOpen(o => !o); setMonthOpen(false); }} style={selectBtn}>
            <span>{viewYear}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {yearOpen && (
            <div style={menuStyle}>
              {years.map((y) => (
                <button key={y} type="button" className="dropdown-item" onClick={() => { setViewYear(y); setYearOpen(false); }} style={{ display: 'block', width: '100%', textAlign: 'left' }}>
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={() => stepMonth(1)} style={chevBtn} aria-label="Next month">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, fontSize: 12, color: 'var(--text-faint)', marginBottom: 6 }}>
        {WEEK.map(w => <div key={w} style={{ textAlign: 'center', padding: '4px 0', fontWeight: 600 }}>{w}</div>)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === viewMonth;
          const iso = isoDate(d);
          const isSelected = iso === selectedIso;
          const isToday = iso === todayIso;
          return (
            <button
              key={i}
              type="button"
              onClick={() => { onPick(iso); onClose(); }}
              style={{
                aspectRatio: '1 / 1',
                borderRadius: '50%',
                fontWeight: isSelected || isToday ? 700 : 500,
                fontSize: 13,
                background: isSelected ? 'var(--accent, #6366f1)' : 'transparent',
                color: isSelected ? 'white' : (inMonth ? 'var(--text)' : 'var(--text-faint)'),
                border: isToday && !isSelected ? '1px solid var(--border-strong)' : '1px solid transparent',
                cursor: 'pointer',
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Text input (DD/MM/YYYY) + calendar-popover button. Owns its own popover
// open state and display formatting; the parent only deals in ISO strings.
export function EditDateField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const iconRef = useRef(null);
  const [y, m, d] = (value || '').split('-');
  const display = (y && m && d) ? `${d}/${m}/${y}` : '';
  return (
    <div className="field-with-icon" style={{ position: 'relative' }}>
      <input
        className="field-input"
        value={display}
        onChange={e => {
          const t = e.target.value.trim();
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) {
            const [dd, mm, yyyy] = t.split('/');
            onChange(`${yyyy}-${mm}-${dd}`);
          }
        }}
        placeholder="DD/MM/YYYY"
      />
      <button
        type="button"
        ref={iconRef}
        onClick={() => setOpen(o => !o)}
        aria-label="Open calendar"
        style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: 4, display: 'inline-flex' }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M2 6h12M5 2v3M11 2v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <DatePopover
          value={value}
          anchorRef={iconRef}
          onPick={(iso) => onChange(iso)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
