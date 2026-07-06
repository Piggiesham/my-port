import { useMemo } from 'react';
import plan from '../data/plan.json';
import { computeStrategy } from '../lib/strategy.js';
import RebalancePanel from './strategy/RebalancePanel.jsx';

export default function StrategyPage({ assets = [] }) {
  const strategy = useMemo(() => computeStrategy(assets, plan), [assets]);
  return (
    <div className="strategy-page">
      <RebalancePanel strategy={strategy} plan={plan} />
    </div>
  );
}
