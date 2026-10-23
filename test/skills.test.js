import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSkillsSummary, getSkill, validateSkillAndTask, buildAssessmentPrompt, validateSkillProfile, loadSkills, skillProfileError, SHARED_ABSTENTION_RULES } from '../lib/skills.js';

test('loads and validates both soldering and bonsai skill profiles', () => {
  const summary = getSkillsSummary();
  assert.equal(summary.length >= 2, true);
  const ids = summary.map((s) => s.id);
  assert.ok(ids.includes('soldering'));
  assert.ok(ids.includes('bonsai'));
});

test('getSkill returns full profile with required fields', () => {
  const s = getSkill('soldering');
  assert.equal(s.id, 'soldering');
  assert.equal(s.name, 'Electronics Soldering');
  assert.ok(s.safety_advisories.length >= 2);
  assert.ok(s.tools.length >= 3);
  assert.ok(s.tasks.length >= 2);
  assert.ok(typeof s.assessment_rules === 'string');

  const b = getSkill('bonsai');
  assert.equal(b.id, 'bonsai');
  assert.equal(b.name, 'Bonsai Cultivation & Wiring');
  assert.ok(b.safety_advisories.length >= 2);
  assert.ok(b.tools.length >= 3);
  assert.ok(b.tasks.length >= 2);
  assert.ok(typeof b.assessment_rules === 'string');
});

test('getSkill returns null for non-existent skill', () => {
  assert.equal(getSkill('glassblowing'), null);
  assert.equal(getSkill(''), null);
  assert.equal(getSkill(null), null);
});

test('validateSkillAndTask rejects invalid skill or task IDs', () => {
  assert.equal(validateSkillAndTask('soldering', 'through_hole_resistor').valid, true);
  assert.equal(validateSkillAndTask('bonsai', 'secondary_branch_wiring').valid, true);
  assert.equal(validateSkillAndTask('soldering', null).valid, true);

  const badSkill = validateSkillAndTask('carpentry', null);
  assert.equal(badSkill.valid, false);
  assert.match(badSkill.error, /Invalid skill_id/);

  const badTask = validateSkillAndTask('soldering', 'prune_branch');
  assert.equal(badTask.valid, false);
  assert.match(badTask.error, /Invalid task_id/);
});

test('buildAssessmentPrompt uses domain-specific rules', () => {
  const s = getSkill('soldering');
  const b = getSkill('bonsai');

  const promptSolder = buildAssessmentPrompt(s, [{ id: 'k1', step: 'heat', summary: 'apply heat', cues: '', warnings: '' }]);
  assert.match(promptSolder, /Electronics Soldering/);
  assert.match(promptSolder, /electrical continuity/);
  assert.doesNotMatch(promptSolder, /cambium/);

  const promptBonsai = buildAssessmentPrompt(b, [{ id: 'k2', step: 'anchor', summary: 'two turns', cues: '', warnings: '' }]);
  assert.match(promptBonsai, /Bonsai Cultivation & Wiring/);
  assert.match(promptBonsai, /foliage occludes/);
  assert.match(promptBonsai, /sap flow/);
  assert.doesNotMatch(promptBonsai, /electrical continuity/);
  assert.doesNotMatch(promptBonsai, /joint is too small/);
});

test('validateSkillProfile validates manifest structure strictly', () => {
  assert.equal(validateSkillProfile(null), false);
  assert.equal(validateSkillProfile({}), false);
  assert.equal(validateSkillProfile({ id: 'x', name: 'X', category: 'C', description: 'D', safety_advisories: [], tools: [], tasks: [], assessment_rules: 'R' }), false);
  assert.equal(validateSkillProfile({ id: 'x', name: 'X', category: 'C', description: 'D', safety_advisories: ['warn'], tools: [], tasks: [], assessment_rules: 'R' }), true);
});

const base = () => ({
  id: 'x', name: 'X', category: 'C', description: 'D', safety_advisories: ['warn'], assessment_rules: 'R',
  tools: [{ id: 't1', name: 'Tool', purpose: 'Use' }],
  tasks: [{ id: 'k1', title: 'Task', summary: 'S', default_procedure: '1. Do.', visual_cues: 'V' }]
});

test('shipped profiles pass the stricter manifest validation', () => {
  for (const f of ['soldering', 'bonsai']) {
    assert.equal(validateSkillProfile(JSON.parse(fs.readFileSync(new URL(`../skills/${f}.json`, import.meta.url), 'utf8'))), true, f);
  }
  assert.equal(validateSkillProfile(base()), true);
});

test('validateSkillProfile rejects invalid tool entries', () => {
  const bad = [
    { name: 'No id', purpose: 'p' }, { id: '', name: 'Empty id', purpose: 'p' }, { id: '   ', name: 'Blank id', purpose: 'p' },
    { id: 7, name: 'Numeric id', purpose: 'p' }, { id: 't2', purpose: 'p' }, { id: 't2', name: '', purpose: 'p' },
    { id: 't2', name: 'No purpose' }, { id: 't2', name: 'Bad purpose', purpose: 3 }, null, 'iron', ['t2']
  ];
  for (const t of bad) { const p = base(); p.tools.push(t); assert.equal(validateSkillProfile(p), false, JSON.stringify(t)); }
  const dup = base(); dup.tools.push({ id: 't1', name: 'Same id', purpose: 'p' }); assert.equal(validateSkillProfile(dup), false);
  const notArray = base(); notArray.tools = { t1: {} }; assert.equal(validateSkillProfile(notArray), false);
});

test('validateSkillProfile rejects invalid task entries', () => {
  const ok = { summary: 'S', default_procedure: 'P', visual_cues: 'V' };
  const bad = [
    { ...ok, title: 'No id' }, { ...ok, id: '', title: 'Empty id' }, { ...ok, id: ' ', title: 'Blank id' }, { ...ok, id: 'k2' },
    { ...ok, id: 'k2', title: '  ' }, { ...ok, id: 'k2', title: 'T', default_procedure: undefined }, { ...ok, id: 'k2', title: 'T', default_procedure: 5 },
    { ...ok, id: 'k2', title: 'T', summary: null }, { ...ok, id: 'k2', title: 'T', visual_cues: [] }, null, 'k2'
  ];
  for (const t of bad) { const p = base(); p.tasks.push(t); assert.equal(validateSkillProfile(p), false, JSON.stringify(t)); }
  const dup = base(); dup.tasks.push({ ...ok, id: 'k1', title: 'Same id' }); assert.equal(validateSkillProfile(dup), false);
  // empty-but-present optional text is allowed
  const empty = base(); empty.tasks.push({ id: 'k2', title: 'T', summary: '', default_procedure: '', visual_cues: '' }); assert.equal(validateSkillProfile(empty), true);
});

test('loadSkills skips invalid manifests but keeps valid ones', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mz-skills-'));
  try {
    fs.writeFileSync(path.join(d, 'good.json'), JSON.stringify(base()));
    const badTool = base(); badTool.id = 'badtool'; badTool.tools[0].id = ''; fs.writeFileSync(path.join(d, 'badtool.json'), JSON.stringify(badTool));
    const badTask = base(); badTask.id = 'badtask'; delete badTask.tasks[0].title; fs.writeFileSync(path.join(d, 'badtask.json'), JSON.stringify(badTask));
    fs.writeFileSync(path.join(d, 'broken.json'), '{ not json');
    const m = loadSkills(d);
    assert.deepEqual([...m.keys()], ['x']);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('validateSkillAndTask returns the resolved task template', () => {
  const v = validateSkillAndTask('bonsai', 'structural_pruning');
  assert.equal(v.task.title, 'Structural Branch Pruning');
  assert.match(v.task.default_procedure, /branch collar/);
  assert.equal(validateSkillAndTask('soldering', null).task, null);
});

test('buildAssessmentPrompt never substitutes another skill when the profile is missing', () => {
  assert.throws(() => buildAssessmentPrompt(null, []), /unavailable/);
  assert.throws(() => buildAssessmentPrompt(undefined, []), /unavailable/);
});

test('every assessment prompt carries the shared abstention safeguards', () => {
  for (const id of ['soldering', 'bonsai']) {
    const p = buildAssessmentPrompt(getSkill(id), [{ id: 'k1', step: 's', summary: 'x', cues: '', warnings: '' }]);
    assert.ok(p.includes(SHARED_ABSTENTION_RULES), id);
    for (const w of ['blurry', 'too dark', 'occluded', 'too far away', 'insufficient for a reliable conclusion', 'Never infer properties that cannot be established from the visible image']) assert.ok(p.includes(w), `${id}: ${w}`);
    // grounding and output contract are unchanged
    assert.match(p, /using ONLY these approved expert records/);
    assert.match(p, /matching record id/);
    assert.match(p, /on_track\|possible_issue\|cannot_assess\|safety_stop/);
  }
  // the shared rules do not depend on the profile's own rules
  const bare = buildAssessmentPrompt({ name: 'Pottery', assessment_rules: 'Only judge visible wall thickness at the rim.' }, []);
  assert.ok(bare.includes(SHARED_ABSTENTION_RULES)); assert.match(bare, /visible wall thickness/);
});

test('domain-specific rules stay distinct and bonsai rules use observable criteria only', () => {
  const sol = buildAssessmentPrompt(getSkill('soldering'), []), bon = buildAssessmentPrompt(getSkill('bonsai'), []);
  assert.ok(sol.includes(getSkill('soldering').assessment_rules)); assert.ok(!sol.includes(getSkill('bonsai').assessment_rules));
  assert.ok(bon.includes(getSkill('bonsai').assessment_rules)); assert.ok(!bon.includes(getSkill('soldering').assessment_rules));
  const rules = getSkill('bonsai').assessment_rules;
  assert.doesNotMatch(rules, /holds the branch firmly/);
  for (const w of ['spacing', 'crossed wires', 'foliage trapped']) assert.ok(rules.includes(w), w);
});

test('assessment_rules must be a non-empty string', () => {
  for (const v of ['', '   ', undefined, null, 5]) {
    const p = base(); p.assessment_rules = v; assert.equal(validateSkillProfile(p), false, JSON.stringify(v));
  }
  const p = base(); p.assessment_rules = ''; assert.match(skillProfileError(p), /assessment_rules/);
});

test('profile, tool and task ids must match ^[a-z0-9_-]{1,64}$', () => {
  for (const id of ['', 'Soldering', 'wood work', '../x', 'a/b', 'x'.repeat(65), 7]) {
    const p = base(); p.id = id; assert.equal(validateSkillProfile(p), false, `profile ${id}`);
    const t = base(); t.tools[0].id = id; assert.equal(validateSkillProfile(t), false, `tool ${id}`);
    const k = base(); k.tasks[0].id = id; assert.equal(validateSkillProfile(k), false, `task ${id}`);
  }
  const ok = base(); ok.id = 'wood_work-2'; ok.tools[0].id = 'x'.repeat(64); assert.equal(validateSkillProfile(ok), true);
});

test('safety_advisories entries must be non-empty strings', () => {
  for (const v of [[''], ['  '], ['ok', ''], [3], ['ok', null], 'Hot iron']) {
    const p = base(); p.safety_advisories = v; assert.equal(validateSkillProfile(p), false, JSON.stringify(v));
  }
});

test('loadSkills logs skipped manifests and loads neither copy of a duplicated id', (t) => {
  const err = t.mock.method(console, 'error', () => {});
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mz-skills-'));
  try {
    const a = base(); a.id = 'dup'; a.name = 'First';
    const b = base(); b.id = 'dup'; b.name = 'Second';
    const bad = base(); bad.id = 'bad'; bad.assessment_rules = '';
    fs.writeFileSync(path.join(d, 'a.json'), JSON.stringify(a));
    fs.writeFileSync(path.join(d, 'b.json'), JSON.stringify(b));
    fs.writeFileSync(path.join(d, 'bad.json'), JSON.stringify(bad));
    fs.writeFileSync(path.join(d, 'ok.json'), JSON.stringify(base()));
    const m = loadSkills(d);
    assert.deepEqual([...m.keys()], ['x']);
    const logged = err.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
    assert.match(logged, /Skipping skill "dup": defined in more than one file \(a\.json, b\.json\)/);
    assert.match(logged, /Skipping bad\.json: assessment_rules must be a non-empty string/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('default skills directory resolves when the install path contains spaces', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mz space dir '));
  try {
    fs.mkdirSync(path.join(d, 'lib')); fs.mkdirSync(path.join(d, 'skills'));
    fs.copyFileSync(new URL('../lib/skills.js', import.meta.url), path.join(d, 'lib', 'skills.js'));
    for (const f of ['soldering.json', 'bonsai.json']) fs.copyFileSync(new URL(`../skills/${f}`, import.meta.url), path.join(d, 'skills', f));
    const mod = await import(new URL('file://' + path.join(d, 'lib', 'skills.js').split(path.sep).map(encodeURIComponent).join('/')).href);
    assert.deepEqual(mod.getSkillsSummary().map((x) => x.id).sort(), ['bonsai', 'soldering']);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
