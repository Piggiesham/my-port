import { useContext } from 'react';
import { CurrencyContext, fmtLive } from '../../data.js';

export default function RebalancePanel({ strategy, plan }) {
  const cur = useContext(CurrencyContext);
  const { rows, total, totalDriftPct, unassignedTickers } = strategy;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Rebalance</div>
          <div className="card-sub">drift {totalDriftPct.toFixed(1)}% · last set {plan.meta?.updated || '—'}</div>
        </div>
        <div className="num" style={{ fontWeight: 600 }}>{fmtLive(total, cur)}</div>
      </div>

      {unassignedTickers.length > 0 && (
        <div className="strategy-unassigned">
          {unassignedTickers.length} holding{unassignedTickers.length > 1 ? 's' : ''} unassigned — {unassignedTickers.join(', ')}
        </div>
      )}

      {rows.map(r => {
        const buy = r.tradeUSD >= 0;
        const onTarget = Math.abs(r.tradeUSD) < 0.5;
        return (
          <div className="rebal-row" key={r.id}>
            <div className="rebal-label">
              <span className="rebal-name">{r.name}</span>
              <span className="rebal-target">{r.target}% target</span>
            </div>
            <div className="rebal-bar">
              <div className="rebal-bar-target" style={{ width: `${Math.min(r.target, 100)}%` }} />
              <div className="rebal-bar-actual" style={{ width: `${Math.min(r.actualPct, 100)}%` }} />
            </div>
            <div className="rebal-figures">
              <span className="rebal-actual">{r.actualPct.toFixed(1)}%</span>
              <span className={`rebal-trade ${buy ? 'up' : 'down'}`}>
                {onTarget ? 'on target' : `${buy ? '▲ buy' : '▼ sell'} ${fmtLive(Math.abs(r.tradeUSD), cur)}`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
