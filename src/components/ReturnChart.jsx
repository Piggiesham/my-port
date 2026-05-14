import { useState, useMemo, useRef, useEffect, useContext } from 'react';
import { CurrencyContext, SERIES_BY_PORTFOLIO, RANGES, dateLabelsFor, fmtCurrency } from '../data.js';

export default function ReturnChart({ portfolio = 'All', totalNow, totalCost }) {
  const cur = useContext(CurrencyContext);
  const [range, setRange] = useState('1Y');
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => { setHover(null); }, [portfolio, range]);

  const seriesSet = SERIES_BY_PORTFOLIO[portfolio] || SERIES_BY_PORTFOLIO['All'];
  const data = seriesSet[range];
  const dates = useMemo(() => dateLabelsFor(range), [range]);

  const W = 800, H = 280;
  const padL = 8, padR = 72, padT = 16, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const yRange = max - min || 1;
  const yMin = min - yRange * 0.08;
  const yMax = max + yRange * 0.08;

  const x = i => padL + (i / (data.length - 1)) * plotW;
  const y = v => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const linePath = data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(' ');
  const areaPath = linePath + ` L ${x(data.length - 1).toFixed(2)} ${padT + plotH} L ${x(0).toFixed(2)} ${padT + plotH} Z`;

  const startVal = data[0];
  const endVal = data[data.length - 1];
  const pctChange = ((endVal - startVal) / startVal) * 100;
  const dollarChange = endVal - startVal;
  const up = pctChange >= 0;

  const yTicks = useMemo(() => {
    const ticks = [];
    for (let i = 0; i <= 4; i++) ticks.push(yMin + ((yMax - yMin) * i) / 4);
    return ticks;
  }, [yMin, yMax]);

  const xTicks = useMemo(() => {
    const n = Math.min(5, data.length);
    const ticks = [];
    for (let i = 0; i < n; i++) ticks.push(Math.round((i / (n - 1)) * (data.length - 1)));
    return ticks;
  }, [data.length]);

  const fmtDate = (d) => {
    if (range === '1W') return d.toLocaleDateString('en-US', { weekday: 'short' });
    if (range === '1M' || range === '3M') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  };

  const fmtMoney = (v) => fmtCurrency(v, cur.currency, { decimals: 2 });
  const fmtMoneyCompact = (v) => fmtCurrency(v, cur.currency, { decimals: 1, compact: true });

  const onMove = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const px = (e.clientX - rect.left) * scaleX;
    if (px < padL || px > padL + plotW) { setHover(null); return; }
    const ratio = (px - padL) / plotW;
    const idx = Math.round(ratio * (data.length - 1));
    setHover({ idx, clientX: e.clientX - rect.left, clientY: e.clientY - rect.top });
  };

  const lineColor = up ? '#4ade80' : '#f87171';
  const gradId = `g-${range}-${cur.currency}-${portfolio}`;

  const totalReturn = totalCost > 0 ? ((totalNow - totalCost) / totalCost) * 100 : 0;

  const fmtSignedAmount = (v) => {
    const abs = Math.abs(v);
    const sign = v >= 0 ? '+' : '-';
    return sign + fmtCurrency(abs, cur.currency, { decimals: 2 });
  };

  return (
    <div className="card chart-card">
      <div className="card-head">
        <div>
          <div className="card-title">Portfolio Return</div>
          <div className="card-sub">{portfolio === 'All' ? 'All portfolios' : portfolio} · {RANGES[range].label}</div>
        </div>
        <div className="ranges">
          {Object.keys(RANGES).map(r => (
            <button key={r} className={r === range ? 'active' : ''} onClick={() => { setRange(r); setHover(null); }}>{r}</button>
          ))}
        </div>
      </div>

      <div className="chart-summary">
        <div className="chart-summary-left">
          <div className="num" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {hover ? fmtMoney(data[hover.idx]) : fmtMoney(endVal)}
          </div>
          <div className="num" style={{ fontSize: 13, marginTop: 6, color: up ? 'var(--green)' : 'var(--red)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className={up ? 'arrow-up' : 'arrow-down'}></span>
            <span>{up ? '+' : ''}{pctChange.toFixed(2)}%</span>
            <span style={{ color: 'var(--text-faint)' }}>
              {fmtSignedAmount(dollarChange)} · {RANGES[range].label.toLowerCase()}
            </span>
          </div>
        </div>
        <div className="chart-summary-right">
          <div style={{ fontSize: 11, color: 'var(--text-faint)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>All-time return</div>
          <div className="num" style={{ fontSize: 15, color: totalReturn >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 4 }}>{totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(2)}%</div>
        </div>
      </div>

      <div className="chart-wrap" ref={wrapRef}>
        <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity="0.22" />
              <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
            </linearGradient>
          </defs>

          {yTicks.map((v, i) => (
            <g key={i}>
              <line className="grid-line" x1={padL} x2={padL + plotW} y1={y(v)} y2={y(v)} />
              <text className="axis-label" x={padL + plotW + 8} y={y(v) + 4} textAnchor="start">
                {fmtMoneyCompact(v)}
              </text>
            </g>
          ))}

          <path d={areaPath} fill={`url(#${gradId})`} />
          <path d={linePath} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {xTicks.map((idx, i) => (
            <text key={i} className="axis-label" x={x(idx)} y={H - 8} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>
              {fmtDate(dates[idx])}
            </text>
          ))}

          {hover && (
            <g>
              <line className="hover-line" x1={x(hover.idx)} x2={x(hover.idx)} y1={padT} y2={padT + plotH} />
              <circle className="hover-dot" cx={x(hover.idx)} cy={y(data[hover.idx])} r="5" style={{ fill: lineColor }} />
            </g>
          )}
        </svg>

        {hover && (() => {
          const rect = wrapRef.current?.getBoundingClientRect();
          if (!rect) return null;
          const scaleX = rect.width / W;
          const tx = x(hover.idx) * scaleX;
          const ty = y(data[hover.idx]) * (rect.height / H);
          const hoverPct = ((data[hover.idx] - startVal) / startVal) * 100;
          const hoverUp = hoverPct >= 0;
          return (
            <div className="tooltip" style={{ left: tx, top: ty }}>
              <div className="t-date">{dates[hover.idx].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
              <div className="t-val">{fmtMoney(data[hover.idx])}</div>
              <div className="t-delta" style={{ color: hoverUp ? 'var(--green)' : 'var(--red)' }}>
                {hoverUp ? '+' : ''}{hoverPct.toFixed(2)}%
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
