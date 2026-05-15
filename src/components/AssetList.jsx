import { useState, useMemo, useRef, useEffect, useContext } from 'react';
import { CurrencyContext, ASSETS, SOURCES, fmtCurrency, fmtCurrencyCode } from '../data.js';

const SORT_OPTIONS = [
  { key: 'holdingUSD', label: 'Holding Value' },
  { key: 'pctProfit',  label: '% Profit' },
  { key: 'plUSD',      label: 'P/L Amount' },
  { key: 'alloc',      label: 'Allocation' },
  { key: 'price',      label: 'Market Price' },
  { key: 'ticker',     label: 'Ticker (A-Z)' },
];

export default function AssetList({ assets = ASSETS, portfolio = 'All' }) {
  const cur = useContext(CurrencyContext);
  const fx = cur.fxRate || 32.27;
  const [sortKey, setSortKey] = useState('holdingUSD');
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (sortRef.current && !sortRef.current.contains(e.target)) setSortOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const sorted = useMemo(() => {
    const arr = [...assets];
    if (sortKey === 'ticker') {
      arr.sort((a, b) => a.ticker.localeCompare(b.ticker));
    } else {
      arr.sort((a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0));
    }
    return arr;
  }, [sortKey, assets]);

  const fmtPrice = (a) => {
    if (a.isCash) return '—';
    const v = a.price * (cur.currency === 'THB' ? fx : 1);
    return v >= 1000 ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toFixed(2);
  };

  const altCurrency = cur.currency === 'USD' ? 'THB' : 'USD';
  const fmtAltHolding = (usd) => {
    const v = altCurrency === 'THB' ? usd * fx : usd;
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + altCurrency;
  };

  return (
    <div className="card list-card">
      <div className="list-controls">
        <div style={{ position: 'relative' }} ref={sortRef}>
          <button className="pill-btn" onClick={() => setSortOpen(o => !o)}>
            <span className="dim">Sort by:</span>
            <span className="b">{SORT_OPTIONS.find(o => o.key === sortKey).label}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: 'var(--text-dim)', transition: 'transform 0.18s', transform: sortOpen ? 'rotate(180deg)' : 'none' }}>
              <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {sortOpen && (
            <div className="dropdown-menu" style={{ left: 0, right: 'auto', minWidth: 220 }}>
              {SORT_OPTIONS.map(o => (
                <button key={o.key} className={`dropdown-item${o.key === sortKey ? ' selected' : ''}`} onClick={() => { setSortKey(o.key); setSortOpen(false); }}>
                  <span>{o.label}</span>
                  {o.key === sortKey && <span style={{ color: 'var(--accent)' }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

      </div>

      <div className="list-head">
        <div>{assets.length} {assets.length === 1 ? 'asset' : 'assets'}{portfolio !== 'All' ? ` · ${portfolio}` : ''}</div>
        <div>Market Price ({fmtCurrencyCode(cur.currency)})</div>
        <div>Holding Value ({fmtCurrencyCode(cur.currency)})</div>
        <div>% Profit &amp; Amount</div>
      </div>

      {sorted.length === 0 ? (
        <div className="tx-empty-search">No assets in {portfolio}.</div>
      ) : sorted.map((a) => {
        const up = a.pctProfit >= 0;
        const src = SOURCES[a.source];
        const plMain = fmtCurrency(Math.abs(a.plUSD), cur.currency, { decimals: 2, showCode: true });

        return (
          <div className="row" key={a.ticker + a.source}>
            <div className="asset">
              <div className="logo" style={{ background: a.logo.bg, color: a.logo.dark ? '#0a0a0b' : 'white' }}>
                <span className={a.logo.small ? 'small-text' : ''}>{a.logo.text}</span>
              </div>
              <div className="asset-meta">
                <div className="ticker">{a.ticker}</div>
                <div className="sub">
                  <span className="type-tag">{a.type}</span>
                  <span className="source-tag">
                    <span className="src-dot" style={{ background: src.color }}></span>
                    {a.source}
                  </span>
                  <span className="alloc">
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                      <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1"/>
                      <path d="M5.5 1.5 A4 4 0 0 1 9.5 5.5 L5.5 5.5 Z" fill="currentColor"/>
                    </svg>
                    {a.alloc.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="cell-r" data-label="Price">
              <div>
                <div className="price-main">{fmtPrice(a)}</div>
                <div className="price-sub">{fmtCurrencyCode(cur.currency)}</div>
              </div>
            </div>

            <div className="cell-r" data-label="Holding">
              <div>
                <div className="price-main">{a.holdingUSD === 0 ? '0.00' : (cur.currency === 'THB' ? (a.holdingUSD * fx) : a.holdingUSD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div className="price-sub">≈ {fmtAltHolding(a.holdingUSD)}</div>
              </div>
            </div>

            <div className="cell-r" data-label="P/L">
              <div>
                <div className={`pct ${up ? 'up' : 'down'}`} style={a.pctProfit === 0 ? { color: 'var(--text-dim)' } : undefined}>
                  {a.pctProfit !== 0 && <span className={up ? 'arrow-up' : 'arrow-down'}></span>}
                  <span>{a.pctProfit.toFixed(2)}%</span>
                </div>
                <div className={`pct-sub ${up ? 'up' : 'down'}`} style={a.pctProfit === 0 ? { color: 'var(--text-faint)' } : undefined}>
                  ({a.plUSD === 0 ? '—' : (a.plUSD > 0 ? '+' : '-') + plMain})
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
