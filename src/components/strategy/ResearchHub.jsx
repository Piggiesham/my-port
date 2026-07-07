import { useState } from 'react';
import { bucketColorMap, citeLabel } from '../../data.js';

export default function ResearchHub({ plan }) {
  const research = plan.research || [];
  const [openIdx, setOpenIdx] = useState(null);
  const colors = bucketColorMap(plan.buckets);
  const nameOf = (id) => (plan.buckets.find(b => b.id === id)?.name) || id || 'General';
  if (research.length === 0) return null;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Research</div>
          <div className="card-sub">why you hold what you hold · {research.length}</div>
        </div>
      </div>
      {research.map((r, i) => {
        const open = openIdx === i;
        return (
          <div className="rh-item" key={i}>
            <button className="rh-head" onClick={() => setOpenIdx(open ? null : i)}>
              <span className="rh-scope"><span className="bucket-dot" style={{ background: colors[r.scope] || 'var(--text-faint)' }} />{nameOf(r.scope)}</span>
              <svg className={`rh-caret ${open ? 'open' : ''}`} width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {open && (
              <div className="rh-body">
                <div className="rh-summary">{r.summary}</div>
                {r.cite ? <span className="rh-cite" title={r.cite}>{citeLabel(r.cite)}</span> : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
