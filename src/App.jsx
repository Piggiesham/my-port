import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react';
import { CurrencyContext, SOURCES, PORTFOLIOS, ASSETS as MOCK_ASSETS, TRANSACTIONS as MOCK_TRANSACTIONS, totalsFor, fmtCurrency, FX_RATE, setFxRate, fmtDateBkk } from './data.js';
import { fetchTransactions, fetchFxRate, fetchPriceMap, fetchAssetCatalog, computeAssetsFromTransactions, computeThbCostByKey } from './lib/api.js';
import { supabaseEnabled } from './lib/supabase.js';
import ReturnChart from './components/ReturnChart.jsx';
import PieChart from './components/PieChart.jsx';
import AssetList from './components/AssetList.jsx';
import TransactionsPage from './components/TransactionsPage.jsx';
import WatchlistPage from './components/WatchlistPage.jsx';

export default function App() {
  const [navTab, setNavTab] = useState('Overview');
  const [currency, setCurrency] = useState('USD');
  const [portfolio, setPortfolio] = useState('All');
  const [bellOpen, setBellOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [assets, setAssets] = useState(supabaseEnabled ? [] : MOCK_ASSETS);
  const [transactions, setTransactions] = useState(supabaseEnabled ? [] : MOCK_TRANSACTIONS);
  const [priceMap, setPriceMap] = useState({});
  const [fxRate, setFxRateState] = useState(FX_RATE);
  const [chartSummary, setChartSummary] = useState(null); // { value, invested, gain, pct } from ReturnChart, display currency
  const bellRef = useRef(null);
  const navDdRef = useRef(null);

  const refreshFromSupabase = useCallback(async () => {
    if (!supabaseEnabled) return;
    try {
      const [txs, catalog, prices] = await Promise.all([
        fetchTransactions(),
        fetchAssetCatalog(),
        fetchPriceMap(),
      ]);
      setTransactions(txs ?? []);
      setPriceMap(prices ?? {});
      const derived = computeAssetsFromTransactions(txs ?? [], catalog ?? [], prices ?? {});
      const total = derived.reduce((s, a) => s + a.holdingUSD, 0) || 1;
      setAssets(derived.map(a => ({ ...a, alloc: (a.holdingUSD / total) * 100 })));
    } catch (err) {
      console.error('[Supabase] refresh failed', err);
    }
  }, []);

  useEffect(() => {
    if (!supabaseEnabled) return;
    refreshFromSupabase();
    fetchFxRate().then(rate => {
      setFxRate(rate);       // updates the module-level binding read by fmtCurrency
      setFxRateState(rate);  // forces a re-render so values reflect the new rate
    }).catch(err => console.error('[Supabase] fetchFxRate failed', err));
  }, [refreshFromSupabase]);

  // Drop the chart summary when the unit/scope changes so the hero falls back
  // to its own totals for the one frame before ReturnChart re-reports — avoids
  // showing the prior currency's invested figure under the new symbol.
  useEffect(() => { setChartSummary(null); }, [currency, portfolio]);

  const ctx = useMemo(() => ({ currency, setCurrency, fxRate }), [currency, fxRate]);

  const portfolios = useMemo(() => {
    const set = new Set(transactions.map(t => t.source).filter(Boolean));
    const dynamic = [...set];
    return ['All', ...(dynamic.length > 0 ? dynamic : PORTFOLIOS.filter(p => p !== 'All'))];
  }, [transactions]);

  // Per (source, ticker) historical-FX baht cost, used by AssetList for the
  // Avg Cost column in THB mode. See docs/adr/0002-average-cost-uses-historical-fx.md.
  const thbCostByKey = useMemo(() => computeThbCostByKey(transactions), [transactions]);

  // PieChart and AssetList need different shapes on "All":
  //  - PieChart wants raw rows so the "By Source" breakdown still segments
  //    per brokerage (combining would collapse it into one "Multiple" slice).
  //  - AssetList wants same-ticker rows merged into one line tagged "Multiple"
  //    (the user-facing combined-ticker view).
  // Per-brokerage views never combine (one row per ticker per brokerage).
  // See CONTEXT.md → "Combined-ticker view".
  const filteredAssetsRaw = useMemo(() => {
    const base = portfolio === 'All'
      ? assets
      : assets.filter(a => a.source === portfolio);
    const total = base.reduce((s, a) => s + a.holdingUSD, 0) || 1;
    const annotated = base.map(a => {
      const key = `${a.source}|${a.ticker}`;
      const thb = thbCostByKey.get(key);
      return {
        ...a,
        alloc: (a.holdingUSD / total) * 100,
        thbAvgCost: thb ? thb.thbPerShare : null,
        thbApprox:  thb ? thb.approx     : false,
      };
    });
    return annotated;
  }, [portfolio, assets, thbCostByKey]);

  const filteredAssetsCombined = useMemo(() => {
    if (portfolio !== 'All') return filteredAssetsRaw;
    // Merge same-ticker rows: sum qty + cost-basis dollars, derive per-share
    // avg, blend historical-FX baht cost across contributors, source = 'Multiple'
    // when >1 brokerage. Keeps holdingUSD/plUSD/pctProfit/alloc consistent.
    const byTicker = new Map();
    for (const a of filteredAssetsRaw) {
      const cur = byTicker.get(a.ticker);
      if (!cur) { byTicker.set(a.ticker, { ...a, _sources: [a.source], _costTotal: a.qty * a.cost, _thbCostTotal: (a.thbAvgCost ?? 0) * a.qty, _thbApprox: !!a.thbApprox }); continue; }
      cur.qty        += a.qty;
      cur.holdingUSD += a.holdingUSD;
      cur.plUSD      += a.plUSD;
      cur.alloc      += a.alloc;
      cur._costTotal += a.qty * a.cost;
      cur._thbCostTotal += (a.thbAvgCost ?? 0) * a.qty;
      cur._thbApprox = cur._thbApprox || !!a.thbApprox;
      if (!cur._sources.includes(a.source)) cur._sources.push(a.source);
    }
    return [...byTicker.values()].map(m => {
      const cost = m.qty > 0 ? m._costTotal / m.qty : m.cost;
      const costTotal = m._costTotal;
      const pctProfit = costTotal > 0 ? (m.plUSD / costTotal) * 100 : 0;
      const thbAvgCost = m.qty > 0 ? m._thbCostTotal / m.qty : null;
      const source = m._sources.length > 1 ? 'Multiple' : m._sources[0];
      return { ...m, cost, costTotal, pctProfit, thbAvgCost, thbApprox: m._thbApprox, source };
    });
  }, [portfolio, filteredAssetsRaw]);

  // Totals derive from the un-combined rows so any subtle rounding stays
  // consistent with the chart and PieChart.
  const { now: totalNow, cost: totalCost } = useMemo(() => totalsFor(filteredAssetsRaw), [filteredAssetsRaw]);

  // All-time return mirrors the ReturnChart summary so the hero never disagrees
  // with the chart below it — notably in THB mode, where the chart values
  // invested capital at each deposit's FX (capturing conversion gain) rather
  // than today's FX × USD cost. Falls back to the USD cost-basis figure when
  // the chart has no real series (mock / empty state).
  const heroSym = currency === 'THB' ? '฿' : '$';
  const totalNowDisplay = currency === 'THB' ? totalNow * fxRate : totalNow;
  const heroInvested = chartSummary
    ? chartSummary.invested
    : (currency === 'THB' ? totalCost * fxRate : totalCost);
  const totalGain = totalNowDisplay - heroInvested;
  const totalReturn = heroInvested > 1e-9 ? (totalGain / heroInvested) * 100 : 0;
  const gainUp = totalGain >= 0;
  const heroValue = fmtCurrency(totalNow, currency, { decimals: 2 });
  const heroGain = heroSym + Math.abs(totalGain).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  useEffect(() => {
    const onClick = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
      if (navDdRef.current && !navDdRef.current.contains(e.target)) setNavOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const navItems = ['Overview', 'Transactions', 'Watchlist'];

  return (
    <CurrencyContext.Provider value={ctx}>
      <div className="app">
        <div className="topbar">
          <div className="brand">
            <span className="brand-text">my-port</span>
          </div>
          <div className="nav nav-desktop">
            {navItems.map((t) =>
              <button key={t} className={t === navTab ? 'active' : ''} onClick={() => setNavTab(t)}>{t}</button>
            )}
          </div>
          <div className="nav-mobile dropdown" ref={navDdRef}>
            <button className={`dropdown-btn${navOpen ? ' open' : ''}`} onClick={() => setNavOpen(o => !o)}>
              <span>{navTab}</span>
              <svg className="caret" width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {navOpen && (
              <div className="dropdown-menu">
                {navItems.map(t => (
                  <button key={t} className={`dropdown-item${t === navTab ? ' selected' : ''}`}
                    onClick={() => { setNavTab(t); setNavOpen(false); }}>
                    <span>{t}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="topbar-right">
            <div className="cur-toggle" role="tablist" aria-label="Currency">
              <button className={currency === 'USD' ? 'active' : ''} onClick={() => setCurrency('USD')}>USD</button>
              <button className={currency === 'THB' ? 'active' : ''} onClick={() => setCurrency('THB')}>THB</button>
            </div>
            <div className="bell" ref={bellRef}>
              <button className={`bell-btn${bellOpen ? ' active' : ''}`} aria-label="Notifications" onClick={() => setBellOpen(o => !o)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3.5 12V7.5a4.5 4.5 0 0 1 9 0V12l1 1.5h-11L3.5 12z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                  <path d="M6.5 14.2a1.6 1.6 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                <span className="bell-dot"></span>
              </button>
              {bellOpen && (
                <div className="bell-pop">
                  <div className="bell-empty">
                    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                      <path d="M9 30V18a11 11 0 0 1 22 0v12l3 4H6l3-4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                      <path d="M16 35a4 4 0 0 0 8 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                    <div>
                      <h4>Notifications</h4>
                      <p>This section is under construction. Check back soon.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {navTab === 'Overview' && (
          <Fragment>
            <div className="hero">
              <div className="hero-left">
                <div className="label">{portfolio === 'All' ? 'Total Portfolio Value' : `${portfolio} Value`}</div>
                <div className="hero-value">{heroValue}</div>
                <div className="hero-delta" style={{ color: gainUp ? 'var(--green)' : 'var(--red)' }}>
                  <span className="chip" style={{ background: gainUp ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)' }}>{gainUp ? '↗' : '↘'} {gainUp ? '+' : ''}{totalReturn.toFixed(2)}%</span>
                  <span>{gainUp ? '+' : '-'}{heroGain} all-time</span>
                  <span style={{ color: 'var(--text-faint)' }}>· Updated just now</span>
                </div>
              </div>
              <div className="hero-actions">
                <button className="pill-btn" onClick={() => setNavTab('Transactions')}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  <span>Add transaction</span>
                </button>
                <button className="pill-btn">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 11V3m0 0L4 6m3-3l3 3M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span>Export</span>
                </button>
              </div>
            </div>

            <div className="portfolio-tabs" style={{ marginBottom: 20 }}>
              {portfolios.map(p => (
                <button key={p} className={p === portfolio ? 'active' : ''} onClick={() => setPortfolio(p)}>
                  {p !== 'All' && <span className="src-dot" style={{ background: SOURCES[p]?.color || '#888' }}></span>}
                  <span>{p === 'All' ? 'All portfolios' : p}</span>
                </button>
              ))}
            </div>

            <div className="grid">
              <ReturnChart
                portfolio={portfolio}
                totalNow={totalNow}
                transactions={portfolio === 'All' ? transactions : transactions.filter(t => t.source === portfolio)}
                priceMap={priceMap}
                onSummary={setChartSummary}
              />
              <PieChart assets={filteredAssetsRaw} totalNow={totalNow} portfolio={portfolio} />
            </div>

            <AssetList assets={filteredAssetsCombined} portfolio={portfolio} />

            <div className="foot">Prices simulated · Not financial advice · {fmtDateBkk(new Date(), { dateStyle: 'long' })}</div>
          </Fragment>
        )}

        {navTab === 'Transactions' && (
          <TransactionsPage
            transactions={transactions}
            assets={assets}
            onTransactionAdded={refreshFromSupabase}
          />
        )}
        {navTab === 'Watchlist' && <WatchlistPage />}
      </div>
    </CurrencyContext.Provider>
  );
}

