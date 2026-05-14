import { useState, useMemo, useCallback, useRef, useEffect, useContext } from 'react';
import { CurrencyContext, SERIES_BY_PORTFOLIO, RANGES, dateLabelsFor, fmtCurrency } from '../data.js';
import { computeReturnSeries, fetchPriceHistory, computeDailyReturnSeries } from '../lib/api.js';
import { supabaseEnabled } from '../lib/supabase.js';

const RANGE_DAYS = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, 'ALL': Infinity };

export default function ReturnChart({ portfolio = 'All', totalNow, totalCost, transactions = [], priceMap = {} }) {
  const cur = useContext(CurrencyContext);
  const [range, setRange] = useState('1Y');
  const [hover, setHover] = useState(null);
  const [daily, setDaily] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => { setHover(null); }, [portfolio, range]);

  // Fetch historical prices for every ticker that ever appeared in the
  // (portfolio-filtered) transaction stream, then replay tx-derived qty per
  // day against those prices. Falls back to the sparse tx-based curve when
  // Supabase is disabled or the fetch hasn't completed yet.
  useEffect(() => {
    if (!supabaseEnabled || !transactions || transactions.length === 0) {
      setDaily(null);
      return;
    }
    let cancelled = false;
    const days = RANGE_DAYS[range];
    const earliestTxMs = Math.min(...transactions.map(t => new Date(t.date).getTime()));
    const to = new Date();
    const from = isFinite(days)
      ? new Date(Math.max(earliestTxMs, Date.now() - days * 86400000))
      : new Date(earliestTxMs);
    const tickers = [...new Set(transactions.map(t => t.ticker).filter(Boolean))];

    setDaily(null);
    fetchPriceHistory(tickers, from, to).then(priceHist => {
      if (cancelled) return;
      const built = computeDailyReturnSeries(transactions, priceHist, from, to);
      if (built.length >= 2) setDaily(built);
    }).catch(err => console.warn('[ReturnChart] daily series failed', err));

    return () => { cancelled = true; };
  }, [transactions, range]);

  // Build the series directly from transactions so the chart stays in sync
  // with the transactions list. Prefers the daily historical series when
  // loaded; falls back to the sparse event-based series otherwise.
  const series = useMemo(() => {
    if (daily && daily.length >= 2) return daily;
    if (!transactions || transactions.length === 0) return null;
    const full = computeReturnSeries(transactions, priceMap);
    if (full.length < 2) return null;

    const days = RANGE_DAYS[range];
    if (!isFinite(days)) return full;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const inRange = full.filter(p => p.date >= cutoff);

    // If transactions exist inside the window, anchor the line at the
    // portfolio value the moment before the window starts so percentages
    // reflect the chosen range. Otherwise the line is flat at current value.
    if (inRange.length === 0) {
      const last = full[full.length - 1];
      return [{ date: cutoff, value: last.value }, last];
    }
    const priorIdx = full.findIndex(p => p.date >= cutoff) - 1;
    if (priorIdx >= 0) {
      return [{ date: cutoff, value: full[priorIdx].value }, ...inRange];
    }
    return inRange;
  }, [daily, transactions, priceMap, range]);

  const data = useMemo(() => {
    if (series) return series.map(s => s.value);
    return (SERIES_BY_PORTFOLIO[portfolio] || SERIES_BY_PORTFOLIO['All'])[range];
  }, [series, portfolio, range]);

  const dates = useMemo(() => {
    if (series) return series.map(s => s.date);
    return dateLabelsFor(range);
  }, [series, range]);

  const W = 800, H = 280;
  const padL = 8, padR = 72, padT = 16, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const yRange = max - min || 1;
  const yMin = min - yRange * 0.08;
  const yMax = max + yRange * 0.08;

  // When the series is built from real transactions, dates are unevenly
  // spaced. Plot x by time so the line accurately reflects when events
  // happened. Fall back to index-based spacing for the synthetic series.
  const useTimeX = !!series;
  const tStart = useTimeX ? dates[0].getTime() : 0;
  const tEnd = useTimeX ? dates[dates.length - 1].getTime() : 0;
  const tSpan = tEnd - tStart || 1;
  const x = useCallback(i => useTimeX
    ? padL + ((dates[i].getTime() - tStart) / tSpan) * plotW
    : padL + (i / (data.length - 1)) * plotW,
    [useTimeX, padL, dates, tStart, tSpan, plotW, data.length]);
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
    if (useTimeX) {
      for (let i = 0; i < n; i++) {
        const t = tStart + ((tEnd - tStart) * i) / (n - 1);
        const px = padL + ((t - tStart) / tSpan) * plotW;
        ticks.push({ px, date: new Date(t) });
      }
    } else {
      for (let i = 0; i < n; i++) {
        const idx = Math.round((i / (n - 1)) * (data.length - 1));
        ticks.push({ px: x(idx), date: dates[idx] });
      }
    }
    return ticks;
  }, [data.length, useTimeX, tStart, tEnd, tSpan, dates, plotW, x, padL]);

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
    let idx;
    if (useTimeX) {
      let best = 0, bestDist = Infinity;
      for (let i = 0; i < data.length; i++) {
        const d = Math.abs(x(i) - px);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      idx = best;
    } else {
      const ratio = (px - padL) / plotW;
      idx = Math.round(ratio * (data.length - 1));
    }
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

          {xTicks.map((t, i) => (
            <text key={i} className="axis-label" x={t.px} y={H - 8} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>
              {fmtDate(t.date)}
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
