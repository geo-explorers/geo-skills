import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {recordReview,reportDraft,reviewContentHash,emptyState,hash,stableId} from '../scripts/review-core.mjs';
import {prepareHistoryEntry,prepareHistoryFormatUpdate,recordHistoryReceipt,historyKey} from '../scripts/review-history.mjs';
import {renderNotionReport,validateNotionReport,NOTION_COLUMNS} from '../scripts/notion-report.mjs';
const id=n=>n.toString(16).padStart(32,'0');
const config={dataSourceId:'12345678-1234-1234-1234-123456789abc',databaseUrl:'https://example.org/history',lookupViewUrl:'view://12345678-1234-1234-1234-123456789abc'};
function fixture(){
  const c={id:id(1),fingerprint:'current',curatorId:id(2),curatorName:'Curator',space:'crypto',bountyId:id(3),bountyName:'Posts',spec:{spaceId:id(4)},proposalIds:[id(5)],proposalRefs:{[id(5)]:{spaceId:id(4)}},itemIds:[id(6)],caseKey:'2026-10-13',review:{fingerprint:'current',outcome:'needs_correction',checkedAt:'2026-10-13T12:00:00Z',coverage:[{itemId:id(6),outcome:'needs_correction',evidence:['Fixture requirement']}],requirements:[{criterion:'Attribution',outcome:'needs_correction',evidence:['Fixture specification']}],feedbackPolicy:'error_types_v1',verifiedErrorKinds:['Missing author'],findings:[{itemId:id(6),missingField:true,missingRequirement:'Author relation',excerpt:'',issue:'The author is missing.',errorKind:'Missing author',processQuestion:'How did you check the author before submitting?',repairEligible:true,repairRequest:'Please link the original author.',prevention:'Before submitting, compare the author relation with the original post.',citations:[{url:'https://example.org/post',locator:'Byline',retrievedAt:'2026-10-13T12:00:00Z'}],evidenceDetail:'Fixture author named in byline.'}]}};
  c.review.findings[0].itemUrl='https://example.org/submitted-item';
  c.delivery={reportId:id(7),status:'verified',fingerprint:c.fingerprint,reviewContentHash:reviewContentHash(c),receipt:{url:`https://www.geobrowser.io/space/${id(8)}/${id(7)}`,readbackAt:'2026-10-13T13:00:00Z',evidence:['Indexed report and full finding readback']}};return c;
}
const input=c=>({publishedAt:'2026-10-13T13:00:00Z',feedbackSnapshot:'The author is missing. How did you check the author before submitting? Please link the original author. Before submitting, compare the author relation with the original post.',snapshotReviewContentHash:reviewContentHash(c),publicationEvidence:['Verified published feedback capture']});
const receipt=(c,patch={})=>({caseId:c.id,fingerprint:c.fingerprint,key:historyKey(c),snapshotHash:'captured-hash',publishedAt:'2026-10-13T13:00:00Z',status:'unknown',recordedAt:'2026-10-13T13:05:00Z',evidence:['Saved intent journal'],...patch});

test('more than five error types survive recording and recipient rendering, without duplicate examples',()=>{
  const c=fixture(),s=emptyState();s.cases[c.id]=c;
  const r={...structuredClone(c.review),caseId:c.id};r.verifiedErrorKinds=Array.from({length:7},(_,i)=>'Verified error type '+i);r.findings=r.verifiedErrorKinds.map(errorKind=>({...r.findings[0],errorKind,issue:errorKind}));
  recordReview(s,r);const d=reportDraft(c);assert.equal(d.findings.length,7);assert.match(d.markdown,/How did you check the author/);assert.match(d.markdown,/Please link the original author/);assert.match(d.markdown,/Before submitting/);
  assert.throws(()=>recordReview(s,{...r,findings:r.findings.slice(0,6)}),/every verified error type/);
  assert.throws(()=>recordReview(s,{...r,findings:[...r.findings.slice(0,6),r.findings[0]]}),/every verified error type/);
});
test('process questions and prevention are required; futile repairs are rejected',()=>{
  const c=fixture(),s=emptyState();s.cases[c.id]=c;const r={...structuredClone(c.review),caseId:c.id};
  for(const field of ['processQuestion','prevention']){const bad=structuredClone(r);delete bad.findings[0][field];assert.throws(()=>recordReview(s,bad),/process question/);}
  const bad=structuredClone(r);bad.findings[0].repairEligible=false;assert.throws(()=>recordReview(s,bad),/futile repairs/);
  delete bad.findings[0].repairRequest;assert.doesNotThrow(()=>recordReview(s,bad));assert.equal(reportDraft(c).markdown.includes('Please link the original author'),false);assert.match(reportDraft(c).markdown,/Before submitting/);
});
test('history payload retains actual date, all submission links and feedback, without private scoring',()=>{
  const c=fixture();c.review.scoring={rate:999,ruleSource:'PRIVATE_SCORING_SENTINEL'};c.editorDecisions=[{kind:'private',evidence:['PRIVATE_APPROVAL_SENTINEL']}];
  const out=prepareHistoryEntry(c,input(c),config),p=out.create.pages[0].properties;
  assert.equal(out.lookup.mode,'view');assert.equal(out.lookupArchived.is_archived,true);assert.equal(out.lookup.view_url,config.lookupViewUrl);
  assert.equal(p.Curator,'Curator');assert.equal(p['Curator ID'],c.curatorId);assert.equal(p['date:Review date:start'],'2026-10-13T13:00:00.000Z');assert.equal(p['Geo report'],c.delivery.receipt.url);assert.match(p.Submission,/proposalId=/);assert.match(out.create.pages[0].content,/How did you check/);assert.match(out.create.pages[0].content,/Review recommendation:/);assert.equal(JSON.stringify(out).includes('PRIVATE_'),false);assert.equal(Object.hasOwn(p,'Editor feedback'),false);
});
test('scan timestamps, private scoring and citation refreshes do not create another review key',()=>{
  const c=fixture(),key=historyKey(c);c.review.checkedAt='2026-10-14T12:00:00Z';c.review.scoring={rate:10};c.review.findings[0].citations[0].retrievedAt='2026-10-14T12:00:00Z';assert.equal(historyKey(c),key);
  c.review.findings[0].prevention='A substantive new prevention instruction.';assert.notEqual(historyKey(c),key);
});
test('no-issue and no-bounty reviews produce truthful logs without manufactured findings',()=>{
  const c=fixture();c.bountyId=null;c.bountyName=null;c.review.outcome='meets_requirements';c.review.findings=[];c.review.verifiedErrorKinds=[];c.delivery.reviewContentHash=reviewContentHash(c);
  const out=prepareHistoryEntry(c,{...input(c),feedbackSnapshot:'No supported issue was found.'},config);assert.equal(out.create.pages[0].properties.Bounty,'No formal bounty');assert.equal(out.create.pages[0].properties['Bounty URL'],null);assert.equal(out.create.pages[0].properties['Error types'],'');
});
test('unfinished, stale or unverified reviews cannot produce a history create payload',()=>{
  const c=fixture();for(const patch of [{status:'unknown'},{fingerprint:'older'},{reviewContentHash:'older'}])assert.throws(()=>prepareHistoryEntry({...c,delivery:{...c.delivery,...patch}},input(c),config));
  assert.throws(()=>prepareHistoryEntry(c,{...input(c),snapshotReviewContentHash:'older'},config),/snapshot/);assert.throws(()=>prepareHistoryEntry(c,{...input(c),publishedAt:null},config),/publication date/);assert.throws(()=>prepareHistoryEntry(c,input(c),{}),/not configured/);
});
test('unknown log outcomes require reconciliation; verified reruns are idempotent',()=>{
  const c=fixture(),s=emptyState();s.cases[c.id]=c;recordHistoryReceipt(s,receipt(c));assert.equal(prepareHistoryEntry(c,input(c),config).status,'reconciliation_needed');
  recordHistoryReceipt(s,receipt(c,{status:'verified',url:'https://example.org/history-row',readbackAt:'2026-10-13T13:06:00Z'}));const before=structuredClone(c.curatorReviewLog);recordHistoryReceipt(s,receipt(c,{status:'verified',url:'https://example.org/history-row',readbackAt:'2026-10-13T13:07:00Z'}));assert.deepEqual(c.curatorReviewLog,before);assert.equal(prepareHistoryEntry(c,input(c),config).status,'already_logged');
  assert.throws(()=>recordHistoryReceipt(s,receipt(c,{status:'verified',url:'https://example.org/duplicate',readbackAt:'2026-10-13T13:08:00Z'})),/Conflicting/);
});
test('positive no-creation evidence permits retry and preserves the journaled snapshot/date',()=>{
  const c=fixture(),s=emptyState();s.cases[c.id]=c;recordHistoryReceipt(s,receipt(c));
  assert.throws(()=>recordHistoryReceipt(s,receipt(c,{snapshotHash:'different'})),/snapshot/);assert.throws(()=>recordHistoryReceipt(s,receipt(c,{publishedAt:'2026-10-14T13:00:00Z'})),/date/);
  assert.throws(()=>recordHistoryReceipt(s,receipt(c,{status:'not_created'})),/positive no-creation/);
  recordHistoryReceipt(s,receipt(c,{status:'not_created',outcome:'verified_not_created',reconciledAt:'2026-10-13T13:10:00Z'}));assert.equal(prepareHistoryEntry(c,input(c),config).status,'prepared');
});
test('older pending log can reconcile after a case revision without claiming the new review was logged',()=>{
  const c=fixture(),s=emptyState();s.cases[c.id]=c;const old=receipt(c);recordHistoryReceipt(s,old);c.fingerprint='revised';c.review.fingerprint='revised';c.review.findings[0].issue='New finding';
  recordHistoryReceipt(s,{...old,status:'verified',url:'https://example.org/old-row',readbackAt:'2026-10-14T13:00:00Z'});assert.notEqual(c.curatorReviewLog.at(-1).key,historyKey(c));assert.equal(c.curatorReviewLog.at(-1).fingerprint,'current');
});

test('repeat reports surface missing and interrupted logging without reopening Geo publication',()=>{
  const c=fixture(),s=emptyState();s.cases[c.id]=c;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'history-queue-')),stateDir=path.join(dir,'state'),out=path.join(dir,'out');fs.mkdirSync(stateDir);
  const run=()=>{fs.writeFileSync(path.join(stateDir,'state.json'),JSON.stringify(s));const result=spawnSync(process.execPath,[new URL('../scripts/review.mjs',import.meta.url).pathname,'reports','--state',stateDir,'--out',out],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(fs.readFileSync(path.join(out,'workflow-status.json')));};
  const first=run();assert.equal(first.drafts.length,0);assert.equal(first.historyLoggingPending[0].status,'needs_logging');assert.equal(c.delivery.status,'verified');
  recordHistoryReceipt(s,receipt(c));const pending=run();assert.equal(pending.drafts.length,0);assert.equal(pending.historyLoggingPending.length,1);assert.equal(pending.historyLoggingPending[0].status,'reconciliation_needed');
  recordHistoryReceipt(s,receipt(c,{status:'verified',url:'https://example.org/row',readbackAt:'2026-10-13T13:10:00Z'}));assert.deepEqual(run().historyLoggingPending,[]);
});

test('Notion body uses only concise review bullets, the complete Geo table and a final submission toggle',()=>{
  const c=fixture();c.review.findings[0].originalRef={proposalId:id(5)};c.review.findings[0].original='Full original: A > B; [literal] | **not formatting**\nSecond paragraph.';c.review.findings[0].excerpt='A > B';c.review.findings[0].missingField=false;
  c.review.findings[0].evidenceDetail+='\nPreserve the second evidence paragraph.';c.review.coverage[0].itemName='Submitted post';c.delivery.reviewContentHash=reviewContentHash(c);
  const before=structuredClone(c),args={...input(c),notionSummary:{accepted:'The supported parts meet the checked requirements.',needsCorrection:'Add the missing attribution and check the related records.',nextSteps:'Address eligible issues and use the checks in the findings.'},submissionUrls:['https://example.org/another-submission','https://example.org/another-submission']};
  const out=prepareHistoryEntry(c,args,config),body=out.create.pages[0].content;
  assert.deepEqual(c,before);assert.deepEqual(validateNotionReport(body,{findingCount:1}),{layout:out.layout,findingCount:1});
  assert.equal((body.match(/<table /g)??[]).length,1);assert.equal((body.match(/<td>/g)??[]).length,14);assert.equal((body.match(/another-submission/g)??[]).length,1);
  for(const header of NOTION_COLUMNS)assert.ok(body.includes('<td>'+header+'</td>'));
  for(const detail of ['Second paragraph.','How did you check the author','Please link the original author','compare the author relation','Preserve the second evidence paragraph.','https://example.org/post'])assert.ok(body.includes(detail),detail);
  assert.match(body,/A \\> B/);assert.match(body,/\\\[literal\\\]/);assert.ok(body.endsWith('</details>'));assert.ok(!body.includes('## '));
  assert.equal(out.snapshotHash,hash(args.feedbackSnapshot));assert.ok(out.bodyHash);assert.notEqual(out.bodyHash,out.snapshotHash);
});

test('all distinct findings and their exact published finding identifiers are retained without a cap',()=>{
  const c=fixture();c.review.findings=Array.from({length:8},(_,i)=>({...structuredClone(c.review.findings[0]),issueKey:'finding-'+i,issue:'Verified issue '+i}));c.delivery.reviewContentHash=reviewContentHash(c);
  const body=prepareHistoryEntry(c,input(c),config).create.pages[0].content;validateNotionReport(body,{findingCount:8});
  for(let i=0;i<8;i++){assert.ok(body.includes('Verified issue '+i));assert.ok(body.includes(stableId(c.delivery.reportId+':finding:'+id(6)+':finding-'+i)));}
  assert.equal((body.match(/— review feedback/g)??[]).length,8);
});

test('Notion introduction rejects multiline, oversized and unsupported action claims',()=>{
  const c=fixture(),summary={accepted:'The reviewed work is supported.',needsCorrection:'Check the findings.',nextSteps:'Address eligible issues.'};
  for(const bad of ['First line\nSecond line','First line<br>Second line','x'.repeat(201),'Votes recorded and published.','Points paid.'])assert.throws(()=>prepareHistoryEntry(c,{...input(c),notionSummary:{...summary,accepted:bad}},config),/single-line|action claims/);
  const body=prepareHistoryEntry(c,{...input(c),notionSummary:summary},config).create.pages[0].content;assert.match(body,/Accepted:\*\* Review recommendation:/);
});

test('layout validation rejects extra sections, lost findings, broken columns and expanded submission lists',()=>{
  const c=fixture(),body=prepareHistoryEntry(c,input(c),config).create.pages[0].content;
  for(const bad of [body.replace('<table','Extra prose\n<table'),body+'\n## Audit',body.replace('<td>Issue</td>','<td>What to fix</td>'),body.replace('\t- [Submission','- [Submission'),body.replace('- **Needs correction:**','- **Other:**')])assert.throws(()=>validateNotionReport(bad,{findingCount:1}));
  assert.throws(()=>validateNotionReport(body,{findingCount:2}),/every full finding/);
  const missing=fixture();delete missing.review.findings[0].evidenceDetail;missing.delivery.reviewContentHash=reviewContentHash(missing);assert.throws(()=>prepareHistoryEntry(missing,input(missing),config),/full issue/);
});

test('no-issue reviews omit empty tables and questions; empty and partial runs never create final reports',()=>{
  const c=fixture();c.review.outcome='meets_requirements';c.review.findings=[];c.review.verifiedErrorKinds=[];c.review.coverage[0].outcome='meets_requirements';c.delivery.reviewContentHash=reviewContentHash(c);
  const body=prepareHistoryEntry(c,input(c),config).create.pages[0].content;validateNotionReport(body,{findingCount:0});assert.ok(!body.includes('<table'));assert.ok(!body.includes('How did'));assert.match(body,/No corrections are requested/);
  for(const change of [x=>{x.itemIds=[];x.review.coverage=[];},x=>{x.review.outcome='unresolved';},x=>{x.review.decisionGaps=['Research incomplete'];}]){const partial=structuredClone(c);change(partial);assert.throws(()=>prepareHistoryEntry(partial,input(partial),config),/Finish the review/);assert.throws(()=>renderNotionReport(partial,input(partial),['https://example.org/submission']),/Finish the review/);}
});

const existingEntry=c=>({id:'12345678-1234-1234-1234-123456789abd',dataSourceId:config.dataSourceId,content:'Old agent-owned report body.',properties:{'Review key':historyKey(c),'Editor feedback':'Human correction: do not repeat this mistake.','Curator ID':c.curatorId,Review:'Original title'},readbackAt:'2026-10-18T18:00:00Z',evidence:['Fetched exact page'],lookup:{complete:true,matchCount:1,evidence:['Complete active and archived exact-key lookup']},hasInlineComments:false});
test('explicit format updates preserve human feedback and all metadata without a create fallback',()=>{
  const c=fixture(),existing=existingEntry(c),before=structuredClone(existing),key=historyKey(c),args={...input(c),allowFormatUpdate:true};
  const out=prepareHistoryFormatUpdate(c,args,config,existing);assert.deepEqual(existing,before);assert.equal(out.key,key);assert.equal(out.status,'format_update_prepared');assert.ok(!Object.hasOwn(out,'create'));assert.ok(!Object.hasOwn(out.update,'properties'));assert.equal(out.update.content_updates[0].old_str,existing.content);assert.ok(out.preservedProperties.includes('Editor feedback'));assert.ok(!JSON.stringify(out.update).includes(existing.properties['Editor feedback']));
  const repeated=prepareHistoryFormatUpdate(c,args,config,{...existing,content:out.update.content_updates[0].new_str});assert.equal(repeated.status,'unchanged');assert.equal(repeated.update,undefined);
  c.curatorReviewLog=[receipt(c,{status:'verified',url:'https://app.notion.com/p/'+existing.id.replaceAll('-',''),readbackAt:existing.readbackAt})];assert.equal(prepareHistoryEntry(c,input(c),config).status,'already_logged');assert.equal(historyKey(c),key);
});

test('format-only updates require exact existing identity, complete duplicate reconciliation and comment preservation',()=>{
  const c=fixture(),existing=existingEntry(c),args={...input(c),allowFormatUpdate:true};
  assert.throws(()=>prepareHistoryFormatUpdate(c,input(c),config,existing),/explicit scope/);
  for(const patch of [{dataSourceId:id(99)},{properties:{'Review key':'wrong'}},{lookup:{complete:false,matchCount:1}},{lookup:{complete:true,matchCount:2,evidence:['Duplicates']}},{hasInlineComments:true},{readbackAt:null}])assert.throws(()=>prepareHistoryFormatUpdate(c,args,config,{...existing,...patch}));
  c.curatorReviewLog=[receipt(c)];assert.throws(()=>prepareHistoryFormatUpdate(c,args,config,existing),/unknown history writes/);
});

test('format updates preserve the publication date and original snapshot despite Notion minute rounding',()=>{
  const c=fixture(),existing=existingEntry(c),args={...input(c),allowFormatUpdate:true};existing.properties['date:Review date:start']='2026-10-13T13:00:00.000Z';
  c.curatorReviewLog=[receipt(c,{snapshotHash:hash(args.feedbackSnapshot),publishedAt:args.publishedAt,status:'verified',url:'https://app.notion.com/p/'+existing.id.replaceAll('-',''),readbackAt:existing.readbackAt})];
  assert.doesNotThrow(()=>prepareHistoryFormatUpdate(c,args,config,existing));
  assert.throws(()=>prepareHistoryFormatUpdate(c,{...args,feedbackSnapshot:'A changed snapshot'},config,existing),/snapshot and date/);
  assert.throws(()=>prepareHistoryFormatUpdate(c,{...args,publishedAt:'2026-10-14T13:00:00Z'},config,existing),/snapshot and date/);
  c.curatorReviewLog=[];assert.throws(()=>prepareHistoryFormatUpdate(c,{...args,publishedAt:'2026-10-14T13:00:00Z'},config,existing),/existing review publication date/);
});
