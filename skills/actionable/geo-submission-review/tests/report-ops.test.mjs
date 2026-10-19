import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {createRequire} from 'node:module';
import {stableId,reportDraft} from '../scripts/review-core.mjs';
import {buildReportOps} from '../scripts/report-ops.mjs';
let sdk;try{sdk=await import('@geoprotocol/geo-sdk');}catch{const r=createRequire(path.join(process.env.GEO_CM_DIR,'package.json'));sdk=await import(r.resolve('@geoprotocol/geo-sdk'));}
const id=n=>n.toString(16).padStart(32,'0');
const original='Full original with meaningful qualifiers. '.repeat(30);
const draft={caseId:id(1),pageId:stableId('submission-report:'+id(1)),publicationStatus:'draft_only',fingerprint:'fixture',targetSpaceId:id(2),title:'Fixture curator — submission review',markdown:'Compact recipient feedback.',review:{fingerprint:'fixture',outcome:'needs_correction',coverage:[{itemId:id(3),outcome:'needs_correction',evidence:['Verified fixture defect']}],findings:[{itemId:id(3),originalRef:{proposalId:id(4)},original,excerpt:'meaningful qualifiers',issue:'A supported fixture mismatch',evidenceDetail:'Read fixture evidence',citations:[{url:'https://example.org/a',locator:'Paragraph A',retrievedAt:'2026-10-03T12:00Z'},{url:'https://example.org/a#b',locator:'Paragraph B',retrievedAt:'2026-10-03T12:00Z'}]}]}};
const receiptDir=fs.mkdtempSync(path.join(os.tmpdir(),'report-receipt-test-'));const receiptFile=path.join(receiptDir,'receipt.json');fs.writeFileSync(receiptFile,JSON.stringify({complete:true,state:'verified'}));
const plan={mode:'create',targetSpaceId:id(2),caseFingerprint:'fixture',discoveryReceipt:receiptFile,schemaReceipt:receiptFile,duplicateCheckReceipt:receiptFile,addIssueToFindingSchema:true,items:{[id(3)]:{name:'Fixture item',spaceId:id(5),proposalUrl:'https://www.geobrowser.io/space/'+id(5)+'/governance?proposalId='+id(4),state:'captured_pending'}},citations:{'https://example.org/a':{entityId:id(6),spaceId:id(5),state:'verified_live'},'https://example.org/a#b':{entityId:id(6),spaceId:id(5),state:'verified_live'}}};
test('operation preview is deterministic, typed, complete and has no destructive operations',()=>{const a=buildReportOps(draft,plan,sdk.Graph),b=buildReportOps(draft,plan,sdk.Graph);assert.deepEqual(a,b);assert.ok(a.created.every(e=>e.types.length));assert.ok(a.ops.some(o=>(o.set??o.values??[]).some(v=>v.property==='5d4dda664938562da3eec5bc6017c04c'&&v.value.value===original)));assert.equal(a.ops.some(o=>/delete/.test(o.type)||o.unset?.length),false);});
test('citation values target each relation entity, including distinct locators on the same source',()=>{const a=buildReportOps(draft,plan,sdk.Graph);const sources=a.ops.filter(o=>o.type==='createRelation'&&o.relationType==='49c5d5e1679a4dbdbfd33f618f227c94');assert.equal(sources.length,2);assert.equal(new Set(sources.map(s=>s.id)).size,2);for(const s of sources)assert.ok(a.ops.some(o=>o.id===s.entity&&(o.set??o.values??[]).some(v=>v.property==='412ff593e9154012a43d4c27ec5c68b6')));});
test('stale or existing-report operations require a new preservation plan',()=>{assert.throws(()=>buildReportOps(draft,{...plan,caseFingerprint:'stale'},sdk.Graph),/revision/);assert.throws(()=>buildReportOps(draft,{...plan,mode:'update'},sdk.Graph),/preservation/);assert.throws(()=>buildReportOps(draft,{...plan,citations:{}},sdk.Graph),/identity/);});

test('all serialized operation IDs are full hex strings, never Buffer JSON objects',()=>{const a=buildReportOps(draft,plan,sdk.Graph);for(const o of a.ops){for(const k of ['id','from','to','entity','relationType'])if(o[k]!==undefined)assert.match(o[k],/^[a-f0-9]{32}$/);for(const v of o.set??o.values??[])assert.match(v.property,/^[a-f0-9]{32}$/);}});
test('unverified or invented receipt objects cannot authorize a dry-run',()=>{const bad=path.join(receiptDir,'failed.json');fs.writeFileSync(bad,JSON.stringify({complete:true,state:'verified',verified:false}));assert.throws(()=>buildReportOps(draft,{...plan,schemaReceipt:bad},sdk.Graph),/unverified/);assert.throws(()=>buildReportOps(draft,{...plan,discoveryReceipt:{verified:false}},sdk.Graph),/existing JSON/);});

test('Geo introduction omits unsupported Markdown table while the native table and full finding remain',()=>{const input={...draft,markdown:'# Report\n\n## Review feedback\n\n| Entity | Full original statement |\n| --- | --- |\n| Item | '+original+' |'};const a=buildReportOps(input,plan,sdk.Graph);const textValues=a.ops.flatMap(o=>o.values??[]).filter(v=>v.property==='e3e363d1dd294ccb8e6ff3b76d99bc33').map(v=>v.value.value);assert.ok(textValues[0].includes('Open each review'));assert.equal(textValues[0].includes('| Entity |'),false);assert.ok(textValues.some(t=>t.includes('## Full original statement\n\n'+original)));assert.ok(a.edges.some(e=>e.type==='a99f9ce12ffa4dac8c61f6310d46064a'));});

test('recipient draft and Geo page preserve separate title, readable review date and linked full details',()=>{
 const c={id:draft.caseId,fingerprint:draft.fingerprint,curatorName:'Fixture curator',bountyName:'Fixture bounty',caseKey:'2026-10-02',space:'crypto',bountyId:id(8),spec:{spaceId:id(5)},proposalIds:[id(4)],proposalRefs:{[id(4)]:{spaceId:id(5)}},review:{...draft.review,fingerprint:draft.fingerprint,outcome:'needs_correction',checkedAt:'2026-10-03T23:38:26.186Z'}};
 const rendered=reportDraft(c),a=buildReportOps(rendered,{...plan,targetSpaceId:rendered.targetSpaceId},sdk.Graph);
 const body=a.ops.flatMap(o=>o.values??[]).filter(v=>v.property==='e3e363d1dd294ccb8e6ff3b76d99bc33').map(v=>v.value.value);
 assert.equal(a.created.find(e=>e.id===a.pageId).name,rendered.title);
 assert.equal(body[0].includes(rendered.title),false);
 assert.equal(rendered.review.checkedAt,c.review.checkedAt);
 assert.equal(rendered.review.outcome,'needs_correction');
 assert.match(body[0],/3 October 2026/); // Recipient dates now use UTC too.
 assert.equal(body[0].includes(c.review.checkedAt),false);
 assert.equal(body[0].includes('unresolved'),false);
 assert.match(body[0],/address the issues/);
 assert.match(body[0],/Open each review/);
 const finding=a.created.find(e=>e.types.includes('b14985a95e0c5a3ca872f29e22719ace'));
 assert.ok(a.edges.some(e=>e.type==='a99f9ce12ffa4dac8c61f6310d46064a'&&e.to===finding.id));
 assert.ok(a.edges.some(e=>e.type==='beaba5cba67741a8b35377030613fc70'&&e.from===finding.id));
 assert.ok(body.some(t=>t.includes(original)&&t.includes('https://example.org/a')&&t.includes(draft.review.findings[0].issue)));
});

test('Geo publication ops exclude internal editor scoring and cap-ledger fields',()=>{
 const internal={...draft,review:{...draft.review,scoring:{rate:37,ruleSource:'PRIVATE_EDITOR_RULE_SENTINEL',weekly:{priorPoints:243,evidence:['PRIVATE_LEDGER_SENTINEL']}}}};
 const out=buildReportOps(internal,plan,sdk.Graph);
 assert.equal(JSON.stringify(out).includes('PRIVATE_EDITOR_RULE_SENTINEL'),false);
 assert.equal(JSON.stringify(out).includes('PRIVATE_LEDGER_SENTINEL'),false);
});

test('publication refuses incomplete item decisions and does not trust a ready label',()=>{const pending=structuredClone(draft);pending.readiness={complete:true};pending.review.coverage[0].outcome='unresolved';assert.throws(()=>buildReportOps(pending,plan,sdk.Graph),/needs investigation/);pending.review.coverage[0].outcome='needs_correction';pending.review.outcome='unresolved';assert.throws(()=>buildReportOps(pending,plan,sdk.Graph),/needs investigation/);pending.review.outcome='needs_correction';pending.review.decisionGaps=['Material bounty requirement not checked'];assert.throws(()=>buildReportOps(pending,plan,sdk.Graph),/needs investigation/);});

test('published Issue property and full finding expose process, correction and prevention guidance',()=>{
 const input=structuredClone(draft),f=input.review.findings[0];
 f.processQuestion='How did you check this against the source?';f.repairRequest='Please restore the original qualifier.';f.prevention='Compare qualifiers with the source before submitting.';
 const out=buildReportOps(input,plan,sdk.Graph),values=out.ops.flatMap(o=>o.values??o.set??[]);
 const issue=values.find(v=>v.property==='6bb3a7b114ac5582af25aeb811115301').value.value;
 const body=values.filter(v=>v.property==='e3e363d1dd294ccb8e6ff3b76d99bc33').map(v=>v.value.value).find(text=>text.includes('## Full original statement'));
 for(const text of [f.issue,f.processQuestion,f.repairRequest,f.prevention]){assert.ok(issue.includes(text));assert.ok(body.includes(text));}
});
