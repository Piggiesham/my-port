import { bucketColorMap, citeLabel } from '../../data.js';

export default function SuggestionsPanel({ plan }) {
  const suggestions = plan.suggestions || [];
  const colors = bucketColorMap(plan.buckets);
  const nameOf = (id) => (plan.buckets.find(b => b.id === id)?.name) || id || 'General';
  if (suggestions.length === 0) return null;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Suggestions</div>
          <div className="card-sub">grounded in your research · {suggestions.length}</div>
        </div>
      </div>
      {suggestions.map((s, i) => (
        <div className="sugg-row" key={i}>
          <span className="sugg-bucket"><span className="bucket-dot" style={{ background: colors[s.bucket] || 'var(--text-faint)' }} />{nameOf(s.bucket)}</span>
          <div className="sugg-body">
            <div className="sugg-action">{s.action}</div>
            {s.why && <div className="sugg-why">{s.why}</div>}
          </div>
          {s.cite ? <span className="sugg-cite" title={s.cite}>{citeLabel(s.cite)}</span> : null}
        </div>
      ))}
    </div>
  );
}
