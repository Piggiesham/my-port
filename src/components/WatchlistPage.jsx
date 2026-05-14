import { useState, useMemo } from 'react';

const WATCH_FILTERS = ['All', 'Stocks', 'ETFs', 'Bonds', 'Crypto', 'Others'];

const WATCH_UNIVERSE = [
  { ticker: 'AAPL',  name: 'Apple Inc.',                type: 'Stock',  logo: { bg: '#1a1a1a', text: '' } },
  { ticker: 'NVDA',  name: 'NVIDIA Corporation',        type: 'Stock',  logo: { bg: '#76b900', text: 'N' } },
  { ticker: 'MSFT',  name: 'Microsoft Corporation',     type: 'Stock',  logo: { bg: '#0078d4', text: 'M' } },
  { ticker: 'TSLA',  name: 'Tesla Inc.',                type: 'Stock',  logo: { bg: '#cc0000', text: 'T' } },
  { ticker: 'META',  name: 'Meta Platforms Inc.',       type: 'Stock',  logo: { bg: '#0866ff', text: 'M' } },
  { ticker: 'QQQ',   name: 'Invesco QQQ Trust',         type: 'ETF',    logo: { bg: '#003366', text: 'Q' } },
  { ticker: 'SPY',   name: 'SPDR S&P 500 ETF',          type: 'ETF',    logo: { bg: '#143d8d', text: 'S' } },
  { ticker: 'IEF',   name: 'iShares 7-10 Yr Treasury',  type: 'Bond',   logo: { bg: '#1e293b', text: 'B' } },
  { ticker: 'TLT',   name: '20+ Year Treasury Bond',    type: 'Bond',   logo: { bg: '#1e293b', text: 'T' } },
  { ticker: 'SOL',   name: 'Solana',                    type: 'Crypto', logo: { bg: '#9945ff', text: 'S' } },
  { ticker: 'ADA',   name: 'Cardano',                   type: 'Crypto', logo: { bg: '#0033ad', text: 'A' } },
  { ticker: 'DOGE',  name: 'Dogecoin',                  type: 'Crypto', logo: { bg: '#c2a633', text: 'D' } },
  { ticker: 'XAU',   name: 'Gold Spot',                 type: 'Other',  logo: { bg: '#d4af37', text: 'Au' } },
  { ticker: 'OIL',   name: 'Crude Oil Futures',         type: 'Other',  logo: { bg: '#1a1a1a', text: 'O' } },
];

const TYPE_TO_FILTER = { Stock: 'Stocks', ETF: 'ETFs', Bond: 'Bonds', Crypto: 'Crypto', Other: 'Others' };

export default function WatchlistPage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');

  const results = useMemo(() => {
    return WATCH_UNIVERSE.filter(a => {
      if (filter !== 'All' && TYPE_TO_FILTER[a.type] !== filter) return false;
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    });
  }, [query, filter]);

  return (
    <div>
      <div className="watch-header">
        <div className="watch-search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder="Search stocks, ETFs, bonds, crypto, and more…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ color: 'var(--text-faint)', fontSize: 14 }}>✕</button>
          )}
        </div>
        <div className="watch-filters">
          {WATCH_FILTERS.map(f => (
            <button key={f} className={f === filter ? 'active' : ''} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      </div>

      {query.trim() && (
        <div>
          <div className="watch-results-hint">
            {results.length === 0
              ? <>No results for “{query}”.</>
              : <>Showing {results.length} {results.length === 1 ? 'match' : 'matches'} for “{query}”{filter !== 'All' ? ` in ${filter}` : ''}.</>
            }
          </div>
          {results.map(a => (
            <div className="watch-result" key={a.ticker}>
              <div className="logo" style={{ background: a.logo.bg, color: 'white' }}>{a.logo.text || a.ticker[0]}</div>
              <div className="info">
                <div className="t">{a.ticker}</div>
                <div className="n">{a.name}</div>
              </div>
              <span className="type-tag">{a.type}</span>
              <button className="pill-btn" style={{ padding: '7px 12px', fontSize: 12 }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                <span>Watch</span>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="empty-tab" style={{ marginTop: query.trim() ? 24 : 0 }}>
        <div className="empty-icon">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <path d="M16 4l3.7 7.5 8.3 1.2-6 5.8 1.4 8.3L16 22.9l-7.4 3.9 1.4-8.3-6-5.8 8.3-1.2L16 4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="empty-title">Watchlist</div>
        <div className="empty-sub">This section is under construction. Check back soon —<br />the search above is a preview of what's coming.</div>
      </div>
    </div>
  );
}
