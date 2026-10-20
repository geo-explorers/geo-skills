import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {reportDraft,prepareReportDraft,recordDelivery,emptyState,hash,reviewContentHash} from '../scripts/review-core.mjs';
import {buildReportOps} from '../scripts/report-ops.mjs';
const require=createRequire(path.join(process.env.GEO_CM_DIR,'package.json'));
const {Graph}=await import(require.resolve('@geoprotocol/geo-sdk'));
const id=n=>n.toString(16).padStart(32,'0'),original='Full statement with qualifiers. '.repeat(50);
const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'intro-gates-')),'verified.json');
fs.writeFileSync(file,JSON.stringify({complete:true,state:'verified'}));
function fixture(){return {id:id(1),fingerprint:'fp',family:'routine',kind:'news',curatorName:'Curator',bountyName:'News',space:'crypto',bountyId:id(9),spec:{spaceId:id(5)},caseKey:'2026-10-14',proposalIds:[id(4),id(8)],proposalRefs:{[id(4)]:{spaceId:id(5)},[id(8)]:{spaceId:id(5)}},itemIds:[id(3),id(7)],editorDecisions:[],delivery:{status:'not_prepared'},review:{fingerprint:'fp',outcome:'needs_correction',checkedAt:'2026-10-14T10:00:00Z',coverage:[{itemId:id(3),itemName:'Alpha',outcome:'needs_correction',selection:{outcome:'qualifies',evidence:['Distinct event']}},{itemId:id(7),itemName:'Beta',outcome:'does_not_meet_requirements',selection:{outcome:'does_not_qualify',evidence:['Earlier duplicate']}}],findings:[{itemId:id(3),originalRef:{proposalId:id(4)},original,excerpt:'qualifiers',issue:'Certainty qualifier omitted',processQuestion:'How was the qualification checked?',repairEligible:true,repairRequest:'Restore the qualification.',prevention:'Compare the summary with the original source.',evidenceDetail:'Primary passage read.',citations:[{url:'https://example.org/source',locator:'Paragraph 1',retrievedAt:'2026-10-14T09:00:00Z'}]}],scoring:{rate:10,ruleSource:'PRIVATE_RULE',weekly:{limit:250,priorPoints:240,evidence:['PRIVATE_LEDGER']}}}};}
function plan(d){return {mode:'create',targetSpaceId:d.targetSpaceId,caseFingerprint:d.fingerprint,discoveryReceipt:file,duplicateCheckReceipt:file,schemaReceipt:file,items:{[id(3)]:{name:'Alpha',spaceId:id(5),proposalUrl:'https://www.geobrowser.io/space/'+id(5)+'/governance?proposalId='+id(4),state:'captured_pending'}},citations:{'https://example.org/source':{entityId:id(6),spaceId:id(5),state:'verified_live'}}};}
const bodies=ops=>ops.ops.flatMap(o=>o.values??[]).filter(v=>v.property==='e3e363d1dd294ccb8e6ff3b76d99bc33').map(v=>v.value.value);
test('routine Geo Text contains exactly three bullets while full evidence and native findings survive',()=>{
 const c=fixture();c.review.recipientSummary={acceptance:'Recommended: Alpha.',rejection:'Recommended: Beta, because the event was already covered.',feedback:'Could you explain your checks before submitting? Please restore Alpha’s qualifier and fix similar eligible issues in this batch; compare future summaries with their sources. Open each finding for details.'};
 const d=reportDraft(c),out=buildReportOps(d,plan(d),Graph),text=bodies(out);
 assert.equal(text[0],d.introduction);assert.equal(text[0].trim().split('\n').length,3);
 assert.equal(text[0].includes('##'),false);assert.equal(text[0].includes('Proposals reviewed'),false);
 assert.equal(text[0].includes('PRIVATE'),false);assert.equal(text[0].includes(original),false);
 assert.ok(text[1].includes(original)&&text[1].includes(c.review.findings[0].processQuestion)&&text[1].includes('https://example.org/source'));
 assert.ok(out.edges.some(e=>e.type==='a99f9ce12ffa4dac8c61f6310d46064a'));
});
test('publication builder refuses an extra paragraph or missing routine intro instead of silently expanding it',()=>{
 const d=reportDraft(fixture()),p=plan(d);
 assert.throws(()=>buildReportOps({...d,introduction:d.introduction+'\nExtra paragraph.'},p,Graph),/exactly/);
 assert.throws(()=>buildReportOps({...d,introduction:undefined},p,Graph),/three-bullet/);
 for(const first of ['The qualifying launches and governance proposals listed in Geo.','99 stories recommended for acceptance: Alpha.'])assert.throws(()=>buildReportOps({...d,introduction:d.introduction.replace(d.introduction.split('\n')[0],'- **Accepted:** '+first)},p,Graph),/accurate count/);
});
test('fallback separates selection credit from copy repairs and uses only current verified vote/execution stages',()=>{
 const c=fixture();let d=reportDraft(c);assert.ok(d.introduction.includes('1 story recommended for acceptance: Alpha'));
 c.editorDecisions=[{kind:'vote',status:'verified',fingerprint:'fp',itemId:id(3),vote:'YES',executed:false},{kind:'vote',status:'verified',fingerprint:'fp',itemId:id(7),vote:'NO'}];
 d=reportDraft(c);assert.ok(d.introduction.includes('publication is pending'));assert.ok(d.introduction.includes('NO votes recorded: Beta'));
 c.editorDecisions[0].executed=true;assert.ok(reportDraft(c).introduction.includes('Confirmed published.'));
 c.editorDecisions[0].fingerprint='old';assert.ok(reportDraft(c).introduction.includes('1 story recommended for acceptance: Alpha'));
});
test('no findings invents no question and rejected-only findings request no futile repairs',()=>{
 const c=fixture();c.review.findings=[];assert.equal(reportDraft(c).introduction.includes('?'),false);
 c.review.findings=[{...fixture().review.findings[0],itemId:id(7),repairEligible:false,repairRequest:undefined}];
 const intro=reportDraft(c).introduction;assert.ok(intro.includes('no repair is requested'));assert.equal(intro.includes('Please fix'),false);
});
test('multiline submitted names stay intact in the case without adding Text paragraphs',()=>{
 const c=fixture();c.review.coverage[0].itemName='Alpha\nwith a qualifier';const before=structuredClone(c);
 const intro=reportDraft(c).introduction;assert.equal(intro.trim().split('\n').length,3);assert.ok(intro.includes('Alpha with a qualifier'));assert.deepEqual(c,before);
});
test('renderer change preserves legacy content hash and verified delivery; authored feedback changes create an update',()=>{
 const c=fixture(),s=emptyState();s.cases[c.id]=c;const legacy=hash({fingerprint:c.fingerprint,curatorName:c.curatorName,bountyName:c.bountyName,proposalIds:c.proposalIds,itemIds:c.itemIds,outcome:c.review.outcome,findings:c.review.findings.map(f=>({...f,citations:f.citations.map(({retrievedAt,...citation})=>citation)}))});
 assert.equal(reviewContentHash(c),legacy);
 recordDelivery(s,{caseId:c.id,fingerprint:'fp',status:'verified',reportId:id(99),receipt:{url:'https://www.geobrowser.io/space/'+id(5)+'/'+id(99),readbackAt:'2026-10-14T10:30:00Z',evidence:['Readback']}});
 const receipt=structuredClone(c.delivery);assert.equal(prepareReportDraft(c,'new-format.json').readyToPublish,false);assert.equal(c.delivery.status,'verified');assert.deepEqual(c.delivery.receipt,receipt.receipt);
 c.review.recipientSummary={acceptance:'Recommended: Alpha.',rejection:'Recommended: Beta, an earlier duplicate.',feedback:'Could you describe your checks? Restore the qualifier and check other eligible items before submitting again.'};
 assert.notEqual(reviewContentHash(c),legacy);const changed=prepareReportDraft(c,'changed-copy.json');assert.equal(changed.readyToPublish,true);assert.equal(changed.draft.publicationAction,'update');assert.equal(c.deliveryHistory.at(-1).status,'verified');
});
test('non-routine full introductions remain available and table pointer is appended only once',()=>{
 const c=fixture();c.family='bespoke';const d=reportDraft(c);d.markdown='Existing short intro. Open each review for details.\n\n## Review feedback\n\nTable preview';
 const text=bodies(buildReportOps(d,plan(d),Graph))[0];assert.equal((text.match(/Open each review/g)??[]).length,1);assert.equal(text.includes('## Review feedback'),false);
});
