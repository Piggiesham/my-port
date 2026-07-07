import { useState, useMemo, useRef, useEffect } from 'react';
import { SOURCES, PORTFOLIOS, RANGES } from '../data.js';
import { fetchPriceHistory, computeDailyReturnSeries } from '../lib/api.js';
import { computeTwrSeries, computeBenchmarkSeries, maxDrawdown, annualizedVolatility } from '../lib/performance.js';
import { supabaseEnabled } from '../lib/supabase.js';
import { useClickOutside } from '../lib/useClickOutside.js';

// USD ETF proxies only — same currency as the portfolio, fetched through the
// regular price_history pipeline. Price return (dividends excluded), so the
// benchmark line understates its index's total return by ~1–1.5pp/yr.
const BENCHMARKS = [
  { ticker: 'SPY', label: 'S&P 500' },
  { ticker: 'QQQ', label: 'Nasdaq 100' },
  { ticker: 'EWJ', label: 'Japan (MSCI)' },
  { ticker: 'THD', label: 'Thailand (MSCI)' },
  { ticker: 'VT',  label: 'Total World' },
];

const RANGE_DAYS = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, 'ALL': Infinity };
const BENCH_COLOR = '#7dd3fc';

const fmtPct = (v, digits = 2) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`);

export default function PerformancePage({ transactions = [] }) {
  const [portfolio, setPortfolio] = useState('All');
  const [benchmark, setBenchmark] = useState('SPY');
  const [range, setRange] = useState('1Y');
  const [benchOpen, setBenchOpen] = useState(false);
  const [hover, setHover] = useState(null);
  const [loaded, setLoaded] = useState(null); // { twr, bench } or null while loading
  const benchRef = useRef(null);
  const wrapRef = useRef(null);
  useClickOutside(benchRef, () => setBenchOpen(false));

  useEffect(() => { setHover(null); }, [portfolio, range, benchmark]);

  const portfolios = useMemo(() => {
    const set = new Set(transactions.map(t => t.source).filter(Boolean));
    const dynamic = [...set];
    return ['All', ...(dynamic.length > 0 ? dynamic : PORTFOLIOS.filter(p => p !== 'All'))];
  }, [transactions]);

  const filteredTxs = useMemo(
    () => portfolio === 'All' ? transactions : transactions.filter(t => t.source === portfolio),
    [transactions, portfolio]
  );

  useEffect(() => {
    if (!supabaseEnabled || filteredTxs.length === 0) { setLoaded(null); return; }
    let cancelled = false;
    const days = RANGE_DAYS[range];
    const earliestTxMs = Math.min(...filteredTxs.map(t => new Date(t.date).getTime()));
    const to = new Date();
    const from = range === 'YTD'
      ? new Date(Math.max(earliestTxMs, new Date(new Date().getFullYear(), 0, 1).getTime()))
      : isFinite(days)
        ? new Date(Math.max(earliestTxMs, Date.now() - days * 86400000))
        : new Date(earliestTxMs);
    const tickers = [...new Set([...filteredTxs.map(t => t.ticker).filter(Boolean), 'THB', benchmark])];

    setLoaded(null);
    fetchPriceHistory(tickers, from, to).then(hist => {
      if (cancelled) return;
      const daily = computeDailyReturnSeries(filteredTxs, hist, from, to);
      if (daily.length < 2) return;
      const twr = computeTwrSeries(daily);
      if (twr.length < 2) return;
      const bench = computeBenchmarkSeries(hist.get(benchmark), twr.map(p => p.date));
      setLoaded({ twr, bench });
    }).catch(err => console.warn('[PerformancePage] series failed', err));

    return () => { cancelled = true; };
  }, [filteredTxs, range, benchmark]);

  const twr = loaded?.twr;
  const bench = loaded?.bench;

  const kpis = useMemo(() => {
    if (!twr) return null;
    const twrEnd = twr[twr.length - 1].pct;
    const benchVals = (bench ?? []).filter(p => p.pct != null);
    const benchEnd = benchVals.length >= 2 ? benchVals[benchVals.length - 1].pct : null;
    return {
      twr: twrEnd,
      delta: benchEnd == null ? null : twrEnd - benchEnd,
      drawdown: maxDrawdown(twr),
      vol: annualizedVolatility(twr),
    };
  }, [twr, bench]);

  const benchLabel = BENCHMARKS.find(b => b.ticker === benchmark)?.label ?? benchmark;

  // ---- chart geometry (same idiom as ReturnChart) ---------------------------
  const W = 800, H = 280;
  const padL = 8, padR = 72, padT = 16, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allPcts = useMemo(() => {
    if (!twr) return [0];
    const vals = twr.map(p => p.pct);
    for (const p of bench ?? []) if (p.pct != null) vals.push(p.pct);
    vals.push(0); // keep the zero baseline in view
    return vals;
  }, [twr, bench]);

  const lo = Math.min(...allPcts), hi = Math.max(...allPcts);
  const span = hi - lo || 1;
  const yMin = lo - span * 0.08, yMax = hi + span * 0.08;
  const y = v => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const tStart = twr ? twr[0].date.getTime() : 0;
  const tEnd = twr ? twr[twr.length - 1].date.getTime() : 1;
  const tSpan = tEnd - tStart || 1;
  const x = (d) => padL + ((d.getTime() - tStart) / tSpan) * plotW;

  const pathFor = (pts) => {
    let path = '';
    let pen = false;
    for (const p of pts) {
      if (p.pct == null) { pen = false; continue; }
      path += `${pen ? 'L' : 'M'} ${x(p.date).toFixed(2)} ${y(p.pct).toFixed(2)} `;
      pen = true;
    }
    return path.trim() || null;
  };

  const twrPath = twr ? pathFor(twr) : null;
  const benchPath = bench ? pathFor(bench) : null;
  const up = (kpis?.twr ?? 0) >= 0;
  const lineColor = up ? '#4ade80' : '#f87171';

  const yTicks = useMemo(() => {
    const ticks = [];
    for (let i = 0; i <= 4; i++) ticks.push(yMin + ((yMax - yMin) * i) / 4);
    return ticks;
  }, [yMin, yMax]);

  const xTicks = useMemo(() => {
    if (!twr) return [];
    const mobile = typeof window !== 'undefined' && window.innerWidth < 600;
    const n = Math.min(mobile ? 3 : 5, twr.length);
    const ticks = [];
    for (let i = 0; i < n; i++) {
      const t = tStart + (tSpan * i) / (n - 1);
      ticks.push({ px: padL + ((t - tStart) / tSpan) * plotW, date: new Date(t) });
    }
    return ticks;
  }, [twr, tStart, tSpan, plotW]);

  const fmtDate = (d) => {
    if (range === '1W') return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Bangkok' });
    if (range === '1M' || range === '3M') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' });
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' });
  };

  const onMove = (e) => {
    if (!twr) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (W / rect.width);
    if (px < padL || px > padL + plotW) { setHover(null); return; }
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < twr.length; i++) {
      const dist = Math.abs(x(twr[i].date) - px);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    setHover({ idx: best });
  };

  const isEmpty = !supabaseEnabled || filteredTxs.length === 0;

  return (
    <div className="perf-page">
      <div className="portfolio-tabs" style={{ marginBottom: 20 }}>
        {portfolios.map(p => (
          <button key={p} className={p === portfolio ? 'active' : ''} onClick={() => setPortfolio(p)}>
            {p !== 'All' && <span className="src-dot" style={{ background: SOURCES[p]?.color || '#888' }}></span>}
            <span>{p === 'All' ? 'All portfolios' : p}</span>
          </button>
        ))}
      </div>

      <div className="card chart-card">
        <div className="card-head">
          <div>
            <div className="card-title">Time-Weighted Return</div>
            <div className="card-sub" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span>{portfolio === 'All' ? 'All portfolios' : portfolio} · {RANGES[range].label}</span>
              <div className="dropdown" ref={benchRef}>
                <button className={`dropdown-btn${benchOpen ? ' open' : ''}`} onClick={() => setBenchOpen(o => !o)}
                  style={{ fontSize: 12, padding: '4px 10px' }}>
                  <span>vs {benchLabel}</span>
                  <svg className="caret" width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {benchOpen && (
                  <div className="dropdown-menu">
                    {BENCHMARKS.map(b => (
                      <button key={b.ticker} className={`dropdown-item${b.ticker === benchmark ? ' selected' : ''}`}
                        onClick={() => { setBenchmark(b.ticker); setBenchOpen(false); }}>
                        <span>{b.label} ({b.ticker})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="ranges">
            {Object.keys(RANGES).map(r => (
              <button key={r} className={r === range ? 'active' : ''} onClick={() => { setRange(r); setHover(null); }}>{r}</button>
            ))}
          </div>
        </div>

        {isEmpty ? (
          <div style={{ display: 'grid', placeItems: 'center', height: 280, color: 'var(--text-faint)', fontSize: 13, textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 6 }}>No data yet</div>
              <div>{supabaseEnabled ? 'Add a transaction to start tracking performance.' : 'Performance needs live price history (Supabase).'}</div>
            </div>
          </div>
        ) : !twr ? (
          <div style={{ display: 'grid', placeItems: 'center', height: 280, color: 'var(--text-faint)', fontSize: 13 }}>
            Loading price history…
          </div>
        ) : (
          <>
            <div className="chart-summary">
              <div className="chart-summary-left">
                <div className="num" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: up ? 'var(--green)' : 'var(--red)' }}>
                  {fmtPct(kpis.twr)}
                </div>
                <div className="num" style={{ fontSize: 13, marginTop: 6, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: BENCH_COLOR }}></span>
                  <span>{benchLabel} {fmtPct((bench ?? []).filter(p => p.pct != null).slice(-1)[0]?.pct ?? null)}</span>
                </div>
              </div>
            </div>

            <div className="chart-wrap" ref={wrapRef}>
              <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
                {yTicks.map((v, i) => (
                  <g key={i}>
                    <line className="grid-line" x1={padL} x2={padL + plotW} y1={y(v)} y2={y(v)} />
                    <text className="axis-label" x={padL + plotW + 8} y={y(v) + 4} textAnchor="start">
                      {v.toFixed(Math.abs(yMax - yMin) < 5 ? 1 : 0)}%
                    </text>
                  </g>
                ))}

                {yMin <= 0 && yMax >= 0 && (
                  <line x1={padL} x2={padL + plotW} y1={y(0)} y2={y(0)}
                    stroke="var(--text-faint)" strokeWidth="1" strokeDasharray="3 4" opacity="0.6" />
                )}

                {benchPath && (
                  <path d={benchPath} fill="none" stroke={BENCH_COLOR} strokeWidth="1.5" opacity="0.9"
                    strokeLinejoin="round" strokeLinecap="round" />
                )}
                {twrPath && (
                  <path d={twrPath} fill="none" stroke={lineColor} strokeWidth="2"
                    strokeLinejoin="round" strokeLinecap="round" />
                )}

                {xTicks.map((t, i) => (
                  <text key={i} className="axis-label" x={t.px} y={H - 8} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>
                    {fmtDate(t.date)}
                  </text>
                ))}

                {hover && (
                  <g>
                    <line className="hover-line" x1={x(twr[hover.idx].date)} x2={x(twr[hover.idx].date)} y1={padT} y2={padT + plotH} />
                    <circle className="hover-dot" cx={x(twr[hover.idx].date)} cy={y(twr[hover.idx].pct)} r="5" style={{ fill: lineColor }} />
                    {bench?.[hover.idx]?.pct != null && (
                      <circle cx={x(bench[hover.idx].date)} cy={y(bench[hover.idx].pct)} r="4" style={{ fill: BENCH_COLOR }} />
                    )}
                  </g>
                )}
              </svg>

              {hover && (() => {
                const rect = wrapRef.current?.getBoundingClientRect();
                if (!rect) return null;
                const p = twr[hover.idx];
                const b = bench?.[hover.idx];
                return (
                  <div className="tooltip" style={{ left: x(p.date) * (rect.width / W), top: y(p.pct) * (rect.height / H) }}>
                    <div className="t-date">{p.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Bangkok' })}</div>
                    <div className="t-val">
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: lineColor, marginRight: 6 }}></span>
                      <span style={{ color: 'var(--text-dim)', fontSize: 11, marginRight: 6 }}>Portfolio</span>
                      <span>{fmtPct(p.pct)}</span>
                    </div>
                    <div className="t-val">
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: BENCH_COLOR, marginRight: 6 }}></span>
                      <span style={{ color: 'var(--text-dim)', fontSize: 11, marginRight: 6 }}>{benchLabel}</span>
                      <span>{fmtPct(b?.pct ?? null)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </>
        )}
      </div>

      {!isEmpty && kpis && (
        <div className="perf-kpis">
          <div className="card perf-kpi">
            <div className="perf-kpi-label">TWR · {RANGES[range].label}</div>
            <div className="num perf-kpi-value" style={{ color: kpis.twr >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtPct(kpis.twr)}</div>
          </div>
          <div className="card perf-kpi">
            <div className="perf-kpi-label">vs {benchLabel}</div>
            <div className="num perf-kpi-value" style={{ color: kpis.delta == null ? 'var(--text-dim)' : kpis.delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {kpis.delta == null ? '—' : `${kpis.delta >= 0 ? '+' : ''}${kpis.delta.toFixed(2)} pp`}
            </div>
          </div>
          <div className="card perf-kpi">
            <div className="perf-kpi-label">Max drawdown</div>
            <div className="num perf-kpi-value">{kpis.drawdown == null ? '—' : `${kpis.drawdown.toFixed(2)}%`}</div>
          </div>
          <div className="card perf-kpi">
            <div className="perf-kpi-label">Volatility (ann.)</div>
            <div className="num perf-kpi-value">{kpis.vol == null ? '—' : `${kpis.vol.toFixed(1)}%`}</div>
          </div>
        </div>
      )}

      <div className="foot">Benchmark is ETF price return — dividends excluded (~1–1.5pp/yr) · Not financial advice</div>
    </div>
  );
}
