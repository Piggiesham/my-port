import { useMemo } from 'react';
import plan from '../data/plan.json';
import { computeStrategy } from '../lib/strategy.js';
import RebalancePanel from './strategy/RebalancePanel.jsx';
import AllocationWorkbench from './strategy/AllocationWorkbench.jsx';
import SuggestionsPanel from './strategy/SuggestionsPanel.jsx';

export default function StrategyPage({ assets = [] }) {
  const strategy = useMemo(() => computeStrategy(assets, plan), [assets]);
  return (
    <div className="strategy-page">
      <AllocationWorkbench plan={plan} />
      <RebalancePanel strategy={strategy} plan={plan} />
      <SuggestionsPanel plan={plan} />
    </div>
  );
}
