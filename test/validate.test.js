import test from 'node:test'; import assert from 'node:assert/strict';
import { parseAssessment, mmss } from '../lib/validate.js';
test('mmss', () => assert.equal(mmss(75), '01:15'));
test('valid on_track keeps only known approved ids', () => {
  const r = parseAssessment('x {"status":"on_track","knowledge_ids":["a","zzz"],"confidence":"high","feedback":"ok"} y', ['a']);
  assert.deepEqual(r.knowledge_ids, ['a']); assert.equal(r.status, 'on_track');
});
test('possible_issue without approved record is downgraded and escalated', () => {
  const r = parseAssessment({ status: 'possible_issue', knowledge_ids: ['fake'], feedback: 'bad joint' }, ['a']);
  assert.equal(r.status, 'cannot_assess'); assert.equal(r.needs_help, true);
});
test('safety_stop forces help and cautious wording', () => {
  const r = parseAssessment({ status: 'safety_stop' }, []); assert.equal(r.needs_help, true); assert.match(r.feedback, /qualified person/);
});
test('rejects malformed output', () => {
  assert.throws(() => parseAssessment('no json', [])); assert.throws(() => parseAssessment('{"status":"great"}', []));
  assert.throws(() => parseAssessment('{bad json}', []));
});
