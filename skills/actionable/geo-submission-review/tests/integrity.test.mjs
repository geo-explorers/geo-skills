import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { feedCoverage, entityLookup, validateInputs, requireList } from '../scripts/review-integrity.mjs';

test('each saturated feed must pass the cutoff, including equal-timestamp boundary', () => {
  const rows = Array.from({ length: 300 }, () => ({ createdAt: '100' }));
  assert.equal(feedCoverage(rows, 90, 300).complete, false);
  assert.equal(feedCoverage(rows, 100, 300).complete, false);
  assert.equal(feedCoverage(rows, 101, 300).complete, true);
  assert.equal(feedCoverage([], 90, 300).complete, true);
});
test('lookup errors, successful absence and found IDs remain distinct', () => {
  assert.equal(entityLookup(['a'], null, new Error('offline')).a.status, 'error');
  assert.equal(entityLookup(['a'], []).a.status, 'not-returned');
  assert.equal(entityLookup(['a'], [{ id: 'a' }]).a.status, 'found');
  assert.throws(() => requireList(null, 'bounties'));
});
test('reject invalid dates, missing editor, display names and invalid concurrency', () => {
  const valid = { since: 1, until: 2, editor: 'a'.repeat(32), injector: '', curators: [], concurrency: 8, baselineDays: 2 };
  validateInputs(valid);
  for (const bad of [{ since: NaN }, { since: 3 }, { editor: '' }, { curators: ['Ali'] }, { concurrency: 0 }, { baselineDays: -1 }]) assert.throws(() => validateInputs({ ...valid, ...bad }));
});

const here = path.dirname(fileURLToPath(import.meta.url));
function run(scenario, out) {
  out ||= fs.mkdtempSync(path.join(os.tmpdir(), 'geo-review-test-'));
  const result = spawnSync(process.execPath, ['--import', path.join(here, 'mock-stage0.mjs'), path.join(here, '../scripts/review-stage0.mjs'), '--space', 'crypto', '--since', '2026-09-18T00:00:00Z', '--until', '2026-09-20T00:00:00Z', '--editor', 'e'.repeat(32), '--out', out, '--cache', path.join(out, 'cache')], { env: { ...process.env, GEO_TEST_CASE: scenario }, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.ok(fs.existsSync(path.join(out, 'run-status.json')), result.stderr);
  return { code: result.status, out, status: JSON.parse(fs.readFileSync(path.join(out, 'run-status.json'))), summary: fs.readFileSync(path.join(out, 'summary.md'), 'utf8'), read: name => JSON.parse(fs.readFileSync(path.join(out, name))) };
}
test('complete empty and found-entity runs retain normal success', () => {
  for (const scenario of ['empty', 'found']) {
    const r = run(scenario); assert.equal(r.code, 0, r.summary); assert.equal(r.status.state, 'complete'); assert.equal(r.status.complete, true);
  }
});
test('busy main feed cannot be masked by an older datasets feed', () => {
  const r = run('truncated'); assert.equal(r.code, 2); assert.equal(r.status.complete, false);
  assert.equal(r.status.proposalCoverage.main.complete, false); assert.equal(r.status.proposalCoverage.datasets.complete, true);
});
test('failed enrichment produces unknown state and blocks final scoring', () => {
  const r = run('enrich-error'); assert.equal(r.code, 2);
  const items = r.read('items.json'); assert.equal(items[0].onGraph, null); assert.equal(items[0].graphState, 'error'); assert.equal(items[0].sources, null); assert.equal(items[0].liveFieldsKnown, false);
  assert.equal(r.read('entity-lookup.json')['b'.repeat(32)].status, 'error');
  assert.match(r.summary, /GRAPH STATE UNKNOWN/); assert.doesNotMatch(r.summary, /NO TOPICS/);
});
test('successful not-returned lookup is not mislabeled as failed or definitely pending', () => {
  const r = run('not-returned'); assert.equal(r.code, 0);
  assert.equal(r.read('items.json')[0].graphState, 'not-returned'); assert.match(r.summary, /pending\/deleted\/unindexed unresolved/);
});
test('bounty fetch failures and malformed data remain null, never successful empty lists', () => {
  for (const scenario of ['bounties-error', 'malformed-bounties']) {
    const r = run(scenario); assert.equal(r.code, 2); assert.equal(r.read('bounties.json').main, null); assert.equal(r.status.complete, false);
  }
});
test('decode and name lookup errors block completeness', () => {
  for (const scenario of ['decode-error', 'names-error']) { const r = run(scenario); assert.equal(r.code, 2); assert.equal(r.status.complete, false); }
});
test('fatal rerun invalidates prior successful status and summary', () => {
  const old = run('empty'); const r = run('fatal', old.out);
  assert.notEqual(r.code, 0); assert.equal(r.status.state, 'failed'); assert.equal(r.status.complete, false); assert.match(r.summary, /FAILED/);
});

test('Stage 0 keeps full binary-decoded values separately from compact previews',()=>{const r=run('found');const id='c'.repeat(32);const raw=r.read('raw-edits.json')[id];const full=raw[0].edit.ops.flatMap(o=>o.set??o.values??[]).find(v=>v.property==='44444444444444444444444444444444');assert.equal(full.value.value,'Full long submitted text. '.repeat(40));assert.equal(r.read('decoded.json')[id].entities['b'.repeat(32)].vals.Summary.length,300);assert.equal(r.read('manifest.json')[0].spaceId,'c9f267dcb0d270718c2a3c45a64afd32');});
