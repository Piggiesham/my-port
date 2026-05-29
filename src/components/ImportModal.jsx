import { useState, useRef, useEffect, useMemo } from 'react';
import { SOURCES, PORTFOLIO_TYPES, FX_RATE, utcIsoToBkkParts, bkkPartsToUtcIso, fmtDateBkk, fmtCurrencySym } from '../data.js';
import { addTransaction, parseTransactionsImage, parseWebullCSV, fetchHistoricalPrice, txFingerprint, importedRowFingerprint, fetchAssetCatalog, createAsset, searchYahooSymbols } from '../lib/api.js';

// Same mapping used by AddTransactionModal so auto-created assets get the
// correct internal type label.
const YAHOO_TYPE_TO_ASSET = {
  EQUITY: 'Stock',
  ETF: 'ETF',
  MUTUALFUND: 'ETF',
  CRYPTOCURRENCY: 'Crypto',
  CURRENCY: 'Cash',
};

// Per-brokerage import sources. Webull exports CSVs (parsed in-browser);
// Dime! uploads are screenshots that go through the Gemini edge function.
const BROKER_SOURCE = {
  'Dime!':   'image',
  'Webull':  'csv',
  'Binance': null,   // not supported yet
};

export default function ImportModal({ onClose, onDone, transactions = [] }) {
  const [step, setStep] = useState('brokerage'); // brokerage → bucket → upload → preview
  const [portfolio, setPortfolio] = useState(null);
  const [bucket, setBucket] = useState(null);
  const [files, setFiles] = useState([]); // { file, preview }
  const [analyzing, setAnalyzing] = useState(false);
  const [rows, setRows] = useState([]); // parsed rows, mutable in preview
  const [expandedRowId, setExpandedRowId] = useState(null);
  const [skipped, setSkipped] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null); // { ok, fail: [{row, err}] }
  const fileInputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !analyzing && !submitting) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, analyzing, submitting]);

  const source = BROKER_SOURCE[portfolio] || 'image';

  const onFilesPicked = (list) => {
    if (!list || list.length === 0) return;
    const picked = Array.from(list);
    const isCsv = (f) => f.type === 'text/csv' || /\.csv$/i.test(f.name);
    if (source === 'image' && picked.find(f => !f.type.startsWith('image/'))) {
      setError('This brokerage expects screenshots. CSVs aren’t supported here.');
      return;
    }
    if (source === 'csv' && picked.find(f => !isCsv(f))) {
      setError('This brokerage expects CSV exports. Images aren’t supported here.');
      return;
    }
    setError(null);
    picked.forEach((f) => {
      if (source === 'image') {
        const reader = new FileReader();
        reader.onload = (e) => {
          const preview = e.target?.result || null;
          setFiles(prev => [...prev, { file: f, preview }]);
        };
        reader.readAsDataURL(f);
      } else {
        setFiles(prev => [...prev, { file: f, preview: null }]);
      }
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (idx) => setFiles(arr => arr.filter((_, i) => i !== idx));

  const analyze = async () => {
    if (files.length === 0) return;
    setAnalyzing(true);
    setError(null);
    try {
      let merged = [];
      let skippedTotal = 0;
      let nextId = 0;
      if (source === 'csv') {
        // CSV path — runs locally, no rate limit. Read each file and parse.
        for (let i = 0; i < files.length; i++) {
          const text = await files[i].file.text();
          const { rows, skipped } = parseWebullCSV(text);
          skippedTotal += skipped;
          for (const r of rows) merged.push({ ...r, _id: nextId++ });
        }
      } else {
        // Image path — 4s between calls keeps us under both 5/min
        // (gemini-2.5-flash) and 15/min (lite).
        for (let i = 0; i < files.length; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, 4000));
          const { rows, skipped } = await parseTransactionsImage(files[i].file, portfolio, bucket);
          skippedTotal += skipped;
          for (const r of rows) merged.push({ ...r, _id: nextId++ });
        }
      }

      const localBrokerMap = { 'Dime!': 'dime', 'Webull': 'webull', 'Binance': 'binance' };
      const bId = localBrokerMap[portfolio] ?? portfolio;

      const existingKeys = new Set(
        (transactions || [])
          .filter(t => (localBrokerMap[t.source] ?? t.source) === bId)
          .map(txFingerprint)
      );
      const seenInBatch = new Set();
      merged = merged.map((r) => {
        const fp = importedRowFingerprint(r, bId);
        if (existingKeys.has(fp)) return { ...r, _selected: false, _duplicate: 'db', _fp: fp };
        if (seenInBatch.has(fp))  return { ...r, _selected: false, _duplicate: 'batch', _fp: fp };
        seenInBatch.add(fp);
        return { ...r, _selected: true, _duplicate: null, _fp: fp };
      });

      setRows(merged);
      setSkipped(skippedTotal);
      setStep('preview');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setAnalyzing(false);
    }
  };

  const patchRow = (id, patch) => setRows(arr => arr.map(r => r._id === id ? { ...r, ...patch } : r));
  const removeRow = (id) => setRows(arr => arr.filter(r => r._id !== id));

  const submitAll = async () => {
    setSubmitting(true);
    setError(null);
    const ok = [];
    const fail = [];

    // Insert in chronological order so a Sell never lands before its funding
    // Buy (apply_holdings_delta checks current qty, not a historical view).
    const selected = rows
      .filter(r => r._selected)
      .slice()
      .sort((a, b) => new Date(a.executedAt) - new Date(b.executedAt));

    // Auto-create any ticker that's not yet in the catalog — fixes
    // transactions_ticker_fkey failures on first-time imports. createAsset
    // hits Yahoo for name/sector/logo metadata automatically.
    let catalog = [];
    try { catalog = await fetchAssetCatalog(); } catch { /* non-fatal */ }
    const knownTickers = new Set(catalog.map(a => a.ticker.toUpperCase()));
    const neededTickers = [...new Set(selected.map(r => r.ticker.toUpperCase()))]
      .filter(t => !knownTickers.has(t));
    for (const t of neededTickers) {
      try {
        // Enrich via Yahoo so the asset row gets a real name + correct type
        // (ETF vs Stock) instead of just the ticker as a stub.
        let name = t;
        let type = 'Stock';
        try {
          const results = await searchYahooSymbols(t);
          const exact = (results || []).find(
            r => (r.symbol || '').toUpperCase() === t.toUpperCase()
          );
          if (exact) {
            name = exact.name || t;
            type = YAHOO_TYPE_TO_ASSET[exact.type] || 'Stock';
          }
        } catch { /* Yahoo failures non-fatal; we'll fall back to the stub */ }
        await createAsset({ ticker: t, name, type });
        knownTickers.add(t);
      } catch (err) {
        // If asset creation fails, the per-row insert below will fail with a
        // clearer FK error and the user can see which ticker is the problem.
        console.warn('[import] createAsset failed for', t, err?.message || err);
      }
    }

    for (const r of selected) {
      try {
        const dateStr = r.executedAt.slice(0, 10);
        let fx = FX_RATE;
        try {
          const p = await fetchHistoricalPrice('THB', dateStr);
          if (p && p > 0) fx = 1 / p;
        } catch { /* fall back to default */ }
        const priceUsd = r.currency === 'THB' ? r.executedPrice / fx : r.executedPrice;
        const qty = Number(r.qty) || 0;
        const valueUsd = qty * priceUsd;
        const feesUsd  = r.currency === 'THB' ? (Number(r.fees)  || 0) / fx : (Number(r.fees)  || 0);
        const taxesUsd = r.currency === 'THB' ? (Number(r.taxes) || 0) / fx : (Number(r.taxes) || 0);
        await addTransaction({
          portfolio,
          ticker: r.ticker.toUpperCase(),
          action: r.action,
          shares: qty,
          price: priceUsd,
          valueUsd,
          fees: feesUsd,
          taxes: taxesUsd,
          description: 'import',
          executedAt: r.executedAt,
          fxRateAtTx: fx,
        });
        ok.push(r._id);
      } catch (err) {
        fail.push({ id: r._id, ticker: r.ticker, err: err.message || String(err) });
      }
    }
    setResults({ ok: ok.length, fail });
    setSubmitting(false);
    if (fail.length === 0) onDone?.();
  };

  // ---- Step renderers -------------------------------------------------------
  const renderBrokerage = () => (
    <div className="modal-body">
      <p className="picker-prompt">Which portfolio does this import belong to?</p>
      <div className="picker-grid">
        {[
          { id: 'Dime!',   enabled: true,  hint: 'Screenshots' },
          { id: 'Webull',  enabled: true,  hint: 'Monthly CSV statement' },
          { id: 'Binance', enabled: false, hint: 'Coming soon' },
        ].map(b => (
          <button
            key={b.id}
            className="picker-card"
            disabled={!b.enabled}
            style={{ opacity: b.enabled ? 1 : 0.45, cursor: b.enabled ? 'pointer' : 'not-allowed' }}
            onClick={() => { if (b.enabled) { setPortfolio(b.id); setStep('bucket'); } }}
          >
            <span className="src-dot-lg" style={{ background: SOURCES[b.id].color }}>{b.id[0]}</span>
            <span className="pc-info">
              <span className="pc-name">{b.id}</span>
              <span className="pc-sub">{b.enabled ? `${PORTFOLIO_TYPES[b.id].join(' · ')} · ${b.hint}` : b.hint}</span>
            </span>
            <svg className="pc-arrow" width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M6 4l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        ))}
      </div>
    </div>
  );

  const renderBucket = () => (
    <div className="modal-body">
      <p className="picker-prompt">What asset type are you importing?</p>
      <div className="picker-grid">
        {[
          { id: 'security', label: 'Security', enabled: true, sub: 'Stocks, ETFs (Buy/Sell)' },
          { id: 'bond',     label: 'Bond',     enabled: false, sub: 'Coming soon' },
          { id: 'cash',     label: 'Cash',     enabled: false, sub: 'Coming soon' },
        ].map(b => (
          <button
            key={b.id}
            className="picker-card"
            disabled={!b.enabled}
            style={{ opacity: b.enabled ? 1 : 0.45, cursor: b.enabled ? 'pointer' : 'not-allowed' }}
            onClick={() => { if (b.enabled) { setBucket(b.id); setStep('upload'); } }}
          >
            <span className="pc-info">
              <span className="pc-name">{b.label}</span>
              <span className="pc-sub">{b.sub}</span>
            </span>
            <svg className="pc-arrow" width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M6 4l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        ))}
      </div>
    </div>
  );

  const renderUpload = () => {
    const isCsv = source === 'csv';
    const prompt = isCsv
      ? 'Upload one or more Webull monthly-statement CSVs.'
      : 'Upload one or more screenshots of your transaction list.';
    const chooseLabel = files.length === 0
      ? (isCsv ? 'Click to choose CSV files' : 'Click to choose images')
      : (isCsv ? '+ Add more CSV files' : '+ Add more images');
    return (
      <div className="modal-body">
        <p className="picker-prompt">{prompt}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept={isCsv ? '.csv,text/csv' : 'image/*'}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => onFilesPicked(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{ width: '100%', padding: 16, border: '1px dashed var(--border)', borderRadius: 10, background: 'var(--panel-2)', color: 'var(--text-dim)', fontSize: 13 }}
        >
          {chooseLabel}
        </button>
        {files.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflow: 'auto' }}>
            {files.map((f, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 24px', gap: 10, alignItems: 'center', padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
                {f.preview ? (
                  <img src={f.preview} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 4 }} />
                ) : (
                  <div style={{ width: 60, height: 60, background: 'var(--panel-2)', borderRadius: 4, display: 'grid', placeItems: 'center', color: 'var(--text-faint)', fontSize: 11, fontWeight: 600 }}>CSV</div>
                )}
                <div style={{ fontSize: 12, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file.name}</div>
                <button type="button" onClick={() => removeFile(idx)} aria-label="Remove" style={{ color: 'var(--text-faint)', fontSize: 16 }}>✕</button>
              </div>
            ))}
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 12 }}>
          {isCsv
            ? 'Only Buy/Sell stock rows under TRADE RECORDS are extracted. Options, portfolio summary, and dividends are skipped. Overlapping rows across CSVs are deduplicated automatically.'
            : 'Only Buy/Sell rows will be extracted. Fees, dividends, and dividend tax are skipped. Overlapping rows across images are deduplicated automatically.'}
        </p>
      </div>
    );
  };

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => new Date(b.executedAt) - new Date(a.executedAt)),
    [rows]
  );

  const renderPreview = () => (
    <div className="modal-body">
      {(() => {
        const dupes = rows.filter(r => r._duplicate).length;
        const fresh = rows.length - dupes;
        return (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
            Parsed <strong>{rows.length}</strong> Buy/Sell row{rows.length === 1 ? '' : 's'}
            {' '}({fresh} new{dupes > 0 && <>, {dupes} duplicate{dupes === 1 ? '' : 's'}</>})
            {skipped > 0 && <> · Skipped {skipped} non-trade row{skipped === 1 ? '' : 's'}</>}
          </div>
        );
      })()}
      {rows.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
          No Buy/Sell rows found in the image.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflow: 'auto' }}>
          {sortedRows.map(r => {
            const expanded = r._id === expandedRowId;
            const actionColor = r.action === 'Buy' ? 'var(--green)' : 'var(--red)';
            const priceStr = (Number(r.executedPrice) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
            return (
              <div key={r._id} style={{ border: '1px solid var(--border)', borderRadius: 8, opacity: r._selected ? 1 : 0.45 }}>
                {/* Collapsed row — click anywhere except the checkbox to toggle expand */}
                <div
                  onClick={() => setExpandedRowId(expanded ? null : r._id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '24px 1fr 110px 130px auto',
                    gap: 10,
                    alignItems: 'center',
                    padding: '10px 12px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={r._selected}
                    onChange={e => patchRow(r._id, { _selected: e.target.checked })}
                    onClick={e => e.stopPropagation()}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    <span style={{ color: actionColor, marginRight: 8 }}>{r.action}</span>
                    <span>{r.ticker}</span>
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    {fmtDateBkk(r.executedAt)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }}>
                    {fmtCurrencySym(r.currency)}{priceStr} {r.currency}
                  </span>
                  <span style={{ minWidth: 80, textAlign: 'right' }}>
                    {r._duplicate && (
                      <span style={{ fontSize: 10, color: 'var(--text-faint)', padding: '2px 6px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 4 }}>
                        duplicate ({r._duplicate === 'db' ? 'in DB' : 'in batch'})
                      </span>
                    )}
                  </span>
                </div>

                {/* Expanded edit form — only renders when this row is the active one */}
                {expanded && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '10px 12px 12px', borderTop: '1px solid var(--border)' }}>
                    <input className="field-input" value={r.ticker} onChange={e => patchRow(r._id, { ticker: e.target.value.toUpperCase() })} placeholder="Ticker" style={{ fontSize: 12 }} />
                    <input className="field-input" value={r.qty} onChange={e => patchRow(r._id, { qty: parseFloat(e.target.value) || 0 })} placeholder="Qty" inputMode="decimal" style={{ fontSize: 12 }} />
                    <input className="field-input" value={r.executedPrice} onChange={e => patchRow(r._id, { executedPrice: parseFloat(e.target.value) || 0 })} placeholder="Price" inputMode="decimal" style={{ fontSize: 12 }} />
                    <div className="field-with-suffix" title="Currency of the Executed Price column.">
                      <select className="field-input" value={r.currency} onChange={e => patchRow(r._id, { currency: e.target.value })} style={{ fontSize: 12 }}>
                        <option value="USD">Price in USD</option>
                        <option value="THB">Price in THB</option>
                      </select>
                    </div>
                    {(() => {
                      const parts = utcIsoToBkkParts(r.executedAt);
                      return (
                        <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 90px', gap: 6 }}>
                          <input
                            type="date"
                            className="field-input"
                            value={parts.date}
                            onChange={e => patchRow(r._id, { executedAt: bkkPartsToUtcIso(e.target.value, parts.time) })}
                            style={{ fontSize: 12 }}
                          />
                          <input
                            type="time"
                            className="field-input"
                            value={parts.time}
                            onChange={e => patchRow(r._id, { executedAt: bkkPartsToUtcIso(parts.date, e.target.value) })}
                            style={{ fontSize: 12 }}
                          />
                        </div>
                      );
                    })()}
                    <button type="button" onClick={() => removeRow(r._id)} style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--text-faint)', textAlign: 'right', textDecoration: 'underline' }}>remove</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {results && (
        <div style={{ marginTop: 12, fontSize: 12 }}>
          <div style={{ color: 'var(--green)' }}>Imported: {results.ok}</div>
          {results.fail.length > 0 && (
            <div style={{ color: 'var(--red)', marginTop: 4 }}>
              Failed: {results.fail.length}
              <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                {results.fail.map(f => <li key={f.id}>{f.ticker}: {f.err}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const headTitle = step === 'brokerage' ? 'Import — pick portfolio'
                  : step === 'bucket' ? 'Import — pick asset type'
                  : step === 'upload' ? 'Import — upload file'
                  : 'Import — review rows';

  return (
    <div className="modal-backdrop" onClick={analyzing || submitting ? undefined : onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{headTitle}</h2>
            {portfolio && (
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: SOURCES[portfolio]?.color || '#888' }}></span>
                <span>{portfolio}{bucket ? ` · ${bucket}` : ''}</span>
              </div>
            )}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close" disabled={analyzing || submitting}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </button>
        </div>

        {step === 'brokerage' && renderBrokerage()}
        {step === 'bucket' && renderBucket()}
        {step === 'upload' && renderUpload()}
        {step === 'preview' && renderPreview()}

        <div className="modal-foot">
          {error && (
            <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 10, padding: '8px 12px', background: 'rgba(248,113,113,0.1)', borderRadius: 8 }}>
              {error}
            </div>
          )}
          <div className="btn-stack">
            {step === 'upload' && (
              <button className="btn-primary" disabled={files.length === 0 || analyzing} onClick={analyze}>
                {(() => {
                  if (analyzing) return 'Analyzing…';
                  const label = source === 'csv' ? 'CSV' : 'image';
                  return files.length > 1 ? `Analyze ${files.length} ${label}s` : `Analyze ${label}`;
                })()}
              </button>
            )}
            {step === 'preview' && (
              <button className="btn-primary" disabled={submitting || rows.filter(r => r._selected).length === 0} onClick={submitAll}>
                {submitting ? 'Importing…' : `Import ${rows.filter(r => r._selected).length} row${rows.filter(r => r._selected).length === 1 ? '' : 's'}`}
              </button>
            )}
            <button className="btn-secondary" onClick={onClose} disabled={analyzing || submitting}>
              {results && results.fail.length === 0 ? 'Done' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
