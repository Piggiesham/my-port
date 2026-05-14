import { useState, useMemo, useRef, useEffect, useContext } from 'react';
import { CurrencyContext, ASSETS, TOTAL_NOW, CATEGORIES, categoryDataFor, fmtCurrency } from '../data.js';

export default function PieChart({ assets = ASSETS, totalNow = TOTAL_NOW, portfolio = 'All' }) {
  const cur = useContext(CurrencyContext);
  const [category, setCategory] = useState('By Asset Type');
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(null);
  const ddRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ddRef.current && !ddRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => { setHoverIdx(null); }, [category, portfolio]);

  const categoryData = useMemo(() => categoryDataFor(assets), [assets]);
  const data = categoryData[category] || [];
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  const cx = 90, cy = 90, r = 75, rInner = 50;
  let cumAngle = -Math.PI / 2;

  const arcs = data.map((d) => {
    const a = (d.value / total) * Math.PI * 2;
    const start = cumAngle;
    const end = cumAngle + a;
    cumAngle = end;
    const largeArc = a > Math.PI ? 1 : 0;
    const sx = cx + r * Math.cos(start);
    const sy = cy + r * Math.sin(start);
    const ex = cx + r * Math.cos(end);
    const ey = cy + r * Math.sin(end);
    const sxI = cx + rInner * Math.cos(start);
    const syI = cy + rInner * Math.sin(start);
    const exI = cx + rInner * Math.cos(end);
    const eyI = cy + rInner * Math.sin(end);
    const path = `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey} L ${exI} ${eyI} A ${rInner} ${rInner} 0 ${largeArc} 0 ${sxI} ${syI} Z`;
    return { ...d, path, pct: (d.value / total) * 100 };
  });

  const focused = hoverIdx !== null ? arcs[hoverIdx] : null;
  const totalLabel = fmtCurrency(totalNow, cur.currency, { decimals: 0, compact: true });

  return (
    <div className="card pie-card">
      <div className="card-head">
        <div>
          <div className="card-title">Allocation</div>
          <div className="card-sub">{focused ? focused.name : `${data.length} ${data.length === 1 ? 'category' : 'categories'}`}</div>
        </div>
        <div className="dropdown" ref={ddRef}>
          <button className={`dropdown-btn${open ? ' open' : ''}`} onClick={() => setOpen(o => !o)}>
            <span>{category}</span>
            <svg className="caret" width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {open && (
            <div className="dropdown-menu">
              {CATEGORIES.map(c => (
                <button key={c} className={`dropdown-item${c === category ? ' selected' : ''}`} onClick={() => { setCategory(c); setOpen(false); setHoverIdx(null); }}>
                  <span>{c}</span>
                  <span className="count">{categoryData[c].length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="pie-body">
        <div className="pie-svg-wrap">
          {arcs.length === 0 ? (
            <div style={{ width: 180, height: 180, display: 'grid', placeItems: 'center', border: '1px dashed var(--border-strong)', borderRadius: '50%', color: 'var(--text-faint)', fontSize: 12 }}>No data</div>
          ) : (
            <svg className="pie-svg" viewBox="0 0 180 180">
              {arcs.map((a, i) => (
                <path
                  key={i}
                  d={a.path}
                  fill={a.color}
                  className={`pie-arc ${hoverIdx !== null && hoverIdx !== i ? 'dim' : ''}`}
                  style={{ transform: hoverIdx === i ? 'scale(1.035)' : 'scale(1)' }}
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                />
              ))}
              <text className="pie-center-sub" x="90" y="84" textAnchor="middle">{focused ? 'Share' : 'Total'}</text>
              <text className="pie-center" x="90" y="104" textAnchor="middle">
                {focused ? `${focused.pct.toFixed(1)}%` : totalLabel}
              </text>
            </svg>
          )}
        </div>

        <div className="legend-wrap">
          <div className="legend">
            {arcs.map((a, i) => (
              <div
                key={i}
                className={`legend-row${hoverIdx !== null && hoverIdx !== i ? ' dim' : ''}`}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              >
                <span className="swatch" style={{ background: a.color }}></span>
                <span className="name">{a.name}</span>
                <span className="pct">{a.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
