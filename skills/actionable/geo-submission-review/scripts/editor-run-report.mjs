#!/usr/bin/env node
// Portable, offline editor handoff renderer. Never signs, queries or publishes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const templateURL = new URL('../assets/editor-run-report.md', import.meta.url);
const requiredText = (v, label) => {
  if (typeof v !== 'string' || !v.trim()) throw Error(`${label} needs explicit text`);
  return v;
};
const list = (v, label) => {
  if (!Array.isArray(v)) throw Error(`${label} must be an explicit array`);
  return v;
};
const count = (v, label) => {
  if (v !== null && (!Number.isSafeInteger(v) || v < 0)) throw Error(`${label} must be a nonnegative integer or null (unknown)`);
  return v === null ? 'Unknown' : String(v);
};
const text = v => String(v).replace(/\r?\n/g, ' ').replace(/\\/g, '\\\\').replace(/[|\[\]*_`<>#]/g, '\\$&');
function utc(v, label) {
  if (typeof v !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v))) throw Error(`${label} needs an ISO timestamp with timezone`);
  return new Date(v).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}
function link(label, target) {
  requiredText(target, 'link target');
  if (!/^https:\/\//.test(target) && !/^(?:\/|\.\.?\/)/.test(target)) throw Error('Links need HTTPS or a local artifact path');
  if (/[\r\n<>]/.test(target)) throw Error('Invalid link target');
  return `[${text(label)}](<${target}>)`;
}
const bullets = rows => rows.length ? rows.map(r => '- ' + r).join('\n') : 'None.';

export function renderEditorRunReport(r) {
  if (r.schemaVersion !== 1 || r.audience !== 'editor_only') throw Error('Expected schemaVersion 1 and audience editor_only');
  requiredText(r.runId, 'runId');
  const at = utc(r.reviewedAt, 'reviewedAt');
  const ready = list(r.ready, 'ready'), investigations = list(r.investigations, 'investigations');
  const identification = list(r.identification, 'identification');
  const actions = list(r.actions, 'actions'), feedback = list(r.feedback, 'feedback');
  list(r.decisions, 'decisions'); list(r.completedActions, 'completedActions'); list(r.awaitingApproval, 'awaitingApproval');
  if (!['complete', 'incomplete', 'not_applicable'].includes(r.coverage?.status)) throw Error('Invalid coverage status');
  requiredText(r.coverage.detail, 'coverage.detail');
  const scan = r.scan === null ? 'Not applicable — specified submission' : `${utc(r.scan?.start, 'scan.start')} to ${utc(r.scan?.end, 'scan.end')}`;
  if (r.scan && Date.parse(r.scan.start) > Date.parse(r.scan.end)) throw Error('Scan window is reversed');
  if (!r.scan && r.coverage.status !== 'not_applicable') throw Error('Specified submissions use not_applicable scan coverage');
  const ids = new Set();
  const readyRows = ready.map(c => {
    requiredText(c.caseId, 'caseId');
    if (ids.has(c.caseId)) throw Error('Duplicate ready case');
    ids.add(c.caseId);
    if (c.reviewComplete !== true) throw Error('Unfinished reviews belong in investigations');
    for (const k of ['curator', 'bounty', 'recommendation', 'points']) requiredText(c[k], k);
    let report;
    if (c.report?.status === 'verified') {
      utc(c.report.verifiedAt, 'report.verifiedAt');
      requiredText(c.fingerprint, 'case fingerprint');
      if (c.report.fingerprint !== c.fingerprint) throw Error('Report verification is stale');
      if (!/^https:\/\/www\.geobrowser\.io\/space\/[a-f\d-]+\/[a-f\d-]+$/i.test(c.report.url ?? '')) throw Error('Verified report needs a Geo entity URL');
      report = link('Verified Geo report', c.report.url);
    } else {
      if (!['draft', 'failed', 'not_published'].includes(c.report?.status)) throw Error('Explicit report delivery status required');
      report = text('Not verified — ' + requiredText(c.report.detail, 'delivery blocker'));
    }
    return `| ${text(c.curator)} — ${text(c.bounty)} | ${text(c.recommendation)} | ${text(c.points)} | ${report} |`;
  }).join('\n') || '| None ready | — | — | — |';
  const actionIds = new Set();
  const actionLines = actions.map(a => {
    if (!['YES', 'NO', 'Hold'].includes(a.vote)) throw Error('Action must be YES, NO or Hold');
    requiredText(a.proposalId, 'proposalId');
    if (actionIds.has(a.proposalId)) throw Error('Conflicting or duplicated proposal actions');
    actionIds.add(a.proposalId);
    if (!ids.has(a.caseId)) throw Error('Actions require a completed case in this run report');
    return `${a.vote}: ${link(requiredText(a.label, 'action label'), a.url)} (${text(a.proposalId)}) — ${text(requiredText(a.reason, 'reason'))}.`;
  });
  const feedbackLines = feedback.map(f => {
    if (!ids.has(f.caseId)) throw Error('Feedback requires a completed case in this run report');
    return `${text(requiredText(f.curator, 'feedback curator'))}: ${link('Draft', f.draftUrl)}. ${text(requiredText(f.detail, 'feedback detail'))}`;
  });
  const investigationLines = investigations.map(c => {
    if (ids.has(c.caseId)) throw Error('A case cannot be both completed and still investigated');
    return `${text(requiredText(c.label, 'investigation label'))}: ${text(requiredText(c.blocker, 'blocker'))}. Next step: ${text(requiredText(c.nextStep, 'nextStep'))}. No final report issued for this case in this run.`;
  });
  for (const c of identification) investigationLines.push(`Needs identification — ${text(requiredText(c.label, 'identification label'))}: ${text(requiredText(c.blocker, 'blocker'))}. Next step: ${text(requiredText(c.nextStep, 'nextStep'))}.`);
  const v = {
    title: text(requiredText(r.space, 'space')), reviewedAt: at, scan,
    coverage: `${{complete:'Complete',incomplete:'Incomplete',not_applicable:'Not applicable'}[r.coverage.status]} — ${text(r.coverage.detail)}`,
    newProposals: count(r.newProposals, 'newProposals'), caseCount: count(r.caseCount, 'caseCount'),
    completedReviews: ready.length, investigationCount: investigations.length, identificationCount: identification.length,
    proposalNoun: r.newProposals === 1 ? 'proposal' : 'proposals', caseNoun: r.caseCount === 1 ? 'case' : 'cases',
    reviewNoun: ready.length === 1 ? 'review' : 'reviews', investigationNoun: investigations.length === 1 ? 'case' : 'cases', identificationNoun: identification.length === 1 ? 'submission' : 'submissions',
    readyRows, actions: bullets(actionLines), executionConsequence: text(requiredText(r.executionConsequence, 'executionConsequence')),
    feedback: bullets(feedbackLines), investigations: bullets(investigationLines),
    decisions: r.decisions.length ? r.decisions.map((d,i) => `${i+1}. ${text(requiredText(d, 'decision'))}`).join('\n') : 'No editor decision needed.',
    completedActions: r.completedActions.length ? r.completedActions.map(a => `${text(requiredText(a.detail, 'completed action'))} (${link('receipt', a.receiptUrl)})`).join('; ') : 'None.',
    awaitingApproval: r.awaitingApproval.length ? r.awaitingApproval.map(a => text(requiredText(a, 'awaiting approval'))).join('; ') : 'None.',
    payoutStatus: text(requiredText(r.payoutStatus, 'payoutStatus')),
  };
  return fs.readFileSync(templateURL, 'utf8').replace(/\{\{(\w+)\}\}/g, (_,key) => {
    if (!(key in v)) throw Error(`Unknown template slot ${key}`);
    return v[key];
  });
}

export function writeEditorRunReport(inputFile, outputDirectory) {
  const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  const markdown = renderEditorRunReport(input); // Validate before writing either artifact.
  const out = path.resolve(outputDirectory);
  fs.mkdirSync(out, {recursive:true});
  fs.writeFileSync(path.join(out, 'EDITOR-RUN-REPORT.json'), JSON.stringify(input, null, 2) + '\n', {mode:0o600});
  fs.writeFileSync(path.join(out, 'EDITOR-RUN-REPORT.md'), markdown, {mode:0o600});
  return {runId:input.runId, audience:'editor_only', markdown:path.join(out,'EDITOR-RUN-REPORT.md'), json:path.join(out,'EDITOR-RUN-REPORT.json')};
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const [input, out] = process.argv.slice(2);
  if (!input || !out) throw Error('Usage: node editor-run-report.mjs RUN_SUMMARY_JSON OUTPUT_DIRECTORY');
  console.log(JSON.stringify(writeEditorRunReport(input, out)));
}
