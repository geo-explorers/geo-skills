import {test} from 'node:test';
import assert from 'node:assert/strict';
import {acceptanceSummary,recipientGroups,routineIntroduction,reportDraft,reviewContentHash,prepareReportDraft} from '../scripts/review-core.mjs';
import {renderNotionReport,validateNotionReport} from '../scripts/notion-report.mjs';
import {historyKey,prepareHistoryEntry} from '../scripts/review-history.mjs';
const id=n=>n.toString(16).padStart(32,'0'),url='https://example.org/submission';
function fixture(){
 const coverage=[
  {itemId:id(1),itemName:'Atlas launches a wallet',outcome:'meets_requirements',selection:{outcome:'qualifies',evidence:['Event checked']}},
  {itemId:id(2),itemName:'Council adopts staking rules',outcome:'needs_correction',selection:{outcome:'qualifies',evidence:['Event checked']}},
  {itemId:id(3),itemName:'Earlier wallet announcement',outcome:'needs_correction',selection:{outcome:'does_not_qualify',evidence:['Earlier duplicate']}}
 ].map(r=>({...r,evidence:['Full check'],itemUrl:url}));
 const c={id:id(10),fingerprint:'fp',family:'routine',kind:'news',curatorName:'Curator',curatorId:id(11),bountyName:'News',bountyId:id(12),space:'crypto',caseKey:'2026-10-20',spec:{spaceId:id(13)},itemIds:coverage.map(r=>r.itemId),proposalIds:[id(14)],proposalRefs:{[id(14)]:{spaceId:id(13)}},review:{fingerprint:'fp',outcome:'needs_correction',checkedAt:'2026-10-20T10:00:00Z',coverage,requirements:[{outcome:'meets_requirements',criterion:'Events',evidence:['Specification']}],findings:[],recipientSummary:{acceptance:'The qualifying launches and governance developments listed in Geo.',rejection:'The earlier wallet announcement duplicates prior coverage.',feedback:'Check the date metadata in the accepted staking story.'}}};
 c.delivery={reportId:id(15),status:'verified',fingerprint:'fp',reviewContentHash:reviewContentHash(c),receipt:{url:`https://www.geobrowser.io/space/${id(13)}/${id(15)}`,readbackAt:'2026-10-20T11:00:00Z',evidence:['Fixture readback']}};
 return c;
}
const body=c=>renderNotionReport({...c,delivery:{...c.delivery,reviewContentHash:reviewContentHash(c)}},{},[url]).content;
const lists=text=>Object.fromEntries([...text.matchAll(/<summary>([^<]+)<\/summary>\n([\s\S]*?)\n<\/details>/g)].map(m=>[m[1],m[2]]));
test('count-first rundown is shared by Geo and Notion and legacy generic prose cannot override it',()=>{
 const c=fixture(),before=structuredClone(c),summary=acceptanceSummary(c);
 assert.equal(summary,'2 stories recommended for acceptance: Atlas launches a wallet; Council adopts staking rules. 1 still needs correction.');
 assert.ok(routineIntroduction(c).startsWith('- **Accepted:** '+summary));assert.ok(body(c).startsWith('- **Accepted:** '+summary));
 assert.ok(!body(c).includes('Review recommendation:'));assert.ok(!routineIntroduction(c).includes('qualifying launches'));
 assert.deepEqual(c,before);assert.ok(!body(c).includes('No corrections are requested'));
});
test('lists classify items rather than proposals, preserve shared links and label overlap without double counting',()=>{
 const c=fixture(),out=lists(body(c));
 assert.equal(Object.keys(out).length,4);
 assert.match(out['Submissions reviewed'],/Atlas launches a wallet/);
 assert.match(out['Submissions accepted (2 stories)'],/Council adopts staking rules.*correction still required/);
 assert.match(out['Submissions rejected (1 story)'],/Earlier wallet announcement/);
 assert.match(out['Submissions requiring changes (1 story)'],/Council adopts staking rules.*also accepted in review/);
 assert.ok(!out['Submissions requiring changes (1 story)'].includes('Earlier wallet'));
 assert.equal((out['Submissions accepted (2 stories)'].match(/https:\/\/example.org\/submission/g)??[]).length,2);
 assert.match(out['Submissions requiring changes (1 story)'],/do not add these counts together/);
 assert.match(out['Submissions accepted (2 stories)'],/Recommendations only/);
});
test('bespoke return-for-correction is not accepted; independently rejected work receives no repair request',()=>{
 const c=fixture();c.family='bespoke';c.kind='dataset';delete c.review.recipientSummary;
 for(const r of c.review.coverage)delete r.selection;
 c.review.coverage[2].outcome='does_not_meet_requirements';
 const g=recipientGroups(c);assert.deepEqual([g.accepted.length,g.rejected.length,g.changes.length],[1,1,1]);
 const out=lists(body(c));assert.match(out['Submissions requiring changes (1 item)'],/acceptance not yet recommended/);
 assert.match(reportDraft(c).markdown,/Accepted:\*\* 1 item recommended for acceptance: Atlas/);
});
test('all-accepted, all-rejected and zero-accepted correction cases retain explicit empty groups',()=>{
 for(const outcome of ['qualifies','does_not_qualify']){
  const c=fixture();for(const r of c.review.coverage){r.selection.outcome=outcome;r.outcome='meets_requirements';}
  const out=body(c);validateNotionReport(out);assert.equal((out.match(/\t- None\./g)??[]).length,2);
  assert.match(out,new RegExp('Accepted:\\*\\* '+(outcome==='qualifies'?3:0)+' stories recommended for acceptance'));
 }
 const c=fixture();c.family='bespoke';for(const r of c.review.coverage){delete r.selection;r.outcome='needs_correction';}
 assert.match(body(c),/Accepted:\*\* 0 stories recommended for acceptance/);
 assert.equal(recipientGroups(c).changes.length,3);
});
test('repair findings and coverage both identify eligible repairs without multiplying repeated issues',()=>{
 const c=fixture();c.review.coverage[0].outcome='meets_requirements';
 c.review.findings=[{itemId:id(1),repairEligible:true},{itemId:id(1),repairEligible:true},{itemId:id(3),repairEligible:false}];
 const g=recipientGroups(c);assert.equal(g.changes.length,2);assert.equal(g.accepted.length,2);assert.equal(g.rejected.length,1);
 assert.match(acceptanceSummary(c),/2 still need correction/);
});
test('long, multiline and formatting-heavy names keep accurate totals and safe complete linked inventories',()=>{
 const c=fixture();c.review.coverage=Array.from({length:12},(_,i)=>({...c.review.coverage[0],itemId:id(i+30),itemName:`Story ${i+1}: [wallet] | **launch** <new>\n`+'long descriptive title '.repeat(6)}));c.itemIds=c.review.coverage.map(r=>r.itemId);
 const text=body(c);assert.ok(text.split('\n')[0].length<300);assert.match(text,/12 stories recommended for acceptance/);assert.match(text,/and (10|11) more/);
 const accepted=lists(text)['Submissions accepted (12 stories)'];assert.equal((accepted.match(/\t- \[/g)??[]).length,12);assert.ok(accepted.includes('Story 12'));validateNotionReport(text);
});
test('missing multi-proposal item links fail instead of inventing item/proposal mapping; known names and captured links are used',()=>{
 const c=fixture();for(const r of c.review.coverage)delete r.itemUrl;
 assert.throws(()=>renderNotionReport(c,{},[url,url+'/other']),/Capture a submission link/);
 const items=Object.fromEntries(c.review.coverage.map(r=>[r.itemId,{name:r.itemName,proposalUrl:url+'/'+r.itemId}]));
 const text=renderNotionReport(c,{items},[url,url+'/other']).content;assert.ok(text.includes(url+'/'+id(2)));
});
test('duplicate or missing decisions, misleading list totals, lost toggles and missing overlap notes fail validation',()=>{
 const c=fixture(),text=body(c);
 for(const bad of [text.replace('Submissions accepted (2 stories)','Submissions accepted (3 stories)'),text.replace('Accepted:** 2','Accepted:** 9'),text.replace('<summary>Submissions requiring changes','<summary>Submissions accepted'),text.replace('do not add these counts together.','totals are additive.'),text+'\nExtra content'])assert.throws(()=>validateNotionReport(bad));
 c.review.coverage.push(c.review.coverage[0]);assert.throws(()=>recipientGroups(c),/exactly one/);
 c.review.coverage=[];assert.throws(()=>recipientGroups(c),/exactly one/);
});
test('presentation changes preserve identity, verified delivery and already-logged history with no migration',()=>{
 const c=fixture(),key=historyKey(c),contentHash=reviewContentHash(c),before=structuredClone(c);
 body(c);assert.equal(historyKey(c),key);assert.equal(reviewContentHash(c),contentHash);assert.deepEqual(c,before);
 assert.equal(prepareReportDraft(c,'local-preview.json').readyToPublish,false);
 c.curatorReviewLog=[{key,status:'verified',url:'https://example.org/history'}];
 assert.equal(prepareHistoryEntry(c,{}, {dataSourceId:id(99),databaseUrl:'https://example.org/history',lookupViewUrl:'view://12345678-1234-1234-1234-123456789abc'}).status,'already_logged');
});
