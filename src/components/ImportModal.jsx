import { useState, useRef, useEffect, useMemo } from 'react';
import { SOURCES, PORTFOLIO_TYPES, FX_RATE, utcIsoToBkkParts, bkkPartsToUtcIso, fmtDateBkk, fmtCurrencySym } from '../data.js';
import { importTransactions, parseTransactionsImage, fetchHistoricalPrice, txFingerprint, importedRowFingerprint, fetchAssetCatalog, createAsset, searchYahooSymbols } from '../lib/api.js';

// Same mapping used by AddTransactionModal so auto-created assets get the
// correct internal type label.
const YAHOO_TYPE_TO_ASSET = {
  EQUITY: 'Stock',
  ETF: 'ETF',
  MUTUALFUND: 'ETF',
  CRYPTOCURRENCY: 'Crypto',
  CURRENCY: 'Cash',
};

// Per-brokerage import sources. Webull uploads are monthly statement PDFs
// (they carry dividends/interest/deposits the CSV export lacks); Dime!
// uploads are screenshots. Both go through the Gemini edge function.
const BROKER_SOURCE = {
  'Dime!':   'image',
  'Webull':  'pdf',
  'Binance': null,   // not supported yet
};

// Cash-only imported row types — they carry a USD `value` instead of qty/price.
const CASH_ROW = new Set(['Dividend', 'Fee', 'Tax']);

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
  const [results, setResults] = useState(null); // { attempted: true } once a submit has run
  const [depositEdits, setDepositEdits] = useState({}); // proposed-deposit id → edited amount
  const fileInputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !analyzing && !submitting) closeModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, onDone, analyzing, submitting, rows]);

  const source = BROKER_SOURCE[portfolio] || 'image';

  const onFilesPicked = (list) => {
    if (!list || list.length === 0) return;
    const picked = Array.from(list);
    const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    if (source === 'image' && picked.find(f => !f.type.startsWith('image/'))) {
      setError('This brokerage expects screenshots. PDFs aren’t supported here.');
      return;
    }
    if (source === 'pdf' && picked.find(f => !isPdf(f))) {
      setError('This brokerage expects monthly statement PDFs. Images aren’t supported here.');
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
      // Image/PDF path — 4s between calls keeps us under both 5/min
      // (gemini-2.5-flash) and 15/min (lite).
      for (let i = 0; i < files.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 4000));
        const { rows, skipped } = await parseTransactionsImage(files[i].file, portfolio, bucket);
        skippedTotal += skipped;
        for (const r of rows) merged.push({ ...r, _id: nextId++ });
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

  // Close such that the parent refetches if we actually wrote anything —
  // onDone refreshes + closes, onClose just closes. Covers backdrop / Esc /
  // the footer button so a partial import is never silently left unrefreshed.
  const closeModal = () => {
    if (rows.some(r => r._status === 'ok')) onDone?.();
    else onClose();
  };

  // Auto-create any ticker not yet in the catalog so the atomic import
  // doesn't trip transactions_ticker_fkey (which would roll back the batch).
  // Asset rows are reference data — harmless to create even if the import
  // itself later rolls back.
  const ensureAssets = async (tickers) => {
    let catalog = [];
    try { catalog = await fetchAssetCatalog(); } catch { /* non-fatal */ }
    const known = new Set(catalog.map(a => a.ticker.toUpperCase()));
    for (const t of tickers.filter(t => !known.has(t))) {
      try {
        let name = t, type = 'Stock';
        try {
          const res = await searchYahooSymbols(t);
          const exact = (res || []).find(x => (x.symbol || '').toUpperCase() === t.toUpperCase());
          if (exact) { name = exact.name || t; type = YAHOO_TYPE_TO_ASSET[exact.type] || 'Stock'; }
        } catch { /* fall back to stub */ }
        await createAsset({ ticker: t, name, type });
        known.add(t);
      } catch (err) {
        console.warn('[import] createAsset failed for', t, err?.message || err);
      }
    }
  };

  // Resolve the day's USD-per-THB so THB-priced rows convert correctly.
  const fxForDate = async (iso) => {
    let fx = FX_RATE;
    try {
      const p = await fetchHistoricalPrice('THB', iso.slice(0, 10));
      if (p && p > 0) fx = 1 / p;
    } catch { /* default */ }
    return fx;
  };

  const isoBefore = (iso) => new Date(new Date(iso).getTime() - 1000).toISOString();

  // Friendly read of a rolled-back row's RPC error. The RPCs raise stable,
  // parseable messages, wrapped by import_transactions as "row N (...): <msg>".
  //   "USD cash at dime goes negative — lowest point: -55.40"
  //   "Not enough shares: dime has 0 of INTC, attempted delta -8.36"
  const diagnose = (msg = '') => {
    let m = msg.match(/(\w+)\s+cash at\s+\S+\s+goes negative.*?(-?[\d.]+)/);
    if (m) return { kind: 'cash', currency: m[1], shortfall: Math.abs(parseFloat(m[2])) };
    m = msg.match(/Not enough shares:\s*\S+\s+has\s+(-?[\d.]+)\s+of\s+(\S+).*?delta\s+(-?[\d.]+)/);
    if (m) return { kind: 'shares', heldQty: parseFloat(m[1]), ticker: m[2].replace(/,$/, ''), needed: Math.abs(parseFloat(m[3])) };
    return { kind: 'other' };
  };

  const skipRow = (id) => patchRow(id, { _status: 'skip', _selected: false });

  // ---- Pre-flight: simulate the batch and propose fixes up front -----------
  // Replays the selected rows' USD cash + per-ticker share trajectory starting
  // from the current DB balances, so we can fund every Buy and flag orphan
  // Sells *before* importing. Dime! securities settle in USD, so funding
  // deposits are USD. THB-priced rows convert at the constant FX_RATE here
  // (good enough for the estimate; the real insert uses historical FX).
  const TOL = 0.000001;
  const rowCostUsd = (r) => {
    const qty = Number(r.qty) || 0;
    const priceUsd = r.currency === 'THB' ? (Number(r.executedPrice) || 0) / FX_RATE : (Number(r.executedPrice) || 0);
    const fees = Number(r.fees) || 0, taxes = Number(r.taxes) || 0;
    return { buy: qty * priceUsd + fees + taxes, sell: qty * priceUsd - fees - taxes };
  };

  const preflight = useMemo(() => {
    if (!portfolio) return { deposits: [], orphans: [] };
    const sel = rows.filter(r => r._selected && r._status !== 'ok' && r._status !== 'skip');
    if (sel.length === 0) return { deposits: [], orphans: [] };

    // Build the FULL merged timeline — existing committed transactions for this
    // brokerage plus the new rows — and replay it from zero in date order. This
    // mirrors exactly what the atomic RPC's cash-trajectory check sees. Walking
    // only the new rows from today's balance is wrong for back-dated imports:
    // at an earlier date the real balance is lower than today's total, so
    // shortfalls get missed and the RPC then rejects a row pre-flight "approved".
    const events = [];
    for (const t of transactions) {
      if (t.source !== portfolio) continue;            // existing → order 0
      const tk = (t.ticker || '').toUpperCase();
      const shares = Number(t.shares) || 0;
      const price = Number(t.price) || 0;
      const fees = Number(t.fees) || 0;
      const taxes = Number(t.taxes) || 0;
      const value = Number(t.valueUSD) || 0;
      let cash = 0, sh = 0;
      if (t.action === 'Deposit')       cash = tk === 'USD' ? shares : 0;
      else if (t.action === 'Withdraw') cash = tk === 'USD' ? -shares : 0;
      else if (t.action === 'Buy')      { cash = -(shares * price + fees + taxes); sh = shares; }
      else if (t.action === 'Sell')     { cash = (shares * price - fees - taxes); sh = -shares; }
      else if (t.action === 'Dividend') cash = value;
      else if (t.action === 'Fee')      cash = -value;
      else if (t.action === 'Tax')      cash = -value;
      events.push({ ms: new Date(t.date).getTime(), order: 0, ticker: tk, cash, sh });
    }
    for (const r of sel) {                              // new rows → order 1
      const tk = (r.ticker || '').toUpperCase();
      if (r.action === 'Deposit') {
        // Statement funding deposit — cash in, so the preflight doesn't
        // propose a duplicate fix-deposit for the buys it funds.
        events.push({ ms: new Date(r.executedAt).getTime(), order: 1, ticker: 'USD', cash: Number(r.value) || 0 });
        continue;
      }
      if (CASH_ROW.has(r.action)) {
        const v = Number(r.value) || 0;
        events.push({ ms: new Date(r.executedAt).getTime(), order: 1, ticker: tk, cash: r.action === 'Dividend' ? v : -v });
        continue;
      }
      const qty = Number(r.qty) || 0;
      const { buy, sell } = rowCostUsd(r);
      if (r.action === 'Buy')       events.push({ ms: new Date(r.executedAt).getTime(), order: 1, ticker: tk, newBuy: true, rowId: r._id, iso: r.executedAt, cost: buy, sh: qty });
      else if (r.action === 'Sell') events.push({ ms: new Date(r.executedAt).getTime(), order: 1, ticker: tk, newSell: true, rowId: r._id, iso: r.executedAt, proceeds: sell, qty });
    }
    events.sort((a, b) => a.ms - b.ms || a.order - b.order);

    // Pass 1 — replay shares; a new Sell that exceeds shares held at that point
    // is an orphan (no Buy behind it).
    const held = {};
    const orphans = [];
    const orphanIds = new Set();
    for (const e of events) {
      const tk = e.ticker;
      if (!tk || tk === 'USD' || tk === 'THB') continue;
      if (held[tk] == null) held[tk] = 0;
      if (e.newSell) {
        if (held[tk] - e.qty < -1e-6) { orphans.push({ rowId: e.rowId, ticker: tk, need: e.qty, held: Math.max(0, held[tk]) }); orphanIds.add(e.rowId); continue; }
        held[tk] -= e.qty;
      } else {
        held[tk] += e.sh || 0;
      }
    }

    // Pass 2 — replay USD cash; fund each new Buy that would dip below zero.
    let bal = 0;
    const deposits = [];
    for (const e of events) {
      if (e.rowId && orphanIds.has(e.rowId)) continue;  // skipped sells: no cash effect
      if (e.newBuy) {
        if (bal - e.cost < -TOL) {
          const need = Math.ceil((e.cost - bal) * 100) / 100;
          deposits.push({ id: `dep-${e.rowId}`, amount: need, beforeIso: isoBefore(e.iso), forTicker: e.ticker });
          bal += need;
        }
        bal -= e.cost;
      } else if (e.newSell) {
        bal += e.proceeds;
      } else {
        bal += e.cash;                                   // existing transaction
      }
    }
    return { deposits, orphans };
  }, [rows, transactions, portfolio]);

  const depositAmount = (d) => {
    const edited = depositEdits[d.id];
    const n = edited === undefined ? d.amount : parseFloat(edited);
    return isFinite(n) && n > 0 ? n : 0;
  };

  // Build the chronologically-ordered batch (funding deposits + trades) with
  // FX resolved, plus a parallel `meta` array so a server-side "row N" error
  // maps back to the offending preview row.
  const buildBatch = async (tradeRows, deposits) => {
    const entries = [];
    for (const d of deposits) {
      const amt = depositAmount(d);
      if (amt <= 0) continue;
      entries.push({
        sortIso: d.beforeIso,
        meta: { kind: 'deposit' },
        item: { portfolio, ticker: 'USD', action: 'Deposit', shares: amt, price: 1, valueUsd: amt, description: 'import-fix', executedAt: d.beforeIso },
      });
    }
    for (const r of tradeRows) {
      if (r.action === 'Deposit') {
        // Statement THB→USD exchange: shares = USD amount, fx = THB per USD.
        const amt = Number(r.value) || 0;
        entries.push({
          sortIso: r.executedAt,
          meta: { kind: 'trade', rowId: r._id },
          item: { portfolio, ticker: 'USD', action: 'Deposit', shares: amt, price: 1, valueUsd: amt, description: r.label || 'Statement deposit', executedAt: r.executedAt, fxRateAtTx: Number(r.fxRate) || null },
        });
        continue;
      }
      if (CASH_ROW.has(r.action)) {
        // Dividend / Fee / Tax — USD cash rows. value_usd carries the amount;
        // the broker label goes in description so re-imports dedup correctly.
        entries.push({
          sortIso: r.executedAt,
          meta: { kind: 'trade', rowId: r._id },
          item: { portfolio, ticker: (r.ticker || 'USD').toUpperCase(), action: r.action, valueUsd: Number(r.value) || 0, description: r.label || r.action, executedAt: r.executedAt },
        });
        continue;
      }
      const fx = await fxForDate(r.executedAt);
      const priceUsd = r.currency === 'THB' ? (Number(r.executedPrice) || 0) / fx : (Number(r.executedPrice) || 0);
      const qty = Number(r.qty) || 0;
      const feesUsd  = r.currency === 'THB' ? (Number(r.fees)  || 0) / fx : (Number(r.fees)  || 0);
      const taxesUsd = r.currency === 'THB' ? (Number(r.taxes) || 0) / fx : (Number(r.taxes) || 0);
      entries.push({
        sortIso: r.executedAt,
        meta: { kind: 'trade', rowId: r._id },
        item: { portfolio, ticker: r.ticker.toUpperCase(), action: r.action, shares: qty, price: priceUsd, valueUsd: qty * priceUsd, fees: feesUsd, taxes: taxesUsd, description: 'import', executedAt: r.executedAt, fxRateAtTx: fx },
      });
    }
    entries.sort((a, b) => new Date(a.sortIso) - new Date(b.sortIso));
    return { items: entries.map(e => e.item), meta: entries.map(e => e.meta) };
  };

  // Atomic import: one RPC call inserts the whole batch in a single DB
  // transaction. Success → every row committed. Failure → nothing committed
  // (rolled back); we flag the offending row and leave the preview editable so
  // the user can fix and import again.
  const runImport = async (tradeRows, deposits) => {
    if (tradeRows.length === 0) return;
    setSubmitting(true);
    setError(null);
    tradeRows.forEach(r => { if (r._status === 'fail') patchRow(r._id, { _status: undefined, _error: null }); });

    let batch;
    try {
      await ensureAssets([...new Set(tradeRows.map(r => (r.ticker || '').toUpperCase()).filter(Boolean))]);
      batch = await buildBatch(tradeRows, deposits);
    } catch (err) {
      setError(`Couldn't prepare import: ${err.message || err}`);
      setSubmitting(false);
      return;
    }

    try {
      await importTransactions(batch.items);
      tradeRows.forEach(r => patchRow(r._id, { _status: 'ok', _error: null, _selected: false }));
      setResults({ attempted: true });
    } catch (err) {
      const msg = err.message || String(err);
      const m = msg.match(/row\s+(\d+)\b/);
      if (m) {
        const meta = batch.meta[parseInt(m[1], 10) - 1];
        if (meta?.kind === 'trade') patchRow(meta.rowId, { _status: 'fail', _error: msg });
      }
      setError(`Import rolled back — nothing was saved. ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Kick off an import: skip orphan sells (no shares to back them), then run
  // the atomic batch of remaining trades + their funding deposits. Re-runnable
  // after a rollback — same button handles the first attempt and retries.
  const startImport = async () => {
    const orphanIds = new Set(preflight.orphans.map(o => o.rowId));
    orphanIds.forEach(id => skipRow(id));
    const trades = rows.filter(r =>
      r._selected && r._status !== 'ok' && r._status !== 'skip' && !orphanIds.has(r._id)
    );
    await runImport(trades, preflight.deposits);
  };

  // Per-brokerage "where did I leave off" summary for the first step: the most
  // recent transaction date, when rows were last imported, and how stale that is.
  // executed_at is stored as Bangkok wall-clock, so staleness is measured
  // against the Bangkok "now" (same convention as the rest of the app).
  const lastImported = useMemo(() => {
    const out = {};
    const bkkNowMs = Date.now() + 7 * 3600_000;
    for (const t of transactions || []) {
      if (!t.source || !t.date) continue;
      const o = out[t.source] || (out[t.source] = { lastTx: 0, lastImportAt: 0 });
      const d = new Date(t.date).getTime();
      if (d > o.lastTx) o.lastTx = d;
      const c = t.createdAt ? new Date(t.createdAt).getTime() : 0;
      if (c > o.lastImportAt) o.lastImportAt = c;
    }
    for (const o of Object.values(out)) {
      o.daysSinceTx = Math.floor((bkkNowMs - o.lastTx) / 86_400_000);
    }
    return out;
  }, [transactions]);

  // ---- Step renderers -------------------------------------------------------
  const renderBrokerage = () => (
    <div className="modal-body">
      <p className="picker-prompt">Which portfolio does this import belong to?</p>
      <div className="picker-grid">
        {[
          { id: 'Dime!',   enabled: true,  hint: 'Screenshots' },
          { id: 'Webull',  enabled: true,  hint: 'Monthly statement PDF' },
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
              {b.enabled && (() => {
                const li = lastImported[b.id];
                if (!li || !li.lastTx) return <span className="pc-sub">No transactions yet</span>;
                const stale = li.daysSinceTx > 35;
                return (
                  <>
                    <span className="pc-sub">
                      Latest transaction {fmtDateBkk(li.lastTx)}
                      {li.lastImportAt > 0 && <> · last import {fmtDateBkk(li.lastImportAt + 7 * 3600_000)}</>}
                    </span>
                    {stale && (
                      <span className="pc-sub" style={{ color: 'var(--text-dim)', fontWeight: 600 }}>
                        Nothing new in {li.daysSinceTx} days — check for a newer {b.id === 'Webull' ? 'statement' : 'screenshots'}
                      </span>
                    )}
                  </>
                );
              })()}
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
    const isPdf = source === 'pdf';
    const prompt = isPdf
      ? 'Upload one or more Webull Monthly Account Statement PDFs.'
      : 'Upload one or more screenshots of your transaction list.';
    const chooseLabel = files.length === 0
      ? (isPdf ? 'Click to choose PDF statements' : 'Click to choose images')
      : (isPdf ? '+ Add more PDFs' : '+ Add more images');
    return (
      <div className="modal-body">
        <p className="picker-prompt">{prompt}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept={isPdf ? '.pdf,application/pdf' : 'image/*'}
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
                  <div style={{ width: 60, height: 60, background: 'var(--panel-2)', borderRadius: 4, display: 'grid', placeItems: 'center', color: 'var(--text-faint)', fontSize: 11, fontWeight: 600 }}>PDF</div>
                )}
                <div style={{ fontSize: 12, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file.name}</div>
                <button type="button" onClick={() => removeFile(idx)} aria-label="Remove" style={{ color: 'var(--text-faint)', fontSize: 16 }}>✕</button>
              </div>
            ))}
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 12 }}>
          {isPdf
            ? 'Trades, dividends, withholding tax, credit interest, and THB→USD deposits are extracted from the statement. Overlapping rows across PDFs are deduplicated automatically.'
            : 'Buys, sells, dividends, withholding tax, and TAF/SEC fees are extracted. Cancelled and Expired orders are skipped. Overlapping rows across images are deduplicated automatically.'}
        </p>
      </div>
    );
  };

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => new Date(b.executedAt) - new Date(a.executedAt)),
    [rows]
  );

  const okCount = rows.filter(r => r._status === 'ok').length;
  const failedRows = rows.filter(r => r._status === 'fail');
  const skippedCount = rows.filter(r => r._status === 'skip').length;
  const hasSubmitted = !!results;

  const renderPreview = () => (
    <div className="modal-body">
      {(() => {
        const dupes = rows.filter(r => r._duplicate).length;
        const fresh = rows.length - dupes;
        return (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
            Parsed <strong>{rows.length}</strong> row{rows.length === 1 ? '' : 's'}
            {' '}({fresh} new{dupes > 0 && <>, {dupes} duplicate{dupes === 1 ? '' : 's'}</>})
            {skipped > 0 && <> · Skipped {skipped} other row{skipped === 1 ? '' : 's'}</>}
          </div>
        );
      })()}
      {rows.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
          No transactions found in the image.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflow: 'auto' }}>
          {sortedRows.map(r => {
            const expanded = r._id === expandedRowId;
            const isCash = CASH_ROW.has(r.action) || r.action === 'Deposit';
            const actionColor = (r.action === 'Buy' || r.action === 'Dividend' || r.action === 'Deposit') ? 'var(--green)' : 'var(--red)';
            const priceStr = (Number(r.executedPrice) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
            const valueStr = (Number(r.value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const dg = r._status === 'fail' ? diagnose(r._error) : null;
            const borderColor = r._status === 'fail' ? 'rgba(248,113,113,0.5)'
              : r._status === 'ok' ? 'rgba(74,222,128,0.4)'
              : 'var(--border)';
            const rowOpacity = r._status === 'ok' || r._status === 'skip' ? 0.55 : (r._selected ? 1 : 0.45);
            return (
              <div key={r._id} style={{ border: `1px solid ${borderColor}`, borderRadius: 8, opacity: rowOpacity }}>
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
                    <span>{r.ticker || (r.action === 'Deposit' ? 'USD' : '')}</span>
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    {fmtDateBkk(r.executedAt)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }}>
                    {isCash
                      ? `${(r.action === 'Dividend' || r.action === 'Deposit') ? '+' : '−'}$${valueStr} USD`
                      : `${fmtCurrencySym(r.currency)}${priceStr} ${r.currency}`}
                  </span>
                  <span style={{ minWidth: 80, textAlign: 'right' }}>
                    {r._status === 'ok' && (
                      <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ imported</span>
                    )}
                    {r._status === 'skip' && (
                      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>skipped</span>
                    )}
                    {r._status === 'fail' && (
                      <span style={{ fontSize: 11, color: 'var(--red)' }}>✗ failed</span>
                    )}
                    {!r._status && r._duplicate && (
                      <span style={{ fontSize: 10, color: 'var(--text-faint)', padding: '2px 6px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 4 }}>
                        duplicate ({r._duplicate === 'db' ? 'in DB' : 'in batch'})
                      </span>
                    )}
                  </span>
                </div>

                {/* Failure strip — this row caused the rollback. Fix it (edit or
                    skip), then import again. Nothing was committed. */}
                {r._status === 'fail' && (
                  <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'rgba(248,113,113,0.06)' }}>
                    <div style={{ fontSize: 11.5, color: 'var(--red)', marginBottom: 8 }}>
                      Rolled back the import here — {' '}
                      {dg.kind === 'cash'
                        ? `not enough ${dg.currency} cash to fund this (short ${fmtCurrencySym(dg.currency)}${dg.shortfall.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). Bump the funding deposit below, or skip this row.`
                        : dg.kind === 'shares'
                        ? `no shares to sell (you hold ${Math.max(0, dg.heldQty)} ${dg.ticker}, this sells ${dg.needed}). Skip it or add the missing Buy.`
                        : r._error}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                      <button type="button" className="btn-mini" disabled={submitting} onClick={() => setExpandedRowId(expanded ? null : r._id)}>
                        Edit
                      </button>
                      <button type="button" className="btn-mini btn-mini-ghost" disabled={submitting} onClick={() => skipRow(r._id)}>
                        Skip
                      </button>
                    </div>
                  </div>
                )}

                {/* Expanded edit form — only renders when this row is the active one */}
                {expanded && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '10px 12px 12px', borderTop: '1px solid var(--border)' }}>
                    <input className="field-input" value={r.ticker} onChange={e => patchRow(r._id, { ticker: e.target.value.toUpperCase() })} placeholder="Ticker" style={{ fontSize: 12 }} />
                    {isCash ? (
                      <input className="field-input" value={r.value ?? ''} onChange={e => patchRow(r._id, { value: parseFloat(e.target.value) || 0 })} placeholder="Amount (USD)" inputMode="decimal" style={{ fontSize: 12 }} />
                    ) : (
                      <>
                        <input className="field-input" value={r.qty} onChange={e => patchRow(r._id, { qty: parseFloat(e.target.value) || 0 })} placeholder="Qty" inputMode="decimal" style={{ fontSize: 12 }} />
                        <input className="field-input" value={r.executedPrice} onChange={e => patchRow(r._id, { executedPrice: parseFloat(e.target.value) || 0 })} placeholder="Price" inputMode="decimal" style={{ fontSize: 12 }} />
                        <div className="field-with-suffix" title="Currency of the Executed Price column.">
                          <select className="field-input" value={r.currency} onChange={e => patchRow(r._id, { currency: e.target.value })} style={{ fontSize: 12 }}>
                            <option value="USD">Price in USD</option>
                            <option value="THB">Price in THB</option>
                          </select>
                        </div>
                      </>
                    )}
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
      {!hasSubmitted && (preflight.deposits.length > 0 || preflight.orphans.length > 0) && (
        <div style={{ marginTop: 12, padding: '12px 14px', border: '1px solid var(--border-strong)', borderRadius: 10, background: 'var(--panel)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
            Pre-flight check — fixes needed before this imports cleanly
          </div>

          {preflight.deposits.length > 0 && (
            <div style={{ marginBottom: preflight.orphans.length ? 12 : 0 }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
                {preflight.deposits.length} funding deposit{preflight.deposits.length === 1 ? '' : 's'} — your Buys cost more USD cash than is on record:
              </div>
              {preflight.deposits.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                  <span style={{ color: 'var(--green)' }}>+ Deposit</span>
                  <span style={{ color: 'var(--text-faint)' }}>$</span>
                  <input
                    className="field-input"
                    value={depositEdits[d.id] === undefined ? d.amount : depositEdits[d.id]}
                    onChange={e => setDepositEdits(s => ({ ...s, [d.id]: e.target.value }))}
                    inputMode="decimal"
                    style={{ width: 90, fontSize: 12, padding: '4px 8px' }}
                  />
                  <span style={{ color: 'var(--text-faint)' }}>USD before {fmtDateBkk(d.beforeIso)}</span>
                  <span style={{ color: 'var(--text-faint)', marginLeft: 'auto' }}>to fund {d.forTicker}</span>
                </div>
              ))}
            </div>
          )}

          {preflight.orphans.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
                {preflight.orphans.length} orphan sell{preflight.orphans.length === 1 ? '' : 's'} — selling shares with no prior Buy on record. These are skipped:
              </div>
              {preflight.orphans.map(o => (
                <div key={o.rowId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                  <span style={{ color: 'var(--red)' }}>Sell {o.ticker}</span>
                  <span style={{ color: 'var(--text-faint)' }}>need {o.need}, hold {o.held}</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}>will skip</span>
                </div>
              ))}
              <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 2 }}>
                If a Buy for these is missing, add it (import the earlier screenshot or enter it manually), then re-import.
              </div>
            </div>
          )}
        </div>
      )}
      {hasSubmitted && (
        <div style={{ marginTop: 12, fontSize: 12, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--green)' }}>✓ Imported {okCount} row{okCount === 1 ? '' : 's'} — committed atomically.</span>
          {skippedCount > 0 && <span style={{ color: 'var(--text-faint)' }}>Skipped: {skippedCount}</span>}
        </div>
      )}
    </div>
  );

  const headTitle = step === 'brokerage' ? 'Import — pick portfolio'
                  : step === 'bucket' ? 'Import — pick asset type'
                  : step === 'upload' ? 'Import — upload file'
                  : 'Import — review rows';

  return (
    <div className="modal-backdrop" onClick={analyzing || submitting ? undefined : closeModal}>
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
          <button className="modal-close" onClick={closeModal} aria-label="Close" disabled={analyzing || submitting}>
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
                  const label = source === 'pdf' ? 'PDF' : 'image';
                  return files.length > 1 ? `Analyze ${files.length} ${label}s` : `Analyze ${label}`;
                })()}
              </button>
            )}
            {step === 'preview' && !hasSubmitted && (() => {
              // Importable = selected, not already done, not skipped, not an orphan sell.
              const orphanIds = new Set(preflight.orphans.map(o => o.rowId));
              const importable = rows.filter(r => r._selected && r._status !== 'ok' && r._status !== 'skip' && !orphanIds.has(r._id)).length;
              const hasFixes = preflight.deposits.length > 0 || preflight.orphans.length > 0;
              const retrying = failedRows.length > 0;
              return (
                <button className="btn-primary" disabled={submitting || importable === 0} onClick={startImport}>
                  {submitting ? 'Importing…'
                    : retrying ? `Fix & import again (${importable})`
                    : hasFixes ? `Approve fixes & import ${importable} row${importable === 1 ? '' : 's'}`
                    : `Import ${importable} row${importable === 1 ? '' : 's'}`}
                </button>
              );
            })()}
            {step === 'preview' && hasSubmitted && (
              <button className="btn-primary" disabled={submitting} onClick={() => onDone?.()}>
                Done
              </button>
            )}
            <button className="btn-secondary" onClick={closeModal} disabled={analyzing || submitting}>
              {hasSubmitted ? 'Close' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
