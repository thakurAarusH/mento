export const STATUSES = ['on_track', 'possible_issue', 'cannot_assess', 'safety_stop'];
export const mmss = (t) => { t = Math.max(0, Math.floor(+t || 0)); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };

/** Validate a model's assessment. Throws on malformed output. Enforces: corrective feedback needs an approved record. */
export function parseAssessment(raw, validIds = []) {
  let o = raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Model returned no JSON object');
    try { o = JSON.parse(m[0]); } catch { throw new Error('Model returned invalid JSON'); }
  }
  if (!o || typeof o !== 'object') throw new Error('Assessment is not an object');
  if (!STATUSES.includes(o.status)) throw new Error('Invalid status');
  const conf = ['low', 'medium', 'high'].includes(o.confidence) ? o.confidence : 'low';
  const ids = Array.isArray(o.knowledge_ids) ? o.knowledge_ids.map(String).filter((x) => validIds.includes(x)) : [];
  const r = {
    status: o.status, stage: String(o.stage || '').slice(0, 200), evidence: String(o.evidence || '').slice(0, 600),
    confidence: conf, knowledge_ids: ids, feedback: String(o.feedback || '').slice(0, 600), needs_help: o.needs_help === true,
  };
  if (r.status === 'possible_issue' && !ids.length) {
    r.status = 'cannot_assess'; r.needs_help = true; r.feedback = 'A possible issue was noticed, but no approved master instruction covers it. Asking the master.';
  }
  if (r.status === 'safety_stop') { r.needs_help = true; r.feedback = (r.feedback ? r.feedback + ' ' : '') + 'Please pause and ask a qualified person to check before continuing.'; }
  if (r.status === 'cannot_assess') r.feedback = r.feedback || 'The view is not clear enough to assess.';
  return r;
}
