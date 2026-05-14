import { useState, useMemo, useRef, useEffect, useContext, Fragment } from 'react';
import { CurrencyContext, ASSETS as MOCK_ASSETS, SOURCES, TRANSACTIONS as MOCK_TRANSACTIONS, FX_RATE, fmtCurrency, fmtCurrencySym, fmtCurrencyCode } from '../data.js';

const TX_SORT_OPTIONS = [
  { key: 'date_desc',  label: 'Date (newest first)' },
  { key: 'date_asc',   label: 'Date (oldest first)' },
  { key: 'value_desc', label: 'Value (high → low)' },
  { key: 'value_asc',  label: 'Value (low → high)' },
  { key: 'ticker',     label: 'Asset (A → Z)' },
  { key: 'action',     label: 'Action type' },
  { key: 'source',     label: 'Brokerage' },
];

const PORTFOLIO_TYPES = {
  'Dime!':   ['Security', 'Bond', 'Cash'],
  'Webull':  ['Security', 'Bond', 'Cash'],
  'Binance': ['Crypto', 'Cash'],
};

export default function TransactionsPage({ transactions = MOCK_TRANSACTIONS, assets = MOCK_ASSETS }) {
  const cur = useContext(CurrencyContext);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('date_desc');
  const [sortOpen, setSortOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const sortRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (sortRef.current && !sortRef.current.contains(e.target)) setSortOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (showModal) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [showModal]);

  const assetMap = useMemo(() => {
    const m = {};
    for (const a of assets) m[a.ticker] = a;
    return m;
  }, [assets]);

  const items = useMemo(() => {
    let arr = transactions.filter(t => {
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      const a = assetMap[t.ticker];
      return (
        t.ticker.toLowerCase().includes(q) ||
        (a?.name || '').toLowerCase().includes(q) ||
        t.action.toLowerCase().includes(q) ||
        t.source.toLowerCase().includes(q)
      );
    });
    const sorters = {
      date_desc:  (a, b) => new Date(b.date) - new Date(a.date),
      date_asc:   (a, b) => new Date(a.date) - new Date(b.date),
      value_desc: (a, b) => b.valueUSD - a.valueUSD,
      value_asc:  (a, b) => a.valueUSD - b.valueUSD,
      ticker:     (a, b) => a.ticker.localeCompare(b.ticker),
      action:     (a, b) => a.action.localeCompare(b.action) || (new Date(b.date) - new Date(a.date)),
      source:     (a, b) => a.source.localeCompare(b.source) || (new Date(b.date) - new Date(a.date)),
    };
    arr.sort(sorters[sortKey]);
    return arr;
  }, [query, sortKey, assetMap, transactions]);

  const grouped = useMemo(() => {
    if (sortKey !== 'date_desc' && sortKey !== 'date_asc') {
      return [{ key: '__all', items }];
    }
    const groups = [];
    let cur = null;
    for (const t of items) {
      const d = new Date(t.date);
      const k = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      if (!cur || cur.key !== k) {
        cur = { key: k, items: [] };
        groups.push(cur);
      }
      cur.items.push(t);
    }
    return groups;
  }, [items, sortKey]);

  const fmtTxDate = (iso) => new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  const fmtTxTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const fmtExecPrice = (t) => {
    if (t.price == null) return '—';
    const v = t.price * (cur.currency === 'THB' ? FX_RATE : 1);
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: t.price < 1 ? 4 : 2 });
  };

  const valueClass = (action) => action === 'Sell' ? 'down' : (action === 'Buy' || action === 'Dividend' || action === 'Deposit') ? 'up' : '';
  const valueSign = (action) => action === 'Sell' ? '-' : '+';

  return (
    <div>
      <div className="tx-header">
        <div className="tx-search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            placeholder="Search by asset, ticker, action…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ color: 'var(--text-faint)', fontSize: 14 }}>✕</button>
          )}
        </div>
        <div className="tx-actions">
          <button className="pill-btn" onClick={() => setShowModal(true)}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            <span>Add transaction</span>
          </button>
          <button className="pill-btn">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v8m0 0l-3-3m3 3l3-3M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span>Import</span>
          </button>
        </div>
      </div>

      <div className="card list-card">
        <div className="list-controls">
          <div style={{ position: 'relative' }} ref={sortRef}>
            <button className="pill-btn" onClick={() => setSortOpen(o => !o)}>
              <span className="dim">Sort by:</span>
              <span className="b">{TX_SORT_OPTIONS.find(o => o.key === sortKey).label}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: 'var(--text-dim)', transition: 'transform 0.18s', transform: sortOpen ? 'rotate(180deg)' : 'none' }}>
                <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {sortOpen && (
              <div className="dropdown-menu" style={{ left: 0, right: 'auto', minWidth: 240 }}>
                {TX_SORT_OPTIONS.map(o => (
                  <button key={o.key} className={`dropdown-item${o.key === sortKey ? ' selected' : ''}`} onClick={() => { setSortKey(o.key); setSortOpen(false); }}>
                    <span>{o.label}</span>
                    {o.key === sortKey && <span style={{ color: 'var(--accent)' }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            {items.length} {items.length === 1 ? 'transaction' : 'transactions'}
            {query && <span style={{ color: 'var(--text-faint)' }}> · filtered</span>}
          </div>
        </div>

        <div className="tx-head-row">
          <div>Asset</div>
          <div>Executed Price</div>
          <div className="c">Brokerage</div>
          <div className="r">Date</div>
          <div className="r">Value ({fmtCurrencyCode(cur.currency)})</div>
        </div>

        {items.length === 0 ? (
          <div className="tx-empty-search">No transactions match “{query}”.</div>
        ) : (
          grouped.map(g => (
            <Fragment key={g.key}>
              {g.key !== '__all' && <div className="tx-month-head">{g.key}</div>}
              {g.items.map(t => {
                const a = assetMap[t.ticker] || {};
                const src = SOURCES[t.source];
                const actionClass = t.action.toLowerCase();
                const vc = valueClass(t.action);
                const sign = valueSign(t.action);
                return (
                  <div className="tx-row" key={t.id}>
                    <div className="tx-asset">
                      <div className="logo" style={{ background: a.logo?.bg || '#333', color: a.logo?.dark ? '#0a0a0b' : 'white' }}>
                        <span className={a.logo?.small ? 'small-text' : ''}>{a.logo?.text || t.ticker[0]}</span>
                      </div>
                      <div className="meta">
                        <div className="action-row">
                          <span className={`action ${actionClass}`}>{t.action}</span>
                          <span className="ticker">{t.ticker}</span>
                        </div>
                        <div className="name">{a.name || ''}{t.shares != null && ` · ${t.shares.toLocaleString('en-US', { maximumFractionDigits: 7 })} ${t.action === 'Deposit' ? fmtCurrencyCode(t.ticker === 'THB' ? 'THB' : 'USD') : 'shares'}`}</div>
                      </div>
                    </div>

                    <div className="tx-price">
                      <span className="label-m">Price · </span>
                      <span className="val">{fmtExecPrice(t)}</span>
                      {t.price != null && <span className="label-m"> {fmtCurrencyCode(cur.currency)}/sh</span>}
                    </div>

                    <div className="c">
                      <span className="label-m">Brokerage</span>
                      <span className="source-tag">
                        <span className="src-dot" style={{ background: src.color }}></span>
                        {t.source}
                      </span>
                    </div>

                    <div className="tx-date r">
                      <span className="label-m">Date</span>
                      <span>{fmtTxDate(t.date)} · <span className="time" style={{ display: 'inline' }}>{fmtTxTime(t.date)}</span></span>
                    </div>

                    <div className="r">
                      <span className="label-m">Value</span>
                      <span className={`tx-value ${vc}`}>
                        {sign}{fmtCurrency(t.valueUSD, cur.currency, { decimals: 2 }).replace(/^[$฿]/, fmtCurrencySym(cur.currency))}
                        <span className="code">{fmtCurrencyCode(cur.currency)}</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </Fragment>
          ))
        )}
      </div>

      {showModal && <AddTransactionModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

function AddTransactionModal({ onClose }) {
  const cur = useContext(CurrencyContext);
  const [portfolio, setPortfolio] = useState(null);
  const [assetType, setAssetType] = useState(null);
  const [txType, setTxType] = useState('Buy');
  const [ticker, setTicker] = useState('');
  const [qty, setQty] = useState('');
  const [date, setDate] = useState('14/05/2026');
  const [price, setPrice] = useState('');
  const [time, setTime] = useState('07:00');
  const [fees, setFees] = useState('');
  const [taxes, setTaxes] = useState('');
  const [description, setDescription] = useState('');
  const [advOpen, setAdvOpen] = useState(false);
  const [txTypeOpen, setTxTypeOpen] = useState(false);
  const txTypeRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (txTypeRef.current && !txTypeRef.current.contains(e.target)) setTxTypeOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickPortfolio = (p) => {
    setPortfolio(p);
    setAssetType(PORTFOLIO_TYPES[p][0]);
  };

  const totalAmount = useMemo(() => {
    const q = parseFloat(qty) || 0;
    const pr = parseFloat(price) || 0;
    const f = parseFloat(fees) || 0;
    const t = parseFloat(taxes) || 0;
    const base = q * pr;
    if (txType === 'Sell') return base - f - t;
    return base + f + t;
  }, [qty, price, fees, taxes, txType]);

  const symbol = fmtCurrencySym(cur.currency);
  const txTypeOptions = ['Buy', 'Sell', 'Dividend', 'Deposit', 'Withdraw'];

  if (!portfolio) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <div className="modal-head">
            <h2>Add transaction</h2>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </button>
          </div>
          <div className="modal-body">
            <p className="picker-prompt">Which portfolio is this transaction for?</p>
            <div className="picker-grid">
              {['Dime!', 'Webull', 'Binance'].map(p => (
                <button key={p} className="picker-card" onClick={() => pickPortfolio(p)}>
                  <span className="src-dot-lg" style={{ background: SOURCES[p].color }}>{p[0]}</span>
                  <span className="pc-info">
                    <span className="pc-name">{p}</span>
                    <span className="pc-sub">{PORTFOLIO_TYPES[p].join(' · ')}</span>
                  </span>
                  <svg className="pc-arrow" width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M6 4l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const types = PORTFOLIO_TYPES[portfolio];
  const placeholderTicker = assetType === 'Crypto' ? 'BTC, ETH, …' : assetType === 'Bond' ? 'CUSIP, ISIN, …' : assetType === 'Cash' ? 'USD, THB, …' : 'Ticker, ISIN, Stock, ETF, …';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Add transaction</h2>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: SOURCES[portfolio].color }}></span>
              <span>{portfolio}</span>
              <button onClick={() => setPortfolio(null)} style={{ marginLeft: 6, fontSize: 12, color: 'var(--text-dim)', textDecoration: 'underline' }}>change</button>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="asset-type-tabs">
            {types.map(t => (
              <button key={t} className={t === assetType ? 'active' : ''} onClick={() => setAssetType(t)}>{t}</button>
            ))}
          </div>

          <div className="field">
            <label>Transaction Type</label>
            <div style={{ position: 'relative' }} ref={txTypeRef}>
              <button type="button" className="field-select" onClick={() => setTxTypeOpen(o => !o)}>
                <span>{txType}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--text-dim)', transition: 'transform 0.18s', transform: txTypeOpen ? 'rotate(180deg)' : 'none' }}>
                  <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {txTypeOpen && (
                <div className="dropdown-menu" style={{ left: 0, right: 0, minWidth: 0 }}>
                  {txTypeOptions.map(o => (
                    <button key={o} className={`dropdown-item${o === txType ? ' selected' : ''}`} onClick={() => { setTxType(o); setTxTypeOpen(false); }}>
                      <span>{o}</span>
                      {o === txType && <span style={{ color: 'var(--accent)' }}>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="field">
            <label>Add {assetType}</label>
            <div className="field-with-icon">
              <svg className="lead-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input className="field-input" placeholder={placeholderTicker} value={ticker} onChange={e => setTicker(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label>Quantity</label>
            <input className="field-input" placeholder="e.g. 10" value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal" />
          </div>

          <div className="field">
            <label>Transaction Date</label>
            <div className="field-with-icon">
              <input className="field-input" value={date} onChange={e => setDate(e.target.value)} />
              <svg className="trail-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M2 6h12M5 2v3M11 2v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </div>
          </div>

          <div className="field">
            <label>{txType === 'Sell' ? 'Sale' : 'Purchase'} Price</label>
            <div className="field-with-suffix">
              <input className="field-input" placeholder={`e.g. ${symbol}150.00`} value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" />
              <span className="field-suffix">
                {fmtCurrencyCode(cur.currency)}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </div>
          </div>

          <div className={`adv-toggle${advOpen ? ' open' : ''}`} onClick={() => setAdvOpen(o => !o)}>
            <span className="adv-title">Advanced transaction input</span>
            <span className="adv-optional">optional</span>
            <svg className="adv-caret" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          {advOpen && (
            <div className="adv-content">
              <div className="field">
                <label>Transaction time</label>
                <div style={{ position: 'relative' }}>
                  <input className="field-input" value={time} onChange={e => setTime(e.target.value)} style={{ fontWeight: 600 }} />
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ position: 'absolute', top: '50%', right: 16, transform: 'translateY(-50%)', color: 'var(--text-dim)', pointerEvents: 'none' }}>
                    <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>

              <div className="field">
                <label>Trading costs / FX fees</label>
                <div className="field-with-suffix">
                  <input className="field-input" placeholder={`e.g. ${symbol}10.00`} value={fees} onChange={e => setFees(e.target.value)} inputMode="decimal" />
                  <span className="field-suffix">
                    {fmtCurrencyCode(cur.currency)}
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                </div>
              </div>

              <div className="field">
                <label>Taxes</label>
                <div className="field-with-suffix">
                  <input className="field-input" placeholder={`e.g. ${symbol}15.00`} value={taxes} onChange={e => setTaxes(e.target.value)} inputMode="decimal" />
                  <span className="field-suffix">
                    {fmtCurrencyCode(cur.currency)}
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                </div>
              </div>

              <div className="field">
                <label>Description</label>
                <textarea className="field-input" placeholder="Add a personal note" value={description} onChange={e => setDescription(e.target.value)}></textarea>
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <div className="total-row">
            <span className="total-label">Total Amount</span>
            <span className="total-val">{symbol}{totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="btn-stack">
            <button className="btn-primary" onClick={onClose}>Add transaction</button>
            <button className="btn-secondary" onClick={() => { setTicker(''); setQty(''); setPrice(''); }}>Save and Add Another</button>
          </div>
        </div>
      </div>
    </div>
  );
}
