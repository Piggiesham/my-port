import { useState, useMemo, useRef, useEffect } from 'react';
import { createAsset, searchYahooSymbols } from '../lib/api.js';
import { useClickOutside } from '../lib/useClickOutside.js';

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

export function AssetSearchInput({ assetType, catalog, value, onChange, onAssetCreated, placeholder }) {
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

  useClickOutside(wrapRef, () => { setOpen(false); setCreating(false); });

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
