import { useState, useMemo, useRef, useEffect } from 'react';
import { SOURCES, PORTFOLIO_TYPES, FX_RATE, fmtCurrencySym, bkkNowParts, bkkPartsToUtcIso } from '../data.js';
import { addTransaction, fetchAssetCatalog, createAsset, searchYahooSymbols, fetchHistoricalPrice, computeCashBalance, computeSharesHeld } from '../lib/api.js';
import { supabaseEnabled } from '../lib/supabase.js';

// Asset-type filter for the typeahead.
const ASSET_TYPE_FILTER = {
  Security: ['Stock', 'ETF', 'Commodity'],
  Bond:     ['Bond'],
  Crypto:   ['Crypto'],
  Cash:     ['Cash'],
};

const YAHOO_TYPE_TO_ASSET = {
  EQUITY: 'Stock',
  ETF: 'ETF',
  MUTUALFUND: 'ETF',
  CRYPTOCURRENCY: 'Crypto',
  CURRENCY: 'Cash',
};

// ---- Shared sub-components (also used by TransactionDetailModal) ------------

export function CurrencySuffix({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  return (
    <span
      className="field-suffix"
      ref={wrapRef}
      style={{ userSelect: 'none' }}
      onClick={() => setOpen(o => !o)}
    >
      {value}
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transition: 'transform 0.18s', transform: open ? 'rotate(180deg)' : 'none' }}>
        <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {open && (
        <div className="dropdown-menu" style={{ minWidth: 96, right: 0, top: 'calc(100% + 6px)' }}>
          {['USD', 'THB'].map(c => (
            <button
              key={c}
              type="button"
              className={`dropdown-item${c === value ? ' selected' : ''}`}
              onClick={(e) => { e.stopPropagation(); onChange(c); setOpen(false); }}
            >
              <span>{c}</span>
              {c === value && <span style={{ color: 'var(--accent)' }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// ---- DatePopover internals --------------------------------------------------

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

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7;
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

export function EditDateField({ value, onChange }) {
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

// ---- AssetSearchInput -------------------------------------------------------

function AssetSearchInput({ assetType, catalog, value, onChange, onAssetCreated, placeholder }) {
  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState(null);
  const [remote, setRemote] = useState([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [addingRemote, setAddingRemote] = useState(null);
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

  const allowedTypes = useMemo(() => ASSET_TYPE_FILTER[assetType] || [], [assetType]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog
      .filter(a => allowedTypes.length === 0 || allowedTypes.includes(a.type))
      .filter(a => !q || a.ticker.toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q))
      .slice(0, 20);
  }, [catalog, query, allowedTypes]);

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
  const showCreateRow = query.trim().length > 0 && !exactMatch && !remoteBusy && allowedTypes.length > 0;

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
      const created = await createAsset({ ticker: r.symbol, name: r.name, type: r.mappedType });
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
      const newType = allowedTypes[0];
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
            <button key={a.ticker} type="button" className="dropdown-item" onClick={() => pick(a)}
              style={{ alignItems: 'center', justifyContent: 'flex-start', gap: 10 }}>
              <span className="logo" style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: a.logo_bg || '#333', color: a.logo_dark ? '#0a0a0b' : 'white' }}>
                {a.logo_text || a.ticker[0]}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 0 }}>
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
            <button key={`remote-${r.symbol}`} type="button" className="dropdown-item" onClick={() => pickRemote(r)}
              disabled={addingRemote === r.symbol}
              style={{ alignItems: 'center', justifyContent: 'flex-start', gap: 10, opacity: addingRemote === r.symbol ? 0.5 : 1 }}>
              <span className="logo" style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: '#333', color: 'white' }}>
                {r.symbol[0]}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{r.symbol}</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{r.name} · {r.mappedType}{r.exchange ? ` · ${r.exchange}` : ''}</span>
              </span>
              <span style={{ fontSize: 11, color: 'var(--accent)' }}>{addingRemote === r.symbol ? 'Adding…' : '+ Add'}</span>
            </button>
          ))}

          {showCreateRow && !creating && (
            <button type="button" className="dropdown-item" onClick={startCreate} style={{ color: 'var(--accent)' }}>
              <span>+ Add custom ticker "{query.trim().toUpperCase()}" ({assetType})</span>
            </button>
          )}

          {creating && (
            <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border, #222)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>New {assetType} · ticker {query.trim().toUpperCase()}</div>
              <input className="field-input" placeholder="Asset name (e.g. Apple Inc)" value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
              {createErr && <div style={{ fontSize: 12, color: 'var(--red)' }}>{createErr}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-primary" onClick={submitCreate} disabled={createBusy} style={{ flex: 1, opacity: createBusy ? 0.5 : 1 }}>
                  {createBusy ? 'Saving…' : 'Create & select'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setCreating(false)} disabled={createBusy}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// AddTransactionModal
// ============================================================================
export default function AddTransactionModal({ onClose, onAdded, transactions = [] }) {
  const [portfolio, setPortfolio] = useState(null);
  const [assetType, setAssetType] = useState(null);
  const [txType, setTxType] = useState('Buy');
  const [ticker, setTicker] = useState('');
  const [depositCcy, setDepositCcy] = useState('USD');
  const [entryCcy, setEntryCcy] = useState('USD');
  const [fxRate, setFxRate] = useState(String(FX_RATE));
  const [priceCcy, setPriceCcy] = useState('USD');
  const [feesCcy, setFeesCcy] = useState('USD');
  const [taxesCcy, setTaxesCcy] = useState('USD');
  const [catalog, setCatalog] = useState([]);
  const [catalogVersion, setCatalogVersion] = useState(0);

  useEffect(() => {
    fetchAssetCatalog().then(setCatalog).catch(err => console.error('[catalog] fetch failed', err));
  }, [catalogVersion]);

  const [qty, setQty] = useState('');
  const bkkNow = bkkNowParts();
  const todayIso = bkkNow.date;
  const [dateIso, setDateIso] = useState(todayIso);
  const [dateText, setDateText] = useState(() => {
    const [y, m, d] = todayIso.split('-');
    return `${d}/${m}/${y}`;
  });
  const [datePopOpen, setDatePopOpen] = useState(false);
  const [price, setPrice] = useState('');
  const [priceAutoFilled, setPriceAutoFilled] = useState(false);
  const [priceUserEdited, setPriceUserEdited] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);
  const [time, setTime] = useState(bkkNow.time);
  const [fees, setFees] = useState('');
  const [taxes, setTaxes] = useState('');
  const [description, setDescription] = useState('');
  const [advOpen, setAdvOpen] = useState(false);
  const [txTypeOpen, setTxTypeOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const txTypeRef = useRef(null);
  const dateIconRef = useRef(null);

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

  // Cash deposits default to 00:01 (first minute of the day) so they always
  // sort before same-day Buys in the cash-trajectory check. Any other type
  // defaults to the current Bangkok time. Still editable under Advanced.
  useEffect(() => {
    setTime(txType === 'Deposit' ? '00:01' : bkkNowParts().time);
  }, [txType]);

  const isCashFlow = txType === 'Deposit' || txType === 'Withdraw';
  const fxNum = parseFloat(fxRate) || FX_RATE;
  const toUsd = (v, ccy) => (ccy === 'THB' ? v / fxNum : v);

  useEffect(() => {
    if (isCashFlow) return;
    if (priceUserEdited) return;
    const t = (ticker || '').toUpperCase().trim();
    if (!t || !dateIso || t === 'USD') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setPriceLoading(true);
      fetchHistoricalPrice(t, dateIso).then(p => {
        if (cancelled) return;
        if (p != null) {
          const display = priceCcy === 'THB' ? p * fxNum : p;
          setPrice(String(Number(display.toFixed(6))));
          setPriceAutoFilled(true);
        }
      }).finally(() => { if (!cancelled) setPriceLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ticker, dateIso, isCashFlow, priceCcy, fxNum, priceUserEdited]);

  useEffect(() => {
    if (!dateIso) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchHistoricalPrice('THB', dateIso).then(p => {
        if (cancelled || p == null || p <= 0) return;
        setFxRate(String(Number((1 / p).toFixed(4))));
      }).catch(() => {});
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [dateIso]);

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

  const txTypeOptions = useMemo(() => {
    if (portfolio === 'Binance') {
      if (assetType === 'Crypto') return ['Buy', 'Sell'];
      if (assetType === 'Cash')   return ['Deposit', 'Withdraw'];
    }
    if (portfolio === 'Dime!' || portfolio === 'Webull') {
      if (assetType === 'Security' || assetType === 'Bond') return ['Buy', 'Sell', 'Dividend'];
      if (assetType === 'Cash')                              return ['Deposit', 'Withdraw'];
    }
    return ['Buy', 'Sell', 'Dividend', 'Deposit', 'Withdraw'];
  }, [portfolio, assetType]);

  useEffect(() => {
    if (!txTypeOptions.includes(txType)) setTxType(txTypeOptions[0]);
  }, [txTypeOptions, txType]);

  const convertValue = (raw, fromCcy, toCcy) => {
    if (raw === '' || fromCcy === toCcy) return raw;
    const num = parseFloat(raw);
    if (!isFinite(num)) return raw;
    const usd = fromCcy === 'THB' ? num / fxNum : num;
    const out = toCcy === 'THB' ? usd * fxNum : usd;
    return String(Number(out.toFixed(6)));
  };

  const totalAmount = useMemo(() => {
    const q = parseFloat(qty) || 0;
    if (isCashFlow) {
      const f = parseFloat(fees) || 0;
      const t = parseFloat(taxes) || 0;
      const base = q * 1;
      if (txType === 'Withdraw') return base - f - t;
      return base + f + t;
    }
    const prRaw = parseFloat(price) || 0;
    const fRaw = parseFloat(fees) || 0;
    const tRaw = parseFloat(taxes) || 0;
    const pr = toUsd(prRaw, priceCcy);
    const f  = toUsd(fRaw, feesCcy);
    const t  = toUsd(tRaw, taxesCcy);
    const base = q * pr;
    if (txType === 'Sell') return base - f - t;
    return base + f + t;
  }, [qty, price, fees, taxes, txType, isCashFlow, priceCcy, feesCcy, taxesCcy, fxNum]); // eslint-disable-line react-hooks/exhaustive-deps

  const displaySymbol = isCashFlow ? fmtCurrencySym(depositCcy) : fmtCurrencySym(entryCcy);
  const displayTotal = isCashFlow
    ? totalAmount
    : (entryCcy === 'THB' ? totalAmount * fxNum : totalAmount);

  const settlementCurrency = isCashFlow
    ? depositCcy
    : (catalog.find(a => a.ticker === (ticker || '').toUpperCase().trim())?.settlement_currency || 'USD');
  const availableCash = useMemo(
    () => portfolio ? computeCashBalance(transactions, portfolio, settlementCurrency, catalog) : 0,
    [transactions, portfolio, settlementCurrency, catalog]
  );
  const cashDebit = useMemo(() => {
    const amt = parseFloat(qty) || 0;
    if (isCashFlow) {
      if (txType !== 'Withdraw') return 0;
      return amt;
    }
    if (txType !== 'Buy') return 0;
    const prUsd = toUsd(parseFloat(price) || 0, priceCcy);
    const fUsd  = toUsd(parseFloat(fees)  || 0, feesCcy);
    const tUsd  = toUsd(parseFloat(taxes) || 0, taxesCcy);
    return amt * prUsd + fUsd + tUsd;
  }, [isCashFlow, txType, qty, price, fees, taxes, priceCcy, feesCcy, taxesCcy, fxNum]); // eslint-disable-line react-hooks/exhaustive-deps
  const cashShortfall = cashDebit > availableCash + 0.000001;

  const sellTickerKey = (!isCashFlow && ticker ? ticker.toUpperCase().trim() : '');
  const sharesHeld = useMemo(
    () => (portfolio && txType === 'Sell' && sellTickerKey
      ? computeSharesHeld(transactions, portfolio, sellTickerKey)
      : 0),
    [portfolio, txType, sellTickerKey, transactions]
  );
  const sellQty = txType === 'Sell' ? (parseFloat(qty) || 0) : 0;
  const sharesShortfall = txType === 'Sell' && sellQty > sharesHeld + 0.00000001;

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
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: SOURCES[portfolio]?.color || '#888' }}></span>
              <span>{portfolio}</span>
              <button onClick={() => setPortfolio(null)} style={{ marginLeft: 6, fontSize: 12, color: 'var(--text-dim)', textDecoration: 'underline' }}>change</button>
            </div>
            {txType === 'Sell' ? (
              <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: sharesShortfall ? 'var(--red)' : 'var(--text-dim)' }}>
                Holding: {sharesHeld.toLocaleString('en-US', { maximumFractionDigits: 8 })} {sellTickerKey || 'shares'}
                {sellQty > 0 && (
                  <span style={{ marginLeft: 8, color: 'var(--text-faint)', fontWeight: 400 }}>
                    · selling {sellQty.toLocaleString('en-US', { maximumFractionDigits: 8 })}
                  </span>
                )}
              </div>
            ) : (
              <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: cashShortfall ? 'var(--red)' : 'var(--text-dim)' }}>
                Available: {fmtCurrencySym(settlementCurrency)}{availableCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {settlementCurrency}
                {cashDebit > 0 && (
                  <span style={{ marginLeft: 8, color: 'var(--text-faint)', fontWeight: 400 }}>
                    · this tx needs {fmtCurrencySym(settlementCurrency)}{cashDebit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>
            )}
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

          {!isCashFlow && (
            <div className="field">
              <label>Entry Currency</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
                  {['USD', 'THB'].map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setEntryCcy(c);
                        setPrice(convertValue(price, priceCcy, c));
                        setFees(convertValue(fees, feesCcy, c));
                        setTaxes(convertValue(taxes, taxesCcy, c));
                        setPriceCcy(c); setFeesCcy(c); setTaxesCcy(c);
                        if (c === 'THB' && !fxRate) setFxRate(String(FX_RATE));
                      }}
                      className="field-input"
                      style={{
                        cursor: 'pointer', fontWeight: 600, padding: '0 18px',
                        borderColor: entryCcy === c ? 'var(--accent)' : undefined,
                        color: entryCcy === c ? 'var(--accent)' : 'var(--text)',
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                {entryCcy === 'THB' && (
                  <div className="field-with-suffix" style={{ flex: 1 }}>
                    <input className="field-input" inputMode="decimal" placeholder="THB per USD" value={fxRate} onChange={e => setFxRate(e.target.value)} />
                    <span className="field-suffix">THB / USD</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {!isCashFlow && (
            <div className="field">
              <label>Add {assetType}</label>
              <AssetSearchInput
                assetType={assetType}
                catalog={catalog}
                value={ticker}
                onChange={(v) => { setTicker(v); setPriceUserEdited(false); }}
                onAssetCreated={() => setCatalogVersion(v => v + 1)}
                placeholder={placeholderTicker}
              />
            </div>
          )}

          {isCashFlow && (
            <div className="field">
              <label>Currency</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['USD', 'THB'].map(c => (
                  <button key={c} type="button" onClick={() => setDepositCcy(c)} className="field-input"
                    style={{ flex: 1, cursor: 'pointer', fontWeight: 600, borderColor: depositCcy === c ? 'var(--accent)' : undefined, color: depositCcy === c ? 'var(--accent)' : 'var(--text)' }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <label>{isCashFlow ? `Amount (${depositCcy})` : 'Quantity'}</label>
            <input className="field-input" placeholder={isCashFlow ? `e.g. ${fmtCurrencySym(depositCcy)}1,000.00` : 'e.g. 10'} value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal" />
          </div>

          <div className="field">
            <label>Transaction Date</label>
            <div className="field-with-icon" style={{ position: 'relative' }}>
              <input className="field-input" value={dateText} onChange={e => setDateText(e.target.value)} placeholder="DD/MM/YYYY" />
              <button type="button" ref={dateIconRef} onClick={() => setDatePopOpen(o => !o)} aria-label="Open calendar"
                style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: 4, display: 'inline-flex' }}>
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

          {!isCashFlow && (
            <div className="field">
              <label>{txType === 'Sell' ? 'Sale' : 'Purchase'} Price</label>
              <div className="field-with-suffix">
                <input className="field-input" placeholder={priceLoading ? 'Fetching…' : `e.g. ${fmtCurrencySym(priceCcy)}150.00`}
                  value={price} onChange={e => { setPrice(e.target.value); setPriceAutoFilled(false); setPriceUserEdited(true); }} inputMode="decimal" />
                <CurrencySuffix value={priceCcy} onChange={c => { setPrice(convertValue(price, priceCcy, c)); setPriceCcy(c); }} />
              </div>
              {priceAutoFilled && !priceLoading && (
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>Auto-filled from Yahoo Finance · close on {dateIso}</div>
              )}
            </div>
          )}

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
                  <input className="field-input" placeholder={`e.g. ${fmtCurrencySym(feesCcy)}10.00`} value={fees} onChange={e => setFees(e.target.value)} inputMode="decimal" />
                  <CurrencySuffix value={feesCcy} onChange={c => { setFees(convertValue(fees, feesCcy, c)); setFeesCcy(c); }} />
                </div>
              </div>
              <div className="field">
                <label>Taxes</label>
                <div className="field-with-suffix">
                  <input className="field-input" placeholder={`e.g. ${fmtCurrencySym(taxesCcy)}15.00`} value={taxes} onChange={e => setTaxes(e.target.value)} inputMode="decimal" />
                  <CurrencySuffix value={taxesCcy} onChange={c => { setTaxes(convertValue(taxes, taxesCcy, c)); setTaxesCcy(c); }} />
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
            <span className="total-val">{displaySymbol}{displayTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          {error && (
            <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 10, padding: '8px 12px', background: 'rgba(248,113,113,0.1)', borderRadius: 8 }}>
              {error}
            </div>
          )}
          <div className="btn-stack">
            <button className="btn-primary" disabled={submitting} style={{ opacity: submitting ? 0.5 : 1 }}
              onClick={async () => {
                if (!isCashFlow && !ticker) { setError('Pick a ticker first.'); return; }
                if (!qty || !(parseFloat(qty) > 0)) { setError(isCashFlow ? 'Enter an amount.' : 'Enter a quantity.'); return; }
                if (sharesShortfall) {
                  setError(`Not enough shares — you hold ${sharesHeld.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${sellTickerKey}.`);
                  return;
                }
                setSubmitting(true);
                setError(null);
                try {
                  const executedAt = bkkPartsToUtcIso(dateIso, time);
                  const amount = parseFloat(qty) || 0;
                  const submitTicker = isCashFlow ? depositCcy : ticker.toUpperCase().trim();
                  const fx = parseFloat(fxRate) || FX_RATE;
                  // THB cash stores price as USD-per-THB at the tx-date FX, so its
                  // cost basis is the baht-value-in-USD you actually deposited
                  // (not 1:1). USD cash is 1. fx here is the transaction-date rate.
                  const priceUsd = isCashFlow
                    ? (depositCcy === 'THB' ? 1 / fx : 1)
                    : (price === '' ? null : toUsd(parseFloat(price) || 0, priceCcy));
                  const feesUsd  = isCashFlow ? (parseFloat(fees) || 0) : toUsd(parseFloat(fees) || 0, feesCcy);
                  const taxesUsd = isCashFlow ? (parseFloat(taxes) || 0) : toUsd(parseFloat(taxes) || 0, taxesCcy);
                  const submitValueUsd = isCashFlow
                    ? (depositCcy === 'THB' ? amount / fx : amount)
                    : (totalAmount || (amount * (priceUsd || 0)) || 0);
                  await addTransaction({
                    portfolio, ticker: submitTicker, action: txType,
                    shares: amount || null, price: priceUsd, valueUsd: submitValueUsd,
                    fees: feesUsd, taxes: taxesUsd, description, executedAt, fxRateAtTx: fx,
                  });
                  onAdded?.();
                } catch (err) {
                  setError(supabaseEnabled ? err.message : 'Supabase not configured — add your env vars to save data.');
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting ? 'Saving…' : 'Add transaction'}
            </button>
            <button className="btn-secondary" onClick={() => {
              setTicker(''); setQty(''); setPrice(''); setFees(''); setTaxes('');
              setEntryCcy('USD'); setPriceCcy('USD'); setFeesCcy('USD'); setTaxesCcy('USD');
              setFxRate(String(FX_RATE));
              setPriceAutoFilled(false); setPriceUserEdited(false); setError(null);
            }}>
              Save and Add Another
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
