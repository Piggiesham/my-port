import { useState, useMemo, useRef, useEffect, useContext, Fragment } from 'react';
import { CurrencyContext, ASSETS as MOCK_ASSETS, SOURCES, TRANSACTIONS as MOCK_TRANSACTIONS, FX_RATE, fmtCurrencyCode, fmtDateBkk, fmtTimeBkk } from '../data.js';
import AddTransactionModal from './AddTransactionModal.jsx';
import TransactionDetailModal from './TransactionDetailModal.jsx';
import ImportModal from './ImportModal.jsx';

const TX_SORT_OPTIONS = [
  { key: 'date_desc',  label: 'Date (newest first)' },
  { key: 'date_asc',   label: 'Date (oldest first)' },
  { key: 'value_desc', label: 'Value (high → low)' },
  { key: 'value_asc',  label: 'Value (low → high)' },
  { key: 'ticker',     label: 'Asset (A → Z)' },
  { key: 'action',     label: 'Action type' },
  { key: 'source',     label: 'Brokerage' },
];

export default function TransactionsPage({ transactions = MOCK_TRANSACTIONS, assets = MOCK_ASSETS, onTransactionAdded }) {
  const cur = useContext(CurrencyContext);
  const fx = cur.fxRate || FX_RATE;
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('date_desc');
  const [typeFilter, setTypeFilter] = useState('All');
  const [brokerageFilter, setBrokerageFilter] = useState('All');
  const [sortOpen, setSortOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
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

  const typeOf = (t) => assetMap[t.ticker]?.type || (t.ticker === 'USD' || t.ticker === 'THB' ? 'Cash' : 'Stock');

  const availableTypes = useMemo(() => {
    const set = new Set(transactions.map(typeOf));
    return ['All', ...['Cash', 'Stock', 'ETF', 'Crypto', 'Bond', 'Commodity'].filter(t => set.has(t))];
  }, [transactions, assetMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const availableBrokerages = useMemo(() => {
    const set = new Set(transactions.map(t => t.source).filter(Boolean));
    return ['All', ...[...set].sort()];
  }, [transactions]);

  const items = useMemo(() => {
    let arr = transactions.filter(t => {
      if (brokerageFilter !== 'All' && t.source !== brokerageFilter) return false;
      if (typeFilter !== 'All' && typeOf(t) !== typeFilter) return false;
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
  }, [query, sortKey, assetMap, transactions, typeFilter, brokerageFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    if (sortKey !== 'date_desc' && sortKey !== 'date_asc') {
      return [{ key: '__all', items }];
    }
    const groups = [];
    let cur = null;
    for (const t of items) {
      const d = new Date(t.date);
      const k = d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' });
      if (!cur || cur.key !== k) {
        cur = { key: k, items: [] };
        groups.push(cur);
      }
      cur.items.push(t);
    }
    return groups;
  }, [items, sortKey]);

  const fmtTxDate = (iso) => fmtDateBkk(iso);
  const fmtTxTime = (iso) => fmtTimeBkk(iso);
  const fmtExecPrice = (t) => {
    if (t.price == null) return '—';
    const v = t.price * (cur.currency === 'THB' ? fx : 1);
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: t.price < 1 ? 4 : 2 });
  };

  // Bank-statement convention: money in = +green, money out = −red.
  const CASH_IN  = new Set(['Sell', 'Dividend', 'Deposit']);
  const CASH_OUT = new Set(['Buy', 'Withdraw']);
  const valueClass = (action) => CASH_IN.has(action) ? 'up' : CASH_OUT.has(action) ? 'down' : '';
  const valueSign  = (action) => CASH_IN.has(action) ? '+' : CASH_OUT.has(action) ? '-' : '';

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
          <button className="pill-btn" onClick={() => setShowImport(true)}>
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
            {(query || typeFilter !== 'All' || brokerageFilter !== 'All') && <span style={{ color: 'var(--text-faint)' }}> · filtered</span>}
          </div>
        </div>

        {(availableTypes.length > 1 || availableBrokerages.length > 1) && (
          <div className="type-filter-row">
            {availableTypes.length > 1 && availableTypes.map(t => (
              <button key={`t-${t}`} className={`type-chip${t === typeFilter ? ' active' : ''}`} onClick={() => setTypeFilter(t)}>
                {t}
              </button>
            ))}
            {availableTypes.length > 1 && availableBrokerages.length > 1 && (
              <span style={{ color: 'var(--text-faint)', margin: '0 10px', userSelect: 'none' }}>|</span>
            )}
            {availableBrokerages.length > 1 && availableBrokerages.map(b => (
              <button key={`b-${b}`} className={`type-chip${b === brokerageFilter ? ' active' : ''}`} onClick={() => setBrokerageFilter(b)}>
                {b}
              </button>
            ))}
          </div>
        )}

        <div className="tx-head-row">
          <div>Asset</div>
          <div>Executed Price</div>
          <div className="c">Asset Type</div>
          <div className="c">Brokerage</div>
          <div className="r">Date</div>
          <div className="r">Value ({fmtCurrencyCode(cur.currency)})</div>
        </div>

        {items.length === 0 ? (
          <div className="tx-empty-search">No transactions match "{query}".</div>
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
                      {t.action === 'Deposit' || t.action === 'Withdraw' ? (
                        <span className="val" style={{ color: 'var(--text-faint)' }}>—</span>
                      ) : (
                        <>
                          <span className="val">{fmtExecPrice(t)}</span>
                          {t.price != null && <span className="label-m"> {fmtCurrencyCode(cur.currency)}/sh</span>}
                        </>
                      )}
                    </div>

                    {(() => {
                      const ty = typeOf(t);
                      return (
                        <div className="c">
                          <span className="label-m">Asset Type</span>
                          <span className={`type-pill type-${ty.toLowerCase()}`}>{ty}</span>
                        </div>
                      );
                    })()}

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
                      {(() => {
                        const fxAtTx = t.fx_rate_at_tx ?? fx;
                        const valTHB = t.valueUSD * fxAtTx;
                        const primary = cur.currency === 'THB'
                          ? '฿' + valTHB.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : '$' + t.valueUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        const secondary = cur.currency === 'THB'
                          ? '≈ $' + t.valueUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USD'
                          : '≈ ฿' + valTHB.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' THB';
                        return (
                          <>
                            <span className={`tx-value ${vc}`}>
                              {sign}{primary}
                              <span className="code">{fmtCurrencyCode(cur.currency)}</span>
                            </span>
                            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                              {secondary}
                            </span>
                          </>
                        );
                      })()}
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
          transactions={transactions}
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

      {showImport && (
        <ImportModal
          transactions={transactions}
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); onTransactionAdded?.(); }}
        />
      )}
    </div>
  );
}
