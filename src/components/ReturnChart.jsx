import { useState, useMemo, useCallback, useRef, useEffect, useContext } from 'react';
import { CurrencyContext, SERIES_BY_PORTFOLIO, RANGES, dateLabelsFor, FX_RATE } from '../data.js';
import { computeReturnSeries, fetchPriceHistory, computeDailyReturnSeries } from '../lib/api.js';
import { supabaseEnabled } from '../lib/supabase.js';

const RANGE_DAYS = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, 'ALL': Infinity };
const MODE_KEY = 'myport.chart.mode';

export default function ReturnChart({ portfolio = 'All', totalNow, transactions = [], priceMap = {} }) {
  const cur = useContext(CurrencyContext);
  const [range, setRange] = useState('1Y');
  const [hover, setHover] = useState(null);
  const [daily, setDaily] = useState(null);
  const [mode, setMode] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' && localStorage.getItem(MODE_KEY);
      return saved === 'performance' ? 'performance' : 'value';
    } catch {
      return 'value';
    }
  });
  const wrapRef = useRef(null);

  useEffect(() => { setHover(null); }, [portfolio, range, mode]);

  useEffect(() => {
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

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
    // Always fetch THB price history so the chart can convert USD values to
    // baht using each day's historical FX, not just today's rate.
    const tickers = [...new Set([...transactions.map(t => t.ticker).filter(Boolean), 'THB'])];

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
  // loaded; falls back to the sparse event-based series otherwise. Each
  // point carries { date, value, invested }.
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

    if (inRange.length === 0) {
      const last = full[full.length - 1];
      return [{ date: cutoff, value: last.value, invested: last.invested }, last];
    }
    const priorIdx = full.findIndex(p => p.date >= cutoff) - 1;
    if (priorIdx >= 0) {
      const prior = full[priorIdx];
      return [{ date: cutoff, value: prior.value, invested: prior.invested }, ...inRange];
    }
    return inRange;
  }, [daily, transactions, priceMap, range]);

  // FX rate per series point — historical USD-per-THB if available, else
  // today's constant. Used to convert USD values to baht in THB display mode.
  const fxArr = useMemo(() => {
    const fallback = cur.fxRate || FX_RATE;
    if (series) return series.map(s => (s.fxRate && s.fxRate > 0) ? s.fxRate : fallback);
    return [fallback, fallback];
  }, [series, cur.fxRate]);

  const toDisplay = useCallback((vUsd, idx) => {
    if (cur.currency !== 'THB') return vUsd;
    return vUsd * (fxArr[idx] ?? cur.fxRate ?? FX_RATE);
  }, [cur.currency, cur.fxRate, fxArr]);

  const valueArr = useMemo(() => {
    if (series) return series.map((s, i) => toDisplay(s.value, i));
    if (supabaseEnabled) {
      const v = Number.isFinite(totalNow) ? totalNow : 0;
      const v2 = toDisplay(v, 0);
      return [v2, v2];
    }
    const raw = (SERIES_BY_PORTFOLIO[portfolio] || SERIES_BY_PORTFOLIO['All'])[range];
    return raw.map((v, i) => toDisplay(v, i));
  }, [series, portfolio, range, totalNow, toDisplay]);

  const investedArr = useMemo(() => {
    if (series) {
      // In THB mode show invested-at-deposit-FX so the gap vs the value line
      // reflects real conversion-risk return, not today's FX × USD cost.
      if (cur.currency === 'THB') {
        return series.map(s => Number(s.investedThb) || 0);
      }
      return series.map(s => Number(s.invested) || 0);
    }
    // Mock-mode and empty-state fallback — no invested data available.
    return valueArr.map(() => 0);
  }, [series, valueArr, cur.currency]);

  const perfArr = useMemo(
    () => valueArr.map((v, i) => v - (investedArr[i] ?? 0)),
    [valueArr, investedArr]
  );

  const dates = useMemo(() => {
    if (series) return series.map(s => s.date);
    if (supabaseEnabled) {
      const days = RANGE_DAYS[range];
      const end = new Date();
      const start = isFinite(days) ? new Date(Date.now() - days * 86400000) : new Date(end);
      return [start, end];
    }
    return dateLabelsFor(range);
  }, [series, range]);

  // Whether to draw the dashed "invested capital" reference. Only meaningful
  // when we have a real series (Supabase) AND the invested values aren't all 0.
  const hasInvested = !!series && investedArr.some(v => v > 0);
  const isPerf = mode === 'performance';

  // The primary data series rendered as the solid line.
  const data = isPerf ? perfArr : valueArr;

  const W = 800, H = 280;
  const padL = 8, padR = 72, padT = 16, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Y-axis: in performance mode, force 0 into range so the zero baseline is
  // always visible. In value mode, fit the data with a small padding.
  let yMin, yMax;
  if (isPerf) {
    const lo = Math.min(0, ...data);
    const hi = Math.max(0, ...data);
    const span = hi - lo || Math.max(Math.abs(hi), Math.abs(lo), 1);
    yMin = lo - span * 0.08;
    yMax = hi + span * 0.08;
  } else {
    const allVals = hasInvested ? data.concat(investedArr) : data;
    const lo = Math.min(...allVals);
    const hi = Math.max(...allVals);
    const span = hi - lo || 1;
    yMin = lo - span * 0.08;
    yMax = hi + span * 0.08;
  }

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

  // Invested-capital dashed reference line (value mode only, when data exists).
  const investedPath = (!isPerf && hasInvested)
    ? investedArr.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(' ')
    : null;

  const hoverIdx = hover?.idx;
  const focusIdx = hoverIdx != null ? hoverIdx : data.length - 1;

  // Summary (same in both modes):
  //   big number = portfolio value at focus
  //   %          = (value / invested - 1) * 100 at focus — total return ratio
  //   $          = value - invested at focus — total unrealized gain
  const focusVal = valueArr[focusIdx];
  const focusInvested = investedArr[focusIdx] ?? 0;
  const dollarChange = focusVal - focusInvested;
  const rangePctValid = Math.abs(focusInvested) > 1e-9;
  const pctChange = rangePctValid ? (dollarChange / focusInvested) * 100 : 0;
  const headerUp = dollarChange >= 0;

  // Line color = same signal as the headline % (green when total return positive).
  const lineColor = headerUp ? '#4ade80' : '#f87171';

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
    if (range === '1W') return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Bangkok' });
    if (range === '1M' || range === '3M') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' });
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' });
  };

  // valueArr / investedArr are already in display currency (USD or THB).
  // Format without further conversion — just attach the right symbol.
  const sym = cur.currency === 'THB' ? '฿' : '$';
  const fmtMoney = (v) => sym + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtMoneyCompact = (v) => {
    if (Math.abs(v) >= 1000) return sym + (v / 1000).toFixed(1) + 'K';
    return sym + v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  };

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

  const gradId = `g-${range}-${cur.currency}-${portfolio}-${mode}`;

  const fmtSignedAmount = (v) => {
    const abs = Math.abs(v);
    const sign = v >= 0 ? '+' : '-';
    return sign + sym + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const isEmpty = supabaseEnabled && !series && (!transactions || transactions.length === 0);

  if (isEmpty) {
    return (
      <div className="card chart-card">
        <div className="card-head">
          <div>
            <div className="card-title">Portfolio Return</div>
            <div className="card-sub">{portfolio === 'All' ? 'All portfolios' : portfolio}</div>
          </div>
        </div>
        <div style={{ display: 'grid', placeItems: 'center', height: 280, color: 'var(--text-faint)', fontSize: 13, textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 6 }}>No data yet</div>
            <div>Add a transaction to start tracking returns.</div>
          </div>
        </div>
      </div>
    );
  }

  const toggleMode = () => setMode(m => (m === 'value' ? 'performance' : 'value'));
  const modeLabel = isPerf ? 'Performance' : 'Portfolio Value';

  return (
    <div className="card chart-card">
      <div className="card-head">
        <div>
          <div className="card-title">Portfolio Return</div>
          <div className="card-sub" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>{portfolio === 'All' ? 'All portfolios' : portfolio} · {RANGES[range].label}</span>
            <button
              type="button"
              onClick={toggleMode}
              title="Switch chart mode"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 999,
                background: 'var(--panel-2)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 12, cursor: 'pointer',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 4h7l-2-2M10 8H3l2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>{modeLabel}</span>
            </button>
          </div>
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
            {fmtMoney(focusVal)}
          </div>
          <div className="num" style={{ fontSize: 13, marginTop: 6, color: headerUp ? 'var(--green)' : 'var(--red)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className={headerUp ? 'arrow-up' : 'arrow-down'}></span>
            <span>{rangePctValid ? `${headerUp ? '+' : ''}${pctChange.toFixed(2)}%` : '—'}</span>
            <span style={{ color: 'var(--text-faint)' }}>
              ({fmtSignedAmount(dollarChange)})
            </span>
          </div>
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

          {/* Zero baseline — drawn explicitly in performance mode so the user
              instantly sees the break-even line even when ticks don't land on 0. */}
          {isPerf && yMin <= 0 && yMax >= 0 && (
            <line
              x1={padL} x2={padL + plotW} y1={y(0)} y2={y(0)}
              stroke="var(--text-faint)" strokeWidth="1" strokeDasharray="3 4" opacity="0.6"
            />
          )}

          <path d={areaPath} fill={`url(#${gradId})`} />
          <path d={linePath} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {investedPath && (
            <path
              d={investedPath}
              fill="none"
              stroke="var(--text-faint)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {xTicks.map((t, i) => (
            <text key={i} className="axis-label" x={t.px} y={H - 8} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>
              {fmtDate(t.date)}
            </text>
          ))}

          {hover && (
            <g>
              <line className="hover-line" x1={x(hover.idx)} x2={x(hover.idx)} y1={padT} y2={padT + plotH} />
              <circle className="hover-dot" cx={x(hover.idx)} cy={y(data[hover.idx])} r="5" style={{ fill: lineColor }} />
              {investedPath && (
                <circle cx={x(hover.idx)} cy={y(investedArr[hover.idx])} r="4" style={{ fill: 'var(--text-faint)' }} />
              )}
            </g>
          )}
        </svg>

        {hover && (() => {
          const rect = wrapRef.current?.getBoundingClientRect();
          if (!rect) return null;
          const scaleX = rect.width / W;
          const tx = x(hover.idx) * scaleX;
          const ty = y(data[hover.idx]) * (rect.height / H);
          const dateStr = dates[hover.idx].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Bangkok' });
          return (
            <div className="tooltip" style={{ left: tx, top: ty }}>
              <div className="t-date">{dateStr}</div>
              {!isPerf && (
                <>
                  <div className="t-val">
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: lineColor, marginRight: 6 }}></span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 11, marginRight: 6 }}>Portfolio Value</span>
                    <span>{fmtMoney(valueArr[hover.idx])}</span>
                  </div>
                  {hasInvested && (
                    <div className="t-val">
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--text-faint)', marginRight: 6 }}></span>
                      <span style={{ color: 'var(--text-dim)', fontSize: 11, marginRight: 6 }}>Invested capital</span>
                      <span>{fmtMoney(investedArr[hover.idx])}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
