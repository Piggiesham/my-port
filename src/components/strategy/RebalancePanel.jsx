import { useContext } from 'react';
import { CurrencyContext, fmtLive, bucketColorMap } from '../../data.js';

export default function RebalancePanel({ strategy, plan }) {
  const cur = useContext(CurrencyContext);
  const { rows, total, totalDriftPct, unassignedTickers } = strategy;
  const colors = bucketColorMap(plan.buckets);

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
        const color = colors[r.id] || 'var(--text-faint)';
        const actual = Math.min(r.actualPct, 100);
        const target = Math.min(r.target, 100);
        const gapLeft = Math.min(actual, target);
        const gapW = Math.abs(target - actual);
        return (
          <div className="rebal-row" key={r.id}>
            <div className="rebal-label">
              <span className="rebal-name"><span className="bucket-dot" style={{ background: color }} />{r.name}</span>
              <span className="rebal-target">{r.target}% target</span>
            </div>
            <div className="rebal-bar" title={`${r.actualPct.toFixed(1)}% now vs ${r.target}% target`}>
              <div className="rebal-fill" style={{ width: `${actual}%`, background: color }} />
              {!onTarget && <div className={`rebal-gap ${buy ? 'under' : 'over'}`} style={{ left: `${gapLeft}%`, width: `${gapW}%` }} />}
              <div className="rebal-tick" style={{ left: `${target}%` }} />
            </div>
            <div className="rebal-figures">
              <span className="rebal-actual">{r.actualPct.toFixed(1)}%</span>
              <span className={`rebal-trade ${onTarget ? 'flat' : buy ? 'up' : 'down'}`}>
                {onTarget ? 'on target' : `${buy ? '▲ buy' : '▼ sell'} ${fmtLive(Math.abs(r.tradeUSD), cur)}`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
