import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react';
import { CurrencyContext, SOURCES, PORTFOLIOS, ASSETS as MOCK_ASSETS, TRANSACTIONS as MOCK_TRANSACTIONS, totalsFor, fmtCurrency, FX_RATE, setFxRate } from './data.js';
import { fetchTransactions, fetchFxRate, fetchPriceMap, fetchAssetCatalog, computeAssetsFromTransactions } from './lib/api.js';
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

  const ctx = useMemo(() => ({ currency, setCurrency, fxRate }), [currency, fxRate]);

  const portfolios = useMemo(() => {
    const set = new Set(transactions.map(t => t.source).filter(Boolean));
    const dynamic = [...set];
    return ['All', ...(dynamic.length > 0 ? dynamic : PORTFOLIOS.filter(p => p !== 'All'))];
  }, [transactions]);

  const filteredAssets = useMemo(() => {
    if (portfolio === 'All') return assets;
    const filtered = assets.filter(a => a.source === portfolio);
    const total = filtered.reduce((s, a) => s + a.holdingUSD, 0) || 1;
    return filtered.map(a => ({ ...a, alloc: (a.holdingUSD / total) * 100 }));
  }, [portfolio, assets]);

  const { now: totalNow, cost: totalCost } = useMemo(() => totalsFor(filteredAssets), [filteredAssets]);

  const totalReturn = totalCost > 0 ? ((totalNow - totalCost) / totalCost) * 100 : 0;
  const totalGain = totalNow - totalCost;
  const heroValue = fmtCurrency(totalNow, currency, { decimals: 2 });
  const heroGain = fmtCurrency(Math.abs(totalGain), currency, { decimals: 2 });
  const gainUp = totalGain >= 0;

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
            <div className="brand-dot">P</div>
            <span className="brand-text">My Port</span>
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
                totalCost={totalCost}
                transactions={portfolio === 'All' ? transactions : transactions.filter(t => t.source === portfolio)}
                priceMap={priceMap}
              />
              <PieChart assets={filteredAssets} totalNow={totalNow} portfolio={portfolio} />
            </div>

            <AssetList assets={filteredAssets} portfolio={portfolio} />

            <div className="foot">Prices simulated · Not financial advice · {new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}</div>
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

