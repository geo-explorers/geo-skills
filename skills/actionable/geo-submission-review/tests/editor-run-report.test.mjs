import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderEditorRunReport,writeEditorRunReport} from '../scripts/editor-run-report.mjs';
const base = () => ({schemaVersion:1,audience:'editor_only',runId:'test-run',space:'Crypto',reviewedAt:'2026-10-06T11:00:00+01:00',scan:{start:'2026-10-05T10:00:00Z',end:'2026-10-06T10:00:00Z'},coverage:{status:'complete',detail:'Main and datasets feeds covered.'},newProposals:0,caseCount:0,ready:[],actions:[],executionConsequence:'No execution proposed.',feedback:[],investigations:[],identification:[],decisions:[],completedActions:[],awaitingApproval:[],payoutStatus:'Not requested.'});
const ready = () => ({caseId:'one',fingerprint:'current',reviewComplete:true,curator:'Example curator',bounty:'News',recommendation:'Accept 4 items; reject 2',points:'40 before caps; ledger verification pending.',report:{status:'verified',url:'https://www.geobrowser.io/space/abc/def',verifiedAt:'2026-10-06T10:00:00Z',fingerprint:'current'}});

test('empty complete scan remains zero with no unnecessary decision; explicit UTC conversion',()=>{
 const r=base(), out=renderEditorRunReport(r);
 assert.ok(out.includes('2026-10-06 10:00:00 UTC'));
 assert.ok(out.includes('0 new proposals captured'));
 assert.ok(out.includes('No editor decision needed.'));
 assert.equal(r.ready.length,0);
});
test('failed intake preserves unknown counts and exact blocker without pretending zero',()=>{
 const r=base();r.newProposals=null;r.caseCount=null;r.coverage={status:'incomplete',detail:'API unavailable; checkpoint retained.'};
 r.investigations=[{caseId:'queue',label:'Carried case',blocker:'Source inaccessible',nextStep:'Read official archive'}];
 const out=renderEditorRunReport(r);
 assert.ok(out.includes('Unknown new proposals'));assert.ok(out.includes('Incomplete — API unavailable'));
 assert.ok(out.includes('1 case still being investigated'));assert.ok(out.includes('No final report issued'));
 assert.throws(()=>renderEditorRunReport({...r,newProposals:undefined}),/nonnegative/);
});
test('ready case uses verified current delivery, full exact proposal and receipt-backed completion',()=>{
 const r=base();r.ready=[ready()];r.newProposals=6;r.caseCount=1;
 r.actions=[{caseId:'one',proposalId:'proposal-1',vote:'YES',label:'Story A',url:'https://www.geobrowser.io/space/abc/governance?proposalId=123',reason:'Qualifying event'}];
 r.feedback=[{caseId:'one',curator:'Example curator',draftUrl:'./reply.md',detail:'Draft only'}];
 r.completedActions=[{detail:'Report published and read back',receiptUrl:'./delivery.json'}];
 const before=JSON.stringify(r),out=renderEditorRunReport(r);
 assert.ok(out.includes('(proposal-1)'));assert.ok(out.includes('ledger verification pending'));
 assert.ok(out.includes('[receipt](<./delivery.json>)'));assert.equal(JSON.stringify(r),before);
});
test('stale publication and unverified delivered links cannot masquerade as verified',()=>{
 const r=base();r.ready=[ready()];r.ready[0].report.fingerprint='old';
 assert.throws(()=>renderEditorRunReport(r),/stale/);
 r.ready[0].report={status:'failed',detail:'Indexer timeout',url:'https://www.geobrowser.io/space/abc/def'};
 const out=renderEditorRunReport(r);assert.ok(out.includes('Not verified — Indexer timeout'));assert.ok(!out.includes('https://www.geobrowser.io/space/abc/def'));
});
test('unfinished and conflicting action states are rejected before output',()=>{
 const r=base();r.ready=[ready()];r.ready[0].reviewComplete=false;
 assert.throws(()=>renderEditorRunReport(r),/Unfinished/);r.ready[0].reviewComplete=true;
 const a={caseId:'one',proposalId:'same',vote:'YES',label:'Story',url:'https://example.com/proposal',reason:'Verified'};
 r.actions=[a,{...a,vote:'NO'}];assert.throws(()=>renderEditorRunReport(r),/duplicated/);
 r.actions=[];r.investigations=[{caseId:'one'}];assert.throws(()=>renderEditorRunReport(r),/both/);
});
test('specified submission and failed publishing retain correct scope and no invented scan',()=>{
 const r=base();r.space='World affairs';r.scan=null;r.newProposals=null;r.caseCount=null;r.coverage={status:'not_applicable',detail:'Specified source collection; 49 sources reviewed.'};r.ready=[ready()];
 r.ready[0].bounty='Editor brief — no formal bounty';r.ready[0].report={status:'not_published',detail:'Runtime lacks publishing access'};
 const out=renderEditorRunReport(r);assert.ok(out.includes('Not applicable — specified submission'));assert.ok(out.includes('49 sources reviewed'));assert.ok(out.includes('Runtime lacks publishing access'));
});
test('plain text cannot inject table rows and executable links are refused',()=>{
 const r=base();r.ready=[ready()];r.ready[0].curator='Name | fake\nrow';r.ready[0].recommendation='[approve](javascript:bad)';
 const out=renderEditorRunReport(r);assert.ok(out.includes('Name \\| fake row'));assert.ok(out.includes('\\[approve\\]'));
 r.feedback=[{caseId:'one',curator:'Name',draftUrl:'javascript:bad',detail:'draft'}];assert.throws(()=>renderEditorRunReport(r),/HTTPS/);
});
test('standalone renderer works from unrelated directory with only copied script/template and private artifacts',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'review-handoff-'));
 fs.mkdirSync(path.join(root,'skill/scripts'),{recursive:true});fs.mkdirSync(path.join(root,'skill/assets'));
 fs.copyFileSync(fileURLToPath(new URL('../scripts/editor-run-report.mjs',import.meta.url)),path.join(root,'skill/scripts/editor-run-report.mjs'));
 fs.copyFileSync(fileURLToPath(new URL('../assets/editor-run-report.md',import.meta.url)),path.join(root,'skill/assets/editor-run-report.md'));
 const input=path.join(root,'input.json');fs.writeFileSync(input,JSON.stringify(base()));
 const output=path.join(root,'out');const run=spawnSync(process.execPath,[path.join(root,'skill/scripts/editor-run-report.mjs'),input,output],{cwd:os.tmpdir(),encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'EDITOR-RUN-REPORT.json'))),base());
 assert.equal(fs.readFileSync(path.join(output,'EDITOR-RUN-REPORT.md'),'utf8'),renderEditorRunReport(base()));
 const invalid=base();invalid.ready=[{reviewComplete:false}];fs.writeFileSync(input,JSON.stringify(invalid));
 assert.throws(()=>writeEditorRunReport(input,output));assert.equal(fs.readFileSync(path.join(output,'EDITOR-RUN-REPORT.md'),'utf8'),renderEditorRunReport(base()));
});
