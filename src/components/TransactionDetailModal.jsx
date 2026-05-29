import { useState, useMemo, useContext, useEffect, useRef } from 'react';
import { CurrencyContext, SOURCES, FX_RATE, fmtCurrencySym, fmtCurrencyCode, fmtDateTimeBkk, utcIsoToBkkParts, bkkPartsToUtcIso } from '../data.js';
import { deleteTransaction, updateTransaction, fetchHistoricalPrice } from '../lib/api.js';
import { CurrencySuffix, EditDateField } from './AddTransactionModal.jsx';

// ============================================================================
// TransactionDetailModal — read-only view with Edit & Delete actions.
// ============================================================================
export default function TransactionDetailModal({ tx, assetMap, onClose, onChanged }) {
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
    return <EditTransactionForm tx={tx} onCancel={() => setMode('view')} onSaved={onChanged} />;
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

          {(() => {
            const liveFx = cur.fxRate || FX_RATE;
            const fx = tx.fx_rate_at_tx ?? liveFx;
            const aux = (usdAmt, dec = 2) => cur.currency === 'USD' ? (
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                ≈ ฿{(usdAmt * fx).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })} THB
              </span>
            ) : null;
            const thbMul = cur.currency === 'THB' ? fx : 1;
            const mainPrice = tx.price != null ? `${symbol}${(tx.price * thbMul).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${code}` : '—';
            const mainValue = `${symbol}${(tx.valueUSD * thbMul).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`;
            const mainFees  = tx.fees  ? `${symbol}${(tx.fees * thbMul).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}` : '—';
            const mainTaxes = tx.taxes ? `${symbol}${(tx.taxes * thbMul).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}` : '—';
            return (
              <>
                <DetailRow label="Shares"   value={tx.shares != null ? tx.shares.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '—'} />
                <DetailRow label="Price/sh" value={<><span>{mainPrice}</span>{tx.price != null && aux(tx.price, 6)}</>} />
                <DetailRow label="Value"    value={<><span>{mainValue}</span>{aux(tx.valueUSD)}</>} />
                <DetailRow label="Fees"     value={<><span>{mainFees}</span>{tx.fees ? aux(tx.fees) : null}</>} />
                <DetailRow label="Taxes"    value={<><span>{mainTaxes}</span>{tx.taxes ? aux(tx.taxes) : null}</>} />
                {cur.currency === 'USD' && (
                  <DetailRow label="FX at tx" value={`${fx.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} THB / USD`} />
                )}
              </>
            );
          })()}
          <DetailRow label="Executed" value={fmtDateTimeBkk(tx.date)} />
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
                <button className="btn-secondary" onClick={() => setMode('view')} disabled={busy}>Cancel</button>
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
// EditTransactionForm — edit an existing transaction in place.
// Portfolio is locked — changing brokerage on an existing tx complicates
// holdings reconciliation.
// ============================================================================
function EditTransactionForm({ tx, onCancel, onSaved }) {
  const [action, setAction] = useState(tx.action);
  const [actionOpen, setActionOpen] = useState(false);
  const [shares, setShares] = useState(tx.shares != null ? String(tx.shares) : '');
  const [price, setPrice] = useState(tx.price != null ? String(tx.price) : '');
  const [fees, setFees] = useState(tx.fees ? String(tx.fees) : '');
  const [taxes, setTaxes] = useState(tx.taxes ? String(tx.taxes) : '');
  const [description, setDescription] = useState(tx.description || '');
  const [entryCcy, setEntryCcy] = useState('USD');
  const [fxRate, setFxRate] = useState(String(tx.fx_rate_at_tx ?? FX_RATE));
  const [priceCcy, setPriceCcy] = useState('USD');
  const [feesCcy, setFeesCcy] = useState('USD');
  const [taxesCcy, setTaxesCcy] = useState('USD');
  const initialBkk = utcIsoToBkkParts(tx.date);
  const [date, setDate] = useState(initialBkk.date);
  const [time, setTime] = useState(initialBkk.time);
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

  const fxNum = parseFloat(fxRate) || FX_RATE;
  const toUsd = (v, ccy) => (ccy === 'THB' ? v / fxNum : v);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchHistoricalPrice('THB', date).then(p => {
        if (cancelled || p == null || p <= 0) return;
        setFxRate(String(Number((1 / p).toFixed(4))));
      }).catch(() => {});
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [date]);

  const convertValue = (raw, fromCcy, toCcy) => {
    if (raw === '' || fromCcy === toCcy) return raw;
    const num = parseFloat(raw);
    if (!isFinite(num)) return raw;
    const usd = fromCcy === 'THB' ? num / fxNum : num;
    const out = toCcy === 'THB' ? usd * fxNum : usd;
    return String(Number(out.toFixed(6)));
  };

  const totalAmount = useMemo(() => {
    const q = parseFloat(shares) || 0;
    const pr = toUsd(parseFloat(price) || 0, priceCcy);
    const f = toUsd(parseFloat(fees) || 0, feesCcy);
    const t = toUsd(parseFloat(taxes) || 0, taxesCcy);
    const base = q * pr;
    if (action === 'Sell') return base - f - t;
    return base + f + t;
  }, [shares, price, fees, taxes, action, priceCcy, feesCcy, taxesCcy, fxNum]); // eslint-disable-line react-hooks/exhaustive-deps

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
            <label>Entry Currency</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
                {['USD', 'THB'].map(c => (
                  <button key={c} type="button"
                    onClick={() => {
                      setEntryCcy(c);
                      setPrice(convertValue(price, priceCcy, c));
                      setFees(convertValue(fees, feesCcy, c));
                      setTaxes(convertValue(taxes, taxesCcy, c));
                      setPriceCcy(c); setFeesCcy(c); setTaxesCcy(c);
                    }}
                    className="field-input"
                    style={{ cursor: 'pointer', fontWeight: 600, padding: '0 18px', borderColor: entryCcy === c ? 'var(--accent)' : undefined, color: entryCcy === c ? 'var(--accent)' : 'var(--text)' }}
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
            <label>{action === 'Sell' ? 'Sale' : 'Purchase'} Price / sh</label>
            <div className="field-with-suffix">
              <input className="field-input" placeholder={`e.g. ${fmtCurrencySym(priceCcy)}150.00`} value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" />
              <CurrencySuffix value={priceCcy} onChange={c => { setPrice(convertValue(price, priceCcy, c)); setPriceCcy(c); }} />
            </div>
          </div>

          <div className="field">
            <label>Fees</label>
            <div className="field-with-suffix">
              <input className="field-input" value={fees} onChange={e => setFees(e.target.value)} inputMode="decimal" />
              <CurrencySuffix value={feesCcy} onChange={c => { setFees(convertValue(fees, feesCcy, c)); setFeesCcy(c); }} />
            </div>
          </div>

          <div className="field">
            <label>Taxes</label>
            <div className="field-with-suffix">
              <input className="field-input" value={taxes} onChange={e => setTaxes(e.target.value)} inputMode="decimal" />
              <CurrencySuffix value={taxesCcy} onChange={c => { setTaxes(convertValue(taxes, taxesCcy, c)); setTaxesCcy(c); }} />
            </div>
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
            <button className="btn-primary" disabled={busy} style={{ opacity: busy ? 0.5 : 1 }}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const executedAt = bkkPartsToUtcIso(date, time);
                  const fx = parseFloat(fxRate) || FX_RATE;
                  const priceUsd = price === '' ? null : toUsd(parseFloat(price) || 0, priceCcy);
                  const feesUsd  = toUsd(parseFloat(fees) || 0, feesCcy);
                  const taxesUsd = toUsd(parseFloat(taxes) || 0, taxesCcy);
                  await updateTransaction(tx.id, {
                    portfolio: tx.source, ticker: tx.ticker, action,
                    shares: parseFloat(shares) || null, price: priceUsd,
                    valueUsd: totalAmount || 0, fees: feesUsd, taxes: taxesUsd,
                    description, executedAt, fxRateAtTx: fx,
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
