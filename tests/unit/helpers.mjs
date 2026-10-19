import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);

export const Engine = require(path.join(root, 'app/src/engine.js'));
export const Grader = require(path.join(root, 'app/src/grader.js'));
export const Coach = require(path.join(root, 'app/src/coach.js'));
export const Content = require(path.join(root, 'app/src/content.js'));
export const Instagram = require(path.join(root, 'app/src/instagram.js'));

function loadConfig() {
  const text = readFileSync(path.join(root, 'config/gamification.yaml'), 'utf8');
  try {
    return require('js-yaml').load(text);
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    const { execFileSync } = require('node:child_process');
    const out = execFileSync('python3', ['-c', 'import sys,yaml,json; print(json.dumps(yaml.safe_load(sys.stdin.read())))'], { input: text });
    return JSON.parse(out.toString());
  }
}
export const cfg = loadConfig();

export function freshState() {
  return { ledger: [], ideas: [], reps: [], posts: [], lessonsDone: [], profile: { name: 'Test User', niche: 'food', language: 'english' } };
}

// Noon local time on a given day, so DST and timezone edges don't move the day.
export function at(day, hour = 12) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour).getTime();
}
