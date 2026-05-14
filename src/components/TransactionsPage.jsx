import { useState, useMemo, useRef, useEffect, useContext, Fragment } from 'react';
import { CurrencyContext, ASSETS as MOCK_ASSETS, SOURCES, TRANSACTIONS as MOCK_TRANSACTIONS, FX_RATE, fmtCurrency, fmtCurrencySym, fmtCurrencyCode } from '../data.js';
import { addTransaction, updateTransaction, deleteTransaction, fetchAssetCatalog, createAsset, searchYahooSymbols, fetchHistoricalPrice } from '../lib/api.js';
import { supabaseEnabled } from '../lib/supabase.js';

// Asset-type filter for the typeahead. The portfolio picker exposes broad
// buckets (Security/Bond/Crypto/Cash); the assets table uses finer types.
const ASSET_TYPE_FILTER = {
  Security: ['Stock', 'ETF', 'Commodity'],
  Bond:     ['Bond'],
  Crypto:   ['Crypto'],
  Cash:     ['Cash'],
};

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

export default function TransactionsPage({ transactions = MOCK_TRANSACTIONS, assets = MOCK_ASSETS, onTransactionAdded }) {
  const cur = useContext(CurrencyContext);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('date_desc');
  const [sortOpen, setSortOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedTx, setSelectedTx] = useState(null);
  const sortRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (sortRef.current && !sortRef.current.contains(e.target)) setSortOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (showModal || selectedTx) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [showModal, selectedTx]);

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
                  <div
                    className="tx-row"
                    key={t.id}
                    onClick={() => setSelectedTx(t)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelectedTx(t); }}
                    style={{ cursor: 'pointer' }}
                  >
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

      {showModal && (
        <AddTransactionModal
          onClose={() => setShowModal(false)}
          onAdded={() => { setShowModal(false); onTransactionAdded?.(); }}
        />
      )}

      {selectedTx && (
        <TransactionDetailModal
          tx={selectedTx}
          assetMap={assetMap}
          onClose={() => setSelectedTx(null)}
          onChanged={() => { setSelectedTx(null); onTransactionAdded?.(); }}
        />
      )}
    </div>
  );
}

function AddTransactionModal({ onClose, onAdded }) {
  const cur = useContext(CurrencyContext);
  const [portfolio, setPortfolio] = useState(null);
  const [assetType, setAssetType] = useState(null);
  const [txType, setTxType] = useState('Buy');
  const [ticker, setTicker] = useState('');
  const [catalog, setCatalog] = useState([]);
  const [catalogVersion, setCatalogVersion] = useState(0);

  useEffect(() => {
    fetchAssetCatalog().then(setCatalog).catch(err => console.error('[catalog] fetch failed', err));
  }, [catalogVersion]);
  const [qty, setQty] = useState('');
  const todayIso = isoDate(new Date());
  const [dateIso, setDateIso] = useState(todayIso); // canonical YYYY-MM-DD
  const [dateText, setDateText] = useState(() => {
    const [y, m, d] = todayIso.split('-');
    return `${d}/${m}/${y}`;
  });
  const [datePopOpen, setDatePopOpen] = useState(false);
  const [price, setPrice] = useState('');
  const [priceAutoFilled, setPriceAutoFilled] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);
  const [time, setTime] = useState(new Date().toTimeString().slice(0, 5));
  const [fees, setFees] = useState('');
  const [taxes, setTaxes] = useState('');
  const [description, setDescription] = useState('');
  const [advOpen, setAdvOpen] = useState(false);
  const [txTypeOpen, setTxTypeOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const txTypeRef = useRef(null);
  const dateIconRef = useRef(null);

  // Keep ISO and DD/MM/YYYY text in sync whenever the user edits text.
  useEffect(() => {
    const t = dateText.trim();
    let iso = null;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) {
      const [dd, mm, yyyy] = t.split('/');
      iso = `${yyyy}-${mm}-${dd}`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      iso = t;
    }
    if (iso && iso !== dateIso) setDateIso(iso);
  }, [dateText]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill historical price when both ticker and date are set.
  useEffect(() => {
    const t = (ticker || '').toUpperCase().trim();
    if (!t || !dateIso || t === 'USD') return;
    let cancelled = false;
    setPriceLoading(true);
    fetchHistoricalPrice(t, dateIso).then(p => {
      if (cancelled) return;
      if (p != null) {
        setPrice(String(Number(p.toFixed(6))));
        setPriceAutoFilled(true);
      }
    }).finally(() => { if (!cancelled) setPriceLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, dateIso]);

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
            <AssetSearchInput
              assetType={assetType}
              catalog={catalog}
              value={ticker}
              onChange={setTicker}
              onAssetCreated={() => setCatalogVersion(v => v + 1)}
              placeholder={placeholderTicker}
            />
          </div>

          <div className="field">
            <label>Quantity</label>
            <input className="field-input" placeholder="e.g. 10" value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal" />
          </div>

          <div className="field">
            <label>Transaction Date</label>
            <div className="field-with-icon" style={{ position: 'relative' }}>
              <input
                className="field-input"
                value={dateText}
                onChange={e => setDateText(e.target.value)}
                placeholder="DD/MM/YYYY"
              />
              <button
                type="button"
                ref={dateIconRef}
                onClick={() => setDatePopOpen(o => !o)}
                aria-label="Open calendar"
                style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: 4, display: 'inline-flex' }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M2 6h12M5 2v3M11 2v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
              {datePopOpen && (
                <DatePopover
                  value={dateIso}
                  anchorRef={dateIconRef}
                  onPick={(iso) => {
                    setDateIso(iso);
                    const [y, m, d] = iso.split('-');
                    setDateText(`${d}/${m}/${y}`);
                  }}
                  onClose={() => setDatePopOpen(false)}
                />
              )}
            </div>
          </div>

          <div className="field">
            <label>{txType === 'Sell' ? 'Sale' : 'Purchase'} Price</label>
            <div className="field-with-suffix">
              <input
                className="field-input"
                placeholder={priceLoading ? 'Fetching…' : `e.g. ${symbol}150.00`}
                value={price}
                onChange={e => { setPrice(e.target.value); setPriceAutoFilled(false); }}
                inputMode="decimal"
              />
              <span className="field-suffix">
                {fmtCurrencyCode(cur.currency)}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </div>
            {priceAutoFilled && !priceLoading && (
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>Auto-filled from Yahoo Finance · close on {dateIso}</div>
            )}
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
          {error && (
            <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 10, padding: '8px 12px', background: 'rgba(248,113,113,0.1)', borderRadius: 8 }}>
              {error}
            </div>
          )}
          <div className="btn-stack">
            <button
              className="btn-primary"
              disabled={submitting || !ticker || !qty}
              style={{ opacity: (submitting || !ticker || !qty) ? 0.5 : 1 }}
              onClick={async () => {
                setSubmitting(true);
                setError(null);
                try {
                  const executedAt = new Date(`${dateIso}T${time}:00`).toISOString();
                  await addTransaction({
                    portfolio,
                    ticker: ticker.toUpperCase().trim(),
                    action: txType,
                    shares: parseFloat(qty) || null,
                    price: parseFloat(price) || null,
                    valueUsd: totalAmount || (parseFloat(qty) * parseFloat(price)) || 0,
                    fees: parseFloat(fees) || 0,
                    taxes: parseFloat(taxes) || 0,
                    description,
                    executedAt,
                  });
                  onAdded?.();
                } catch (err) {
                  setError(supabaseEnabled ? err.message : 'Supabase not configured — add your env vars to save data.');
                  setSubmitting(false);
                }
              }}
            >
              {submitting ? 'Saving…' : 'Add transaction'}
            </button>
            <button
              className="btn-secondary"
              onClick={() => { setTicker(''); setQty(''); setPrice(''); setError(null); }}
            >
              Save and Add Another
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// AssetSearchInput — typeahead over the asset catalog with an inline
// "add new asset" path when no match is found.
// ============================================================================
// ============================================================================
// DatePopover — month-grid calendar matching the reference design. Operates on
// "YYYY-MM-DD" strings to stay free of timezone surprises.
// ============================================================================
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEK = ['Mo','Tu','We','Th','Fr','Sa','Su'];

function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function parseIso(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
}

function DatePopover({ value, onPick, onClose, anchorRef }) {
  const popRef = useRef(null);
  const initial = parseIso(value) || new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const [monthOpen, setMonthOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);

  useEffect(() => {
    const onClick = (e) => {
      if (popRef.current && !popRef.current.contains(e.target) && (!anchorRef?.current || !anchorRef.current.contains(e.target))) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [onClose, anchorRef]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Build grid: 6 weeks × 7 days starting Monday.
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7; // 0=Mon
  const gridStart = new Date(viewYear, viewMonth, 1 - startWeekday);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    return d;
  });
  const todayIso = isoDate(new Date());
  const selectedIso = value;

  const years = (() => {
    const cy = new Date().getFullYear();
    const arr = [];
    for (let y = cy + 1; y >= cy - 30; y--) arr.push(y);
    return arr;
  })();

  const stepMonth = (delta) => {
    let m = viewMonth + delta, y = viewYear;
    if (m < 0) { m = 11; y--; }
    else if (m > 11) { m = 0; y++; }
    setViewMonth(m); setViewYear(y);
  };

  return (
    <div
      ref={popRef}
      style={{
        position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 60,
        background: 'var(--panel-2)', border: '1px solid var(--border-strong)', borderRadius: 16,
        padding: 14, width: 320, boxShadow: '0 18px 40px rgba(0,0,0,0.5)',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => stepMonth(-1)} style={chevBtn} aria-label="Previous month">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3l-4 4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div style={{ position: 'relative', flex: 1 }}>
          <button type="button" onClick={() => { setMonthOpen(o => !o); setYearOpen(false); }} style={selectBtn}>
            <span>{MONTHS[viewMonth]}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {monthOpen && (
            <div style={menuStyle}>
              {MONTHS.map((m, i) => (
                <button key={m} type="button" className="dropdown-item" onClick={() => { setViewMonth(i); setMonthOpen(false); }} style={{ display: 'block', width: '100%', textAlign: 'left' }}>
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative', width: 96 }}>
          <button type="button" onClick={() => { setYearOpen(o => !o); setMonthOpen(false); }} style={selectBtn}>
            <span>{viewYear}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {yearOpen && (
            <div style={menuStyle}>
              {years.map((y) => (
                <button key={y} type="button" className="dropdown-item" onClick={() => { setViewYear(y); setYearOpen(false); }} style={{ display: 'block', width: '100%', textAlign: 'left' }}>
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={() => stepMonth(1)} style={chevBtn} aria-label="Next month">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, fontSize: 12, color: 'var(--text-faint)', marginBottom: 6 }}>
        {WEEK.map(w => <div key={w} style={{ textAlign: 'center', padding: '4px 0', fontWeight: 600 }}>{w}</div>)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === viewMonth;
          const iso = isoDate(d);
          const isSelected = iso === selectedIso;
          const isToday = iso === todayIso;
          return (
            <button
              key={i}
              type="button"
              onClick={() => { onPick(iso); onClose(); }}
              style={{
                aspectRatio: '1 / 1',
                borderRadius: '50%',
                fontWeight: isSelected || isToday ? 700 : 500,
                fontSize: 13,
                background: isSelected ? 'var(--accent, #6366f1)' : 'transparent',
                color: isSelected ? 'white' : (inMonth ? 'var(--text)' : 'var(--text-faint)'),
                border: isToday && !isSelected ? '1px solid var(--border-strong)' : '1px solid transparent',
                cursor: 'pointer',
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const chevBtn = {
  width: 32, height: 32, borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--border-strong)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', cursor: 'pointer',
};
const selectBtn = {
  width: '100%', height: 32, padding: '0 12px', borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--border-strong)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const menuStyle = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 200, overflowY: 'auto',
  background: 'var(--panel-2)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: 4, zIndex: 70,
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
};

function EditDateField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const iconRef = useRef(null);
  const [y, m, d] = (value || '').split('-');
  const display = (y && m && d) ? `${d}/${m}/${y}` : '';
  return (
    <div className="field-with-icon" style={{ position: 'relative' }}>
      <input
        className="field-input"
        value={display}
        onChange={e => {
          const t = e.target.value.trim();
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) {
            const [dd, mm, yyyy] = t.split('/');
            onChange(`${yyyy}-${mm}-${dd}`);
          }
        }}
        placeholder="DD/MM/YYYY"
      />
      <button
        type="button"
        ref={iconRef}
        onClick={() => setOpen(o => !o)}
        aria-label="Open calendar"
        style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: 4, display: 'inline-flex' }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M2 6h12M5 2v3M11 2v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <DatePopover
          value={value}
          anchorRef={iconRef}
          onPick={(iso) => onChange(iso)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

const YAHOO_TYPE_TO_ASSET = {
  EQUITY: 'Stock',
  ETF: 'ETF',
  MUTUALFUND: 'ETF',
  CRYPTOCURRENCY: 'Crypto',
  CURRENCY: 'Cash',
};

function AssetSearchInput({ assetType, catalog, value, onChange, onAssetCreated, placeholder }) {
  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState(null);
  const [remote, setRemote] = useState([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [addingRemote, setAddingRemote] = useState(null); // ticker currently being added
  const wrapRef = useRef(null);

  useEffect(() => { setQuery(value || ''); }, [value]);

  useEffect(() => {
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const allowedTypes = ASSET_TYPE_FILTER[assetType] || [];
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog
      .filter(a => allowedTypes.length === 0 || allowedTypes.includes(a.type))
      .filter(a => !q || a.ticker.toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q))
      .slice(0, 20);
  }, [catalog, query, allowedTypes]);

  // Debounced live Yahoo Finance search. Only fires when the typed query
  // doesn't already exactly match a local catalog entry.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) { setRemote([]); return; }
    const knownTickers = new Set(catalog.map(a => a.ticker.toUpperCase()));
    if (knownTickers.has(q.toUpperCase()) && matches.some(a => a.ticker.toUpperCase() === q.toUpperCase())) {
      setRemote([]);
      return;
    }
    let cancelled = false;
    setRemoteBusy(true);
    const t = setTimeout(async () => {
      try {
        const results = await searchYahooSymbols(q);
        if (cancelled) return;
        const filtered = results
          .map(r => ({ ...r, mappedType: YAHOO_TYPE_TO_ASSET[r.type] }))
          .filter(r => r.mappedType)
          .filter(r => allowedTypes.length === 0 || allowedTypes.includes(r.mappedType))
          .filter(r => !knownTickers.has(r.symbol.toUpperCase()))
          .slice(0, 8);
        setRemote(filtered);
      } finally {
        if (!cancelled) setRemoteBusy(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, catalog, matches, allowedTypes]);

  const exactMatch = matches.find(a => a.ticker.toUpperCase() === query.trim().toUpperCase());
  const showCreateRow = query.trim().length > 0 && !exactMatch && remote.length === 0 && !remoteBusy && allowedTypes.length > 0;

  const pick = (asset) => {
    setQuery(asset.ticker);
    onChange(asset.ticker);
    setOpen(false);
    setCreating(false);
  };

  const startCreate = () => {
    setCreating(true);
    setNewName('');
    setCreateErr(null);
  };

  const pickRemote = async (r) => {
    setAddingRemote(r.symbol);
    try {
      const created = await createAsset({
        ticker: r.symbol,
        name: r.name,
        type: r.mappedType,
      });
      onAssetCreated?.(created);
      pick({ ticker: created.ticker, name: created.name, type: created.type });
    } catch (err) {
      console.error('[asset] create from yahoo failed', err);
    } finally {
      setAddingRemote(null);
    }
  };

  const submitCreate = async () => {
    if (!newName.trim()) { setCreateErr('Name is required'); return; }
    setCreateBusy(true);
    setCreateErr(null);
    try {
      const newType = allowedTypes[0]; // pick the most common type for this bucket
      const created = await createAsset({
        ticker: query.trim().toUpperCase(),
        name: newName.trim(),
        type: newType,
      });
      onAssetCreated?.(created);
      pick({ ticker: created.ticker, name: created.name, type: created.type });
    } catch (err) {
      setCreateErr(err.message || 'Could not create asset');
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <div style={{ position: 'relative' }} ref={wrapRef}>
      <div className="field-with-icon">
        <svg className="lead-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <input
          className="field-input"
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={e => {
            const v = e.target.value;
            setQuery(v);
            onChange(v.toUpperCase());
            setOpen(true);
            setCreating(false);
          }}
        />
      </div>

      {open && (matches.length > 0 || remote.length > 0 || remoteBusy || showCreateRow) && (
        <div className="dropdown-menu" style={{ left: 0, right: 0, minWidth: 0, maxHeight: 320, overflowY: 'auto' }}>
          {matches.map(a => (
            <button
              key={a.ticker}
              type="button"
              className="dropdown-item"
              onClick={() => pick(a)}
              style={{ alignItems: 'center', gap: 10 }}
            >
              <span className="logo" style={{ width: 26, height: 26, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: a.logo_bg || '#333', color: a.logo_dark ? '#0a0a0b' : 'white' }}>
                {a.logo_text || a.ticker[0]}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{a.ticker}</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{a.name} · {a.type}</span>
              </span>
            </button>
          ))}

          {(remote.length > 0 || remoteBusy) && (
            <div style={{ padding: '6px 12px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-faint)', borderTop: matches.length > 0 ? '1px solid var(--border, #222)' : 'none' }}>
              Yahoo Finance {remoteBusy && '· searching…'}
            </div>
          )}
          {remote.map(r => (
            <button
              key={`remote-${r.symbol}`}
              type="button"
              className="dropdown-item"
              onClick={() => pickRemote(r)}
              disabled={addingRemote === r.symbol}
              style={{ alignItems: 'center', gap: 10, opacity: addingRemote === r.symbol ? 0.5 : 1 }}
            >
              <span className="logo" style={{ width: 26, height: 26, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: '#333', color: 'white' }}>
                {r.symbol[0]}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{r.symbol}</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{r.name} · {r.mappedType}{r.exchange ? ` · ${r.exchange}` : ''}</span>
              </span>
              <span style={{ fontSize: 11, color: 'var(--accent)' }}>{addingRemote === r.symbol ? 'Adding…' : '+ Add'}</span>
            </button>
          ))}

          {showCreateRow && !creating && (
            <button
              type="button"
              className="dropdown-item"
              onClick={startCreate}
              style={{ color: 'var(--accent)' }}
            >
              <span>+ Add “{query.trim().toUpperCase()}” as new {assetType}</span>
            </button>
          )}

          {creating && (
            <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border, #222)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>New {assetType} · ticker {query.trim().toUpperCase()}</div>
              <input
                className="field-input"
                placeholder="Asset name (e.g. Apple Inc)"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                autoFocus
              />
              {createErr && <div style={{ fontSize: 12, color: 'var(--red)' }}>{createErr}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-primary" onClick={submitCreate} disabled={createBusy} style={{ flex: 1, opacity: createBusy ? 0.5 : 1 }}>
                  {createBusy ? 'Saving…' : 'Create & select'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setCreating(false)} disabled={createBusy}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TransactionDetailModal — read-only view with Edit & Delete actions.
// Edit swaps to a form pre-populated with the current values.
// Delete confirms then calls revert_transaction RPC.
// ============================================================================
function TransactionDetailModal({ tx, assetMap, onClose, onChanged }) {
  const cur = useContext(CurrencyContext);
  const [mode, setMode] = useState('view'); // 'view' | 'edit' | 'confirm-delete'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const a = assetMap[tx.ticker] || {};
  const src = SOURCES[tx.source] || { color: '#999' };
  const symbol = fmtCurrencySym(cur.currency);
  const code = fmtCurrencyCode(cur.currency);

  const doDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteTransaction(tx.id);
      onChanged?.();
    } catch (err) {
      setError(err.message || 'Delete failed');
      setBusy(false);
    }
  };

  if (mode === 'edit') {
    return (
      <EditTransactionForm tx={tx} onCancel={() => setMode('view')} onSaved={onChanged} onClose={onClose} />
    );
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Transaction details</h2>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: src.color }}></span>
              <span>{tx.source}</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0 16px' }}>
            <div className="logo" style={{ background: a.logo?.bg || '#333', color: a.logo?.dark ? '#0a0a0b' : 'white', width: 40, height: 40 }}>
              <span className={a.logo?.small ? 'small-text' : ''}>{a.logo?.text || tx.ticker[0]}</span>
            </div>
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className={`action ${tx.action.toLowerCase()}`}>{tx.action}</span>
                <span style={{ fontWeight: 700 }}>{tx.ticker}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{a.name || ''}</div>
            </div>
          </div>

          <DetailRow label="Shares"   value={tx.shares != null ? tx.shares.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '—'} />
          <DetailRow label="Price/sh" value={tx.price != null ? `${symbol}${(tx.price * (cur.currency === 'THB' ? FX_RATE : 1)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${code}` : '—'} />
          <DetailRow label="Value"    value={`${symbol}${(tx.valueUSD * (cur.currency === 'THB' ? FX_RATE : 1)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`} />
          <DetailRow label="Fees"     value={tx.fees ? `${symbol}${(tx.fees * (cur.currency === 'THB' ? FX_RATE : 1)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}` : '—'} />
          <DetailRow label="Taxes"    value={tx.taxes ? `${symbol}${(tx.taxes * (cur.currency === 'THB' ? FX_RATE : 1)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}` : '—'} />
          <DetailRow label="Executed" value={new Date(tx.date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} />
          {tx.description && <DetailRow label="Note" value={tx.description} />}
        </div>

        <div className="modal-foot">
          {error && (
            <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 10, padding: '8px 12px', background: 'rgba(248,113,113,0.1)', borderRadius: 8 }}>
              {error}
            </div>
          )}
          {mode === 'confirm-delete' ? (
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
                Deleting this transaction will reverse its effect on your holdings ({tx.ticker} qty &amp; cost basis). Continue?
              </div>
              <div className="btn-stack">
                <button className="btn-primary" onClick={doDelete} disabled={busy} style={{ background: 'var(--red, #ef4444)', opacity: busy ? 0.5 : 1 }}>
                  {busy ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button className="btn-secondary" onClick={() => setMode('view')} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="btn-stack">
              <button className="btn-primary" onClick={() => setMode('edit')}>Edit</button>
              <button className="btn-secondary" onClick={() => setMode('confirm-delete')} style={{ color: 'var(--red, #ef4444)' }}>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border, #1f1f22)', fontSize: 14 }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// ============================================================================
// EditTransactionForm — minimal form for editing an existing transaction.
// Shares the same field markup style as AddTransactionModal but operates on
// an existing record via update_transaction RPC. Portfolio is locked because
// changing brokerage_id on an existing tx is unusual and would complicate
// holdings reconciliation.
// ============================================================================
function EditTransactionForm({ tx, onCancel, onSaved, onClose }) {
  const cur = useContext(CurrencyContext);
  const [action, setAction] = useState(tx.action);
  const [actionOpen, setActionOpen] = useState(false);
  const [shares, setShares] = useState(tx.shares != null ? String(tx.shares) : '');
  const [price, setPrice] = useState(tx.price != null ? String(tx.price) : '');
  const [fees, setFees] = useState(tx.fees ? String(tx.fees) : '');
  const [taxes, setTaxes] = useState(tx.taxes ? String(tx.taxes) : '');
  const [description, setDescription] = useState(tx.description || '');
  const initialDate = new Date(tx.date);
  const pad = (n) => String(n).padStart(2, '0');
  const [date, setDate] = useState(`${initialDate.getFullYear()}-${pad(initialDate.getMonth() + 1)}-${pad(initialDate.getDate())}`);
  const [time, setTime] = useState(`${pad(initialDate.getHours())}:${pad(initialDate.getMinutes())}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const actionRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (actionRef.current && !actionRef.current.contains(e.target)) setActionOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  const symbol = fmtCurrencySym(cur.currency);
  const totalAmount = useMemo(() => {
    const q = parseFloat(shares) || 0;
    const pr = parseFloat(price) || 0;
    const f = parseFloat(fees) || 0;
    const t = parseFloat(taxes) || 0;
    const base = q * pr;
    if (action === 'Sell') return base - f - t;
    return base + f + t;
  }, [shares, price, fees, taxes, action]);

  const txTypeOptions = ['Buy', 'Sell', 'Dividend', 'Deposit', 'Withdraw'];

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Edit transaction</h2>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-faint)' }}>
              {tx.source} · {tx.ticker}
            </div>
          </div>
          <button className="modal-close" onClick={onCancel} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label>Transaction Type</label>
            <div style={{ position: 'relative' }} ref={actionRef}>
              <button type="button" className="field-select" onClick={() => setActionOpen(o => !o)}>
                <span>{action}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--text-dim)' }}>
                  <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {actionOpen && (
                <div className="dropdown-menu" style={{ left: 0, right: 0, minWidth: 0 }}>
                  {txTypeOptions.map(o => (
                    <button key={o} className={`dropdown-item${o === action ? ' selected' : ''}`} onClick={() => { setAction(o); setActionOpen(false); }}>
                      <span>{o}</span>
                      {o === action && <span style={{ color: 'var(--accent)' }}>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="field">
            <label>Quantity</label>
            <input className="field-input" value={shares} onChange={e => setShares(e.target.value)} inputMode="decimal" />
          </div>

          <div className="field">
            <label>Date</label>
            <EditDateField value={date} onChange={setDate} />
          </div>

          <div className="field">
            <label>Time</label>
            <input className="field-input" type="time" value={time} onChange={e => setTime(e.target.value)} />
          </div>

          <div className="field">
            <label>{action === 'Sell' ? 'Sale' : 'Purchase'} Price (USD/sh)</label>
            <input className="field-input" placeholder={`e.g. ${symbol}150.00`} value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" />
          </div>

          <div className="field">
            <label>Fees (USD)</label>
            <input className="field-input" value={fees} onChange={e => setFees(e.target.value)} inputMode="decimal" />
          </div>

          <div className="field">
            <label>Taxes (USD)</label>
            <input className="field-input" value={taxes} onChange={e => setTaxes(e.target.value)} inputMode="decimal" />
          </div>

          <div className="field">
            <label>Description</label>
            <textarea className="field-input" value={description} onChange={e => setDescription(e.target.value)}></textarea>
          </div>
        </div>

        <div className="modal-foot">
          <div className="total-row">
            <span className="total-label">Total Amount (USD)</span>
            <span className="total-val">${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          {error && (
            <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 10, padding: '8px 12px', background: 'rgba(248,113,113,0.1)', borderRadius: 8 }}>
              {error}
            </div>
          )}
          <div className="btn-stack">
            <button
              className="btn-primary"
              disabled={busy}
              style={{ opacity: busy ? 0.5 : 1 }}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const executedAt = new Date(`${date}T${time}:00`).toISOString();
                  await updateTransaction(tx.id, {
                    portfolio: tx.source,
                    ticker: tx.ticker,
                    action,
                    shares: parseFloat(shares) || null,
                    price: parseFloat(price) || null,
                    valueUsd: totalAmount || 0,
                    fees: parseFloat(fees) || 0,
                    taxes: parseFloat(taxes) || 0,
                    description,
                    executedAt,
                  });
                  onSaved?.();
                } catch (err) {
                  setError(err.message || 'Update failed');
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
