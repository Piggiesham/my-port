import { useState, useMemo, useRef, useEffect } from 'react';
import { SOURCES, PORTFOLIO_TYPES, FX_RATE, fmtCurrencySym, fmt2, bkkNowParts, bkkPartsToUtcIso } from '../data.js';
import { addTransaction, fetchAssetCatalog, fetchHistoricalPrice, computeCashBalance, computeSharesHeld } from '../lib/api.js';
import { supabaseEnabled } from '../lib/supabase.js';
import { useClickOutside } from '../lib/useClickOutside.js';
import { CurrencySuffix } from './CurrencySuffix.jsx';
import { EditDateField } from './DateField.jsx';
import { AssetSearchInput } from './AssetSearchInput.jsx';

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

  useClickOutside(txTypeRef, () => setTxTypeOpen(false));

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

  // Cash lives in USD only (ADR 0005); a baht flow is converted at entry.
  const settlementCurrency = isCashFlow
    ? 'USD'
    : (catalog.find(a => a.ticker === (ticker || '').toUpperCase().trim())?.settlement_currency || 'USD');
  const availableCash = useMemo(
    () => portfolio ? computeCashBalance(transactions, portfolio, settlementCurrency, catalog) : 0,
    [transactions, portfolio, settlementCurrency, catalog]
  );
  const cashDebit = useMemo(() => {
    const amt = parseFloat(qty) || 0;
    if (isCashFlow) {
      if (txType !== 'Withdraw') return 0;
      return depositCcy === 'THB' ? amt / fxNum : amt;
    }
    if (txType !== 'Buy') return 0;
    const prUsd = toUsd(parseFloat(price) || 0, priceCcy);
    const fUsd  = toUsd(parseFloat(fees)  || 0, feesCcy);
    const tUsd  = toUsd(parseFloat(taxes) || 0, taxesCcy);
    return amt * prUsd + fUsd + tUsd;
  }, [isCashFlow, txType, qty, price, fees, taxes, priceCcy, feesCcy, taxesCcy, depositCcy, fxNum]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // THB is the active entry currency for cash flows or any other asset type.
  const isThbEntry = isCashFlow ? depositCcy === 'THB' : entryCcy === 'THB';
  // A Deposit always carries a THB-per-USD rate (editable) so the baht actually
  // paid is recorded, whichever currency the amount is typed in. Withdrawals
  // only expose it for a THB amount.
  const showDepositFx = isCashFlow && (depositCcy === 'THB' || txType === 'Deposit');
  const [dyy, dmm, ddd] = dateIso.split('-');
  const dateDisplay = (dyy && dmm && ddd) ? `${ddd}/${dmm}/${dyy}` : dateIso;
  const fxDisplay = (() => {
    const n = parseFloat(fxRate);
    return isFinite(n) && n > 0 ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—';
  })();

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
                Available: {fmtCurrencySym(settlementCurrency)}{fmt2(availableCash)} {settlementCurrency}
                {cashDebit > 0 && (
                  <span style={{ marginLeft: 8, color: 'var(--text-faint)', fontWeight: 400 }}>
                    · this tx needs {fmtCurrencySym(settlementCurrency)}{fmt2(cashDebit)}
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <div style={{ display: 'flex', gap: 8, flex: showDepositFx ? '0 0 auto' : 1 }}>
                  {['USD', 'THB'].map(c => (
                    <button key={c} type="button"
                      onClick={() => { setDepositCcy(c); if (c === 'THB' && !fxRate) setFxRate(String(FX_RATE)); }}
                      className="field-input"
                      style={{ flex: showDepositFx ? '0 0 auto' : 1, padding: '0 18px', cursor: 'pointer', fontWeight: 600, borderColor: depositCcy === c ? 'var(--accent)' : undefined, color: depositCcy === c ? 'var(--accent)' : 'var(--text)' }}>
                      {c}
                    </button>
                  ))}
                </div>
                {showDepositFx && (
                  <div className="field-with-suffix" style={{ flex: 1 }}>
                    <input className="field-input" inputMode="decimal" placeholder="THB per USD" value={fxRate} onChange={e => setFxRate(e.target.value)} />
                    <span className="field-suffix">THB / USD</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="field">
            <label>{isCashFlow ? `Amount (${depositCcy})` : 'Quantity'}</label>
            <input className="field-input" placeholder={isCashFlow ? `e.g. ${fmtCurrencySym(depositCcy)}1,000.00` : 'e.g. 10'} value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal" />
          </div>

          <div className="field">
            <label>Transaction Date</label>
            <EditDateField value={dateIso} onChange={setDateIso} />
            {(isThbEntry || showDepositFx) && (
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>
                FX on {dateDisplay} · {fxDisplay} THB/USD
                {isCashFlow && totalAmount > 0 && depositCcy === 'THB' && (
                  <> · recorded as ${fmt2(totalAmount / fxNum)} USD</>
                )}
                {isCashFlow && totalAmount > 0 && depositCcy === 'USD' && showDepositFx && (
                  <> · ≈ ฿{fmt2(totalAmount * fxNum)} THB</>
                )}
              </div>
            )}
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
            <span className="total-val">{displaySymbol}{fmt2(displayTotal)}</span>
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
                  // The ledger is USD-only (ADR 0005): a baht cash flow is converted
                  // here at the (editable) THB-per-USD rate and stored as a USD
                  // row; the rate is kept in fx_rate_at_tx so the baht actually
                  // exchanged stays recoverable for the THB views.
                  const submitTicker = isCashFlow ? 'USD' : ticker.toUpperCase().trim();
                  const fx = parseFloat(fxRate) || FX_RATE;
                  const cashUsd = depositCcy === 'THB' ? amount / fx : amount;
                  const priceUsd = isCashFlow
                    ? 1
                    : (price === '' ? null : toUsd(parseFloat(price) || 0, priceCcy));
                  const feesUsd  = isCashFlow ? (parseFloat(fees) || 0) : toUsd(parseFloat(fees) || 0, feesCcy);
                  const taxesUsd = isCashFlow ? (parseFloat(taxes) || 0) : toUsd(parseFloat(taxes) || 0, taxesCcy);
                  const submitValueUsd = isCashFlow
                    ? cashUsd
                    : (totalAmount || (amount * (priceUsd || 0)) || 0);
                  await addTransaction({
                    portfolio, ticker: submitTicker, action: txType,
                    shares: isCashFlow ? (cashUsd || null) : (amount || null), price: priceUsd, valueUsd: submitValueUsd,
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
