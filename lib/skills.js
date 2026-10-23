import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS_DIR = fileURLToPath(new URL('../skills', import.meta.url));
export const ID_RE = /^[a-z0-9_-]{1,64}$/;

// Applied to every skill, independently of its own assessment_rules.
export const SHARED_ABSTENTION_RULES = 'Image-quality safeguards (apply to every craft): return cannot_assess if the image is blurry, out of focus, too dark, overexposed, occluded, cropped, taken from too far away, or otherwise insufficient for a reliable conclusion. Judge only what is directly visible in this single still image. Never infer properties that cannot be established from the visible image, such as temperature, strength, firmness, tension, electrical or internal condition, hidden defects, or what happened before or after the photo. When in doubt, choose cannot_assess rather than guessing.';

const nonEmpty = (v) => typeof v === 'string' && !!v.trim();

// Every entry needs a well-formed, unique id so sessions can reference it stably.
function entryError(list, kind, required, optional) {
  if (!Array.isArray(list)) return `${kind} must be an array`;
  const ids = new Set();
  for (const [i, e] of list.entries()) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return `${kind}[${i}] must be an object`;
    if (typeof e.id !== 'string' || !ID_RE.test(e.id)) return `${kind}[${i}].id must match ${ID_RE}`;
    for (const f of required) if (!nonEmpty(e[f])) return `${kind}[${i}].${f} must be a non-empty string`;
    for (const f of optional) if (typeof e[f] !== 'string') return `${kind}[${i}].${f} must be a string`;
    if (ids.has(e.id)) return `duplicate ${kind} id "${e.id}"`;
    ids.add(e.id);
  }
  return null;
}

/** Returns the first problem with a manifest, or null if it is valid. */
export function skillProfileError(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'profile must be an object';
  if (typeof p.id !== 'string' || !ID_RE.test(p.id)) return `id must match ${ID_RE}`;
  if (!nonEmpty(p.name)) return 'name must be a non-empty string';
  if (typeof p.category !== 'string') return 'category must be a string';
  if (typeof p.description !== 'string') return 'description must be a string';
  if (!Array.isArray(p.safety_advisories) || !p.safety_advisories.length) return 'safety_advisories must be a non-empty array';
  if (!p.safety_advisories.every(nonEmpty)) return 'safety_advisories entries must be non-empty strings';
  const e = entryError(p.tools, 'tools', ['name'], ['purpose']) || entryError(p.tasks, 'tasks', ['title'], ['summary', 'default_procedure', 'visual_cues']);
  if (e) return e;
  if (!nonEmpty(p.assessment_rules)) return 'assessment_rules must be a non-empty string';
  return null;
}

export const validateSkillProfile = (p) => !skillProfileError(p);

let skillsCache = null;

export function loadSkills(skillsDir = SKILLS_DIR) {
  const byId = new Map();
  if (fs.existsSync(skillsDir)) {
    for (const file of fs.readdirSync(skillsDir).sort()) {
      if (!file.endsWith('.json')) continue;
      let profile;
      try {
        profile = JSON.parse(fs.readFileSync(path.join(skillsDir, file), 'utf8'));
      } catch (e) {
        console.error(`[skills] Skipping ${file}: failed to parse:`, e.message);
        continue;
      }
      const err = skillProfileError(profile);
      if (err) { console.error(`[skills] Skipping ${file}: ${err}`); continue; }
      if (!byId.has(profile.id)) byId.set(profile.id, []);
      byId.get(profile.id).push({ file, profile });
    }
  }
  // A duplicated id is ambiguous: load none of the copies rather than pick one.
  const map = new Map();
  for (const [id, found] of byId) {
    if (found.length > 1) console.error(`[skills] Skipping skill "${id}": defined in more than one file (${found.map((f) => f.file).join(', ')})`);
    else map.set(id, found[0].profile);
  }
  return map;
}

function getCache() {
  if (!skillsCache) skillsCache = loadSkills();
  return skillsCache;
}

export function reloadSkills(skillsDir = SKILLS_DIR) {
  skillsCache = loadSkills(skillsDir);
  return skillsCache;
}

export function getSkillsSummary() {
  return Array.from(getCache().values()).map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    description: s.description,
    taskCount: (s.tasks || []).length,
    toolCount: (s.tools || []).length
  }));
}

export function getSkill(id) {
  if (!id || typeof id !== 'string') return null;
  return getCache().get(id) || null;
}

export function validateSkillAndTask(skillId, taskId) {
  const skill = getSkill(skillId);
  if (!skill) {
    const available = Array.from(getCache().keys()).join(', ');
    return { valid: false, error: `Invalid skill_id "${skillId}". Available skills: ${available}` };
  }
  if (taskId) {
    const task = (skill.tasks || []).find((t) => t.id === taskId);
    if (!task) {
      const availableTasks = (skill.tasks || []).map((t) => t.id).join(', ') || 'none';
      return { valid: false, error: `Invalid task_id "${taskId}" for skill "${skillId}". Available tasks: ${availableTasks}` };
    }
    return { valid: true, skill, task };
  }
  return { valid: true, skill, task: null };
}

// Callers must pass a loaded profile: never substitute another skill's rules.
export function buildAssessmentPrompt(s, records = []) {
  if (!s) throw new Error('Skill profile unavailable.');
  const list = records.map((k) => ({
    id: k.id,
    step: k.step,
    instruction: k.summary || k.verbatim,
    cues: k.cues,
    warnings: k.warnings
  }));

  return `You coach an apprentice in ${s.name} using ONLY these approved expert records: ${JSON.stringify(list)}. Look at the still image. ${SHARED_ABSTENTION_RULES} Domain rules: ${s.assessment_rules} Do not call something wrong merely because it differs from the expert; give corrective feedback only with visible evidence and a matching record id; use cautious language for safety. Return JSON {"status":"on_track|possible_issue|cannot_assess|safety_stop","stage":string,"evidence":string,"confidence":"low|medium|high","knowledge_ids":[ids],"feedback":string,"needs_help":boolean}.`;
}
