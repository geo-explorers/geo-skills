import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {emptyState,assemble,hash,replayEdits,submittedText,recordReview,reportDraft,prepareReportDraft,recordDecision,recordDelivery,caseEvidence,withLock,atomicJson,loadState} from '../scripts/review-core.mjs';
import {readBounty,readEntity,readEntities,proposalHistory} from '../scripts/review-client.mjs';
const id=n=>n.toString(16).padStart(32,'0');
const curator=id(1),bounty=id(2),entity=id(3),property=id(4),proposal=id(5);
const long='Full submitted statement. '.repeat(40);
const spec={id:bounty,name:'Fixture bounty',spaceId:id(8),complete:true,contentHash:hash('spec'),blocks:[{texts:[{text:'Require attributed relevant work'}]}]};
const config={spaces:{crypto:{bountyProfiles:{[bounty]:{family:'routine',kind:'x'}},assignments:{}}}};
function intake(p=proposal,e=entity,day='2026-10-01T12:00:00Z',tags=true,owner=curator){return {space:'crypto',runStatus:{state:'complete',complete:true,window:{until:day}},manifest:[{id:p,proposedBy:owner,curator:'Same display name',space:'main',createdAt:day,createdEpoch:Date.parse(day)/1000,bounties:tags?[{id:bounty}]:[],contentUris:['ipfs://'+p]}],rawEdits:{[p]:[{cid:p,edit:{ops:[{type:'updateEntity',id:e,set:[{property,value:{type:'text',value:long}}],unset:[]}]}}]},items:[{pid:p,id:e,kind:'Post'}],specs:{[bounty]:spec}};}
function review(c,patch={}){return {caseId:c.id,fingerprint:c.fingerprint,outcome:'needs_correction',checkedAt:'2026-10-03T10:00:00Z',coverage:c.itemIds.map(itemId=>({itemId,outcome:'needs_correction',evidence:['Captured submitted text']})),requirements:[{criterion:'Attribution',outcome:'needs_correction',evidence:['Full bounty block']}],findings:[{itemId:entity,original:long,originalRef:{proposalId:proposal,entityId:entity,propertyId:property},excerpt:'Full submitted statement.',issue:'Attribution missing',citations:[{url:'https://example.org/primary',locator:'Author field',retrievedAt:'2026-10-03T09:00:00Z'}],evidenceDetail:'Fixture primary record'}],...patch};}
test('lossless text, typed values and ordered deletion are retained',()=>{const s=emptyState();assemble(s,intake(),config);assert.equal(submittedText(s,{proposalId:proposal,entityId:entity,propertyId:property}),long);assert.equal(caseEvidence(s,Object.keys(s.cases)[0]).submittedProjection.entities[entity].values[property].value,long);
 const edit={cid:'a',edit:{ops:[{type:'updateEntity',id:entity,set:[{property,value:{type:'integer',value:'42'}}]},{type:'updateEntity',id:entity,unset:[property]},{type:'deleteEntity',id:entity}]}};const r=replayEdits([edit]);assert.equal(r.entities[entity].deleted,true);assert.deepEqual(r.entities[entity].values,{});assert.deepEqual(r.entities[entity].unset,[property]);});
test('multiple payload order and unknown operations require review',()=>{const a={cid:'a',edit:{ops:[]}},b={cid:'b',edit:{ops:[]}};assert.throws(()=>replayEdits([a,b]),/verified order/);assert.doesNotThrow(()=>replayEdits([a,b],['b','a']));assert.throws(()=>replayEdits([{cid:'a',edit:{ops:[{type:'mystery'}]}}]),/explicit handling/);});
test('same daily curator/bounty groups proposals; names do not merge identities; exact rerun stable',()=>{const s=emptyState();assemble(s,intake(),config);assemble(s,intake(id(6),id(7)),config);assert.equal(Object.keys(s.cases).length,1);const c=Object.values(s.cases)[0];assert.equal(c.proposalIds.length,2);const fp=c.fingerprint;assert.equal(assemble(s,intake(),config).changedCases.length,0);assert.equal(c.fingerprint,fp);assemble(s,intake(id(9),id(10),undefined,true,id(11)),config);assert.equal(Object.keys(s.cases).length,2);});
test('routine repair updates old case; mixed old and new items stay queued',()=>{const s=emptyState();assemble(s,intake(),config);assemble(s,intake(id(6),entity,'2026-10-02T12:00:00Z'),config);assert.equal(Object.keys(s.cases).length,1);const i=intake(id(7),entity,'2026-10-02T13:00:00Z');i.items.push({pid:id(7),id:id(8),kind:'Post'});i.rawEdits[id(7)][0].edit.ops.push({type:'updateEntity',id:id(8),set:[]});const r=assemble(s,i,config);assert.equal(r.identification[0].reason,'repair_and_new_items_require_partition');assert.equal(Object.keys(s.cases).length,1);});
test('bespoke deliverable spans days and both source spaces',()=>{const cfg=structuredClone(config);cfg.spaces.crypto.bountyProfiles[bounty]={family:'bespoke',singleDeliverable:true};const s=emptyState();assemble(s,intake(),cfg);const i=intake(id(6),id(7),'2026-10-02T12:00:00Z');i.manifest[0].space='datasets';assemble(s,i,cfg);const c=Object.values(s.cases)[0];assert.equal(Object.keys(s.cases).length,1);assert.equal(c.proposalIds.length,2);assert.notEqual(c.proposalRefs[proposal].spaceId,c.proposalRefs[id(6)].spaceId);});
test('unidentified and no-payload work survives later empty runs',()=>{const s=emptyState();const i=intake(undefined,undefined,undefined,false);assemble(s,i,config);const empty={...intake(),manifest:[],rawEdits:{},items:[]};assemble(s,empty,config);assert.equal(s.spaces.crypto.identification.length,1);assert.equal(s.proposals[proposal].snapshots.length,1);const no=intake(id(7));no.manifest[0].contentUris=[];assemble(s,no,config);assert.ok(s.proposals[id(7)]);assert.equal(s.spaces.crypto.identification.length,2);});
test('mixed bounties require disjoint explicit item assignments',()=>{const s=emptyState(),i=intake();i.manifest[0].bounties.push({id:id(22)});assert.equal(assemble(s,i,config).identification[0].reason,'mixed_bounty_requires_item_assignment');const cfg=structuredClone(config);cfg.spaces.crypto.assignments[proposal]=[{bountyId:bounty,itemIds:[entity]},{bountyId:bounty,itemIds:[entity]}];assert.throws(()=>assemble(emptyState(),i,cfg),/assigned twice/);});
test('incomplete retrieval and immutable mutation cannot commit successful state',()=>{const s=emptyState(),i=intake();i.runStatus.complete=false;assert.throws(()=>assemble(s,i,config),/complete run/);assert.equal(Object.keys(s.proposals).length,0);i.runStatus.complete=true;assemble(s,i,config);i.rawEdits[proposal][0].edit.ops[0].set[0].value.value='changed';assert.throws(()=>assemble(s,i,config),/Immutable/);});
test('reviews reject shortened originals, fabricated excerpts, stale inputs and omitted items',()=>{const s=emptyState();assemble(s,intake(),config);const c=Object.values(s.cases)[0],r=review(c);for(const bad of [{fingerprint:'stale'},{coverage:[]},{findings:[{...r.findings[0],original:long.slice(0,300)}]},{findings:[{...r.findings[0],excerpt:'Invented quotation'}]},{coverage:[{...r.coverage[0],outcome:'accept'}]}])assert.throws(()=>recordReview(s,{...r,...bad}));recordReview(s,r);const d=reportDraft(c);assert.ok(d.markdown.includes(long));assert.equal(d.targetSpaceId,'5908c73ad336472ccbd983491d2d17e4');assert.equal(d.pageId,reportDraft(c).pageId);});
test('missing fields require a criterion; unfinished research can remain unresolved',()=>{const s=emptyState();assemble(s,intake(),config);const c=Object.values(s.cases)[0],r=review(c);r.findings=[{...r.findings[0],originalRef:undefined,original:undefined,excerpt:'',missingField:true,missingRequirement:'An author relation'}];recordReview(s,r);assert.match(reportDraft(c).markdown,/Not supplied/);recordReview(s,{...r,outcome:'unresolved'});assert.equal(c.status,'review_unresolved');});
test('editor decisions, prior receipts and review revisions survive changed submissions',()=>{const s=emptyState();assemble(s,intake(),config);const c=Object.values(s.cases)[0];recordReview(s,review(c));c.delivery={status:'verified',reportId:id(99),receipt:{url:'https://example.org/report'}};const decision={id:'human-close-1',caseId:c.id,kind:'paid_and_closed',recordedAt:'2026-10-03T10:00:00Z',evidence:['Exact editor close-out receipt']};recordDecision(s,decision);recordDecision(s,decision);assert.equal(c.editorDecisions.length,1);assemble(s,intake(id(6),entity,'2026-10-02T12:00:00Z'),config);assert.equal(c.delivery.reportId,id(99));assert.ok(c.revisions[0].delivery.receipt);assert.equal(c.editorDecisions[0].kind,'paid_and_closed');assert.throws(()=>reportDraft(c),/No current/);});
test('exclusive lock and atomic state retain existing success on failed run',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-lock-test-'));const file=path.join(dir,'state.json');atomicJson(file,emptyState());await withLock(dir,async()=>{assert.throws(()=>withLock(dir,()=>{}),/lock exists/);});await assert.rejects(withLock(dir,async()=>{throw Error('failure')}));assert.equal(loadState(file).schemaVersion,1);assert.equal(fs.existsSync(path.join(dir,'.review.lock')),false);});
const fullEntity=(eid,patch={})=>({id:eid,name:'Bounty',spaceIds:[id(8)],types:[{id:id(9)}],values:{totalCount:0,nodes:[]},relations:{totalCount:0,nodes:[]},...patch});
test('full-field response validates counts, stubs and typed ownership',async()=>{await assert.rejects(readEntity(bounty,async()=>({entity:fullEntity(bounty,{values:{totalCount:2,nodes:[]}})})),/coverage/);await assert.rejects(readEntity(bounty,async()=>({entity:fullEntity(bounty,{spaceIds:[],types:[]})})),/stub/);const e=await readEntity(bounty,async()=>({entity:fullEntity(bounty,{values:{totalCount:1,nodes:[{spaceId:id(8),property:{id:property},integer:'42'}]}})}));assert.equal(e.values.nodes[0].integer,'42');});
test('bounty uses full ordered text blocks rather than summary and rejects partial blocks',async()=>{const request=async(q,v)=>({entity:v.id===bounty?fullEntity(bounty,{description:'Short summary',relations:{totalCount:2,nodes:[{id:id(10),position:'b',type:{name:'Blocks'},toEntity:{id:id(12)}},{id:id(11),position:'a',type:{name:'Blocks'},toEntity:{id:id(13)}}]}}):fullEntity(v.id,{values:{totalCount:1,nodes:[{spaceId:id(8),property:{name:'Markdown content'},text:v.id===id(13)?long:'Later block'}]}})});const s=await readBounty(bounty,request);assert.equal(s.blocks[0].texts[0].text,long);assert.equal(s.blocks[1].texts[0].text,'Later block');assert.equal(s.complete,true);});
test('cursor history detects stalled cursor and malformed lists',async()=>{await assert.rejects(proposalHistory(id(8),0,100,async()=>({proposalsConnection:{nodes:[],pageInfo:{hasNextPage:true,endCursor:null}}})),/advance/);await assert.rejects(proposalHistory(id(8),0,100,async()=>({})),/incomplete/);});

test('selected replay cannot certify a discovery checkpoint',()=>{const s=emptyState(),i=intake();i.runStatus.mode='selected_replay';assert.throws(()=>assemble(s,i,config),/explicit configuration/);assemble(s,i,{...config,allowSelectedReplay:true});assert.equal(s.spaces.crypto.discoveryCutoff,null);});
test('block ordering uses ASCII fractional-index order',async()=>{const req=async(q,v)=>({entity:v.id===bounty?fullEntity(bounty,{relations:{totalCount:2,nodes:[{id:id(10),position:'a',type:{name:'Blocks'},toEntity:{id:id(12)}},{id:id(11),position:'Z',type:{name:'Blocks'},toEntity:{id:id(13)}}]}}):fullEntity(v.id,{values:{totalCount:1,nodes:[{property:{name:'Markdown content'},text:v.id,spaceId:id(8)}]}})});assert.equal((await readBounty(bounty,req)).blocks[0].position,'Z');});
test('failed delivery keeps last verified receipt in delivery history',()=>{const s=emptyState();assemble(s,intake(),config);const c=Object.values(s.cases)[0];recordReview(s,review(c));recordDelivery(s,{caseId:c.id,fingerprint:c.fingerprint,status:'verified',reportId:id(40),receipt:{evidence:['Readback'],readbackAt:'2026-10-03T12:00:00Z',url:'https://example.org/report'}});recordDelivery(s,{caseId:c.id,fingerprint:c.fingerprint,status:'failed',receipt:{evidence:['HTTP failure']}});assert.equal(c.delivery.reportId,id(40));assert.equal(c.deliveryHistory.at(-1).status,'verified');});

test('GRC-20 createEntity.values preserves complete statements just like updateEntity.set',()=>{const s=emptyState(),i=intake();const o=i.rawEdits[proposal][0].edit.ops[0];o.type='createEntity';o.values=o.set;delete o.set;assemble(s,i,config);assert.equal(submittedText(s,{proposalId:proposal,entityId:entity,propertyId:property}),long);assert.equal(caseEvidence(s,Object.keys(s.cases)[0]).submittedProjection.entities[entity].values[property].value,long);});

test('batch metadata keeps failed/missing IDs distinct and preserves full fields',async()=>{const r=await readEntities([entity,bounty],async()=>({entities:[fullEntity(entity)]}));assert.ok(r.records[entity]);assert.match(r.errors[bounty],/incomplete/);});
test('forwardable draft excludes internal coverage while JSON retains it',()=>{const s=emptyState();assemble(s,intake(),config);const c=Object.values(s.cases)[0],r=review(c);r.coverage[0].note='PRIVATE COVERAGE NOTE';recordReview(s,r);const d=reportDraft(c);assert.equal(d.review.coverage[0].note,'PRIVATE COVERAGE NOTE');assert.equal(d.markdown.includes('PRIVATE COVERAGE NOTE'),false);});
test('scoped bounty retrieval refuses another space’s requirements',async()=>{const req=async(q,v)=>({entity:v.id===bounty?fullEntity(bounty,{relations:{totalCount:1,nodes:[{id:id(10),spaceId:id(20),position:'a',type:{name:'Blocks'},toEntity:{id:id(12)}}]}}):fullEntity(v.id,{values:{totalCount:1,nodes:[{property:{name:'Markdown content'},text:long,spaceId:id(20)}]}})});await assert.rejects(readBounty(bounty,req,true,[id(21)]),/requirements/);assert.equal((await readBounty(bounty,req,true,[id(20)])).spaceId,id(20));});

test('unchanged drafts preserve verified delivery; changes retain report identity and receipt history',()=>{
 const s=emptyState();assemble(s,intake(),config);const c=Object.values(s.cases)[0];recordReview(s,review(c));
 c.delivery.reportId=id(99);assert.equal(prepareReportDraft(c,'first.json').draft.pageId,id(99));
 const receipt={url:'https://example.org/report',readbackAt:'2026-10-03T12:00:00Z',evidence:['Readback']};
 recordDelivery(s,{caseId:c.id,fingerprint:c.fingerprint,status:'verified',reportId:id(99),receipt});
 assert.equal(prepareReportDraft(c,'second.json').changed,false);assert.equal(c.delivery.status,'verified');assert.deepEqual(c.delivery.receipt,receipt);
 c.review.findings[0].issue='Revised finding';assert.equal(prepareReportDraft(c,'third.json').changed,true);assert.equal(c.delivery.reportId,id(99));assert.equal(c.deliveryHistory.at(-1).status,'verified');
});

test('readable outcomes do not turn unfinished research or a recommendation into editor approval',()=>{
 const s=emptyState();assemble(s,intake(),config);const c=Object.values(s.cases)[0];
 for(const outcome of ['meets_requirements','needs_correction','does_not_meet_requirements','unresolved']){
  recordReview(s,review(c,{outcome,findings:[]}));const d=reportDraft(c);
  assert.equal(d.review.outcome,outcome);
  assert.equal(d.markdown.includes(d.title),false);
  assert.equal(d.markdown.includes('Agent assessment:'),false);
  assert.equal(d.markdown.includes('Evidence checked:'),false);
  assert.equal(/approved|paid|accepted/i.test(d.markdown),false);
  if(outcome==='unresolved'){assert.match(d.markdown,/still in progress/);assert.equal(d.markdown.includes('ready for you to address'),false);}
 }
});

test('historical multi-proposal case survives missing config/spec and does not regress to identification',()=>{
 const s=emptyState();assemble(s,intake(),config);assemble(s,intake(id(6),id(7)),config);const c=Object.values(s.cases)[0];recordReview(s,review(c));
 recordDecision(s,{id:'paid',caseId:c.id,kind:'paid',recordedAt:'2026-10-03',evidence:['receipt']});
 recordDelivery(s,{caseId:c.id,fingerprint:c.fingerprint,status:'verified',reportId:id(99),receipt:{url:'https://example.org/report',readbackAt:'2026-10-03',evidence:['verified']}});
 const before=structuredClone(c),i=intake();i.specs={};const cfg=structuredClone(config);cfg.spaces.crypto.bountyProfiles={};
 const result=assemble(s,i,cfg);assert.deepEqual(c,before);assert.deepEqual(result.changedCases,[]);assert.deepEqual(result.identification,[]);assert.equal(result.preservedCases[0],c.id);assert.equal(result.dependencyWarnings[0].reason,'saved_profile_retained');
});
test('changed bounty requirements retain historical review and request applicability check',()=>{
 const s=emptyState();assemble(s,intake(),config);const c=Object.values(s.cases)[0];recordReview(s,review(c));const before=structuredClone(c),i=intake();i.specs={[bounty]:{...spec,contentHash:hash('changed')}};
 const r=assemble(s,i,config);assert.deepEqual(c,before);assert.equal(r.dependencyWarnings[0].reason,'spec_changed_check_applicability');
});
test('complete scoped description-only bounty is valid but foreign/empty/partial content is not',async()=>{
 const description={spaceId:id(8),property:{name:'Description'},text:'Add events with dates and organizer.'};
 const e=fullEntity(bounty,{description:'Aggregate is not authoritative',values:{totalCount:1,nodes:[description]}});
 const a=await readBounty(bounty,async()=>({entity:e}),true,[id(8)]);assert.equal(a.format,'description_only');assert.equal(a.descriptionValues[0].text,description.text);assert.equal(a.complete,true);
 await assert.rejects(readBounty(bounty,async()=>({entity:e}),true,[id(20)]),/requirements/);
 await assert.rejects(readBounty(bounty,async()=>({entity:{...e,relations:{totalCount:1,nodes:[]}}}),true,[id(8)]),/coverage/);
 await assert.rejects(readBounty(bounty,async(q,v)=>({entity:v.id===bounty?{...e,relations:{totalCount:1,nodes:[{id:id(12),spaceId:id(8),type:{name:'Blocks'},toEntity:{id:id(13)}}]}}:fullEntity(v.id)}),true,[id(8)]),/requirements/);
});
test('legacy verified report survives renderer change; unknown write cannot become a new create draft',()=>{
 const s=emptyState();assemble(s,intake(),config);const c=Object.values(s.cases)[0];recordReview(s,review(c));
 c.delivery={status:'verified',fingerprint:c.fingerprint,reportId:id(99),draftFingerprint:'older-renderer',receipt:{url:'https://example.org/report',readbackAt:'2026-10-03',evidence:['readback']}};
 assert.equal(prepareReportDraft(c,'draft.json').changed,false);assert.equal(c.delivery.status,'verified');
 c.review.scoring={rate:10};c.review.checkedAt='2026-10-06T12:00:00Z';assert.equal(prepareReportDraft(c,'draft.json').changed,false);
 recordDelivery(s,{caseId:c.id,fingerprint:c.fingerprint,status:'unknown',reportId:id(99),receipt:{evidence:['Durable intent; outcome unknown']}});
 const before=structuredClone(c.delivery),result=prepareReportDraft(c,'retry.json');assert.equal(result.reconciliationNeeded,true);assert.equal(result.draft.publicationAction,'reconcile');assert.deepEqual(c.delivery,before);
 recordDelivery(s,{caseId:c.id,fingerprint:c.fingerprint,status:'verified',reportId:id(99),receipt:{url:'https://example.org/report',readbackAt:'2026-10-06',evidence:['Recovered existing write']}});
 assert.equal(prepareReportDraft(c,'retry.json').draft.publicationAction,'none');assert.equal(c.delivery.reportId,id(99));
});

test('identical review and refreshed citation checks do not reopen verified publication',()=>{
 const s=emptyState();assemble(s,intake(),config);const c=Object.values(s.cases)[0];recordReview(s,review(c));
 recordDelivery(s,{caseId:c.id,fingerprint:c.fingerprint,status:'verified',reportId:id(99),receipt:{url:'https://example.org/report',readbackAt:'2026-10-03',evidence:['verified']}});
 const r=review(c);r.findings[0].citations[0].retrievedAt='2026-10-06T12:00:00Z';recordReview(s,r);
 assert.equal(c.delivery.status,'verified');assert.equal(prepareReportDraft(c,'again.json').readyToPublish,false);
});
test('failed write requires explicit no-submission reconciliation before retry; new revision cannot bypass it',()=>{
 const s=emptyState();assemble(s,intake(),config);const c=Object.values(s.cases)[0];recordReview(s,review(c));const fp=c.fingerprint;
 recordDelivery(s,{caseId:c.id,fingerprint:fp,status:'unknown',reportId:id(99),receipt:{evidence:['Intent journal']}});
 assert.throws(()=>recordDelivery(s,{caseId:c.id,fingerprint:fp,status:'retryable',receipt:{evidence:['Try again']}}),/reconciled/);
 assemble(s,intake(id(6),entity,'2026-10-02T12:00:00Z'),config);assert.equal(c.delivery.status,'unknown');assert.throws(()=>recordReview(s,review(c)),/Reconcile/);
 recordDelivery(s,{caseId:c.id,fingerprint:fp,status:'retryable',receipt:{evidence:['Verified no broadcast'],outcome:'verified_not_submitted',reconciledAt:'2026-10-06T12:00:00Z'}});
 assert.equal(c.delivery.status,'update_draft_needed');recordReview(s,review(c));assert.equal(prepareReportDraft(c,'retry.json').readyToPublish,true);
});
test('blank or foreign block text cannot certify scoped requirements; short description changes alter hash',async()=>{
 const d={spaceId:id(8),property:{name:'Description'},text:'First requirement'};
 const make=text=>fullEntity(bounty,{description:'Unchanged aggregate',values:{totalCount:1,nodes:[{...d,text}]}});
 const a=await readBounty(bounty,async()=>({entity:make('First requirement')}),true,[id(8)]),b=await readBounty(bounty,async()=>({entity:make('Second requirement')}),true,[id(8)]);assert.notEqual(a.contentHash,b.contentHash);
 for(const [text,spaceId] of [['   ',id(8)],['Foreign requirements',id(20)]]){
  const req=async(q,v)=>({entity:v.id===bounty?fullEntity(bounty,{relations:{totalCount:1,nodes:[{id:id(10),spaceId:id(8),type:{name:'Blocks'},toEntity:{id:id(12)}}]}}):fullEntity(v.id,{values:{totalCount:1,nodes:[{spaceId,property:{name:'Markdown content'},text}]}})});
  await assert.rejects(readBounty(bounty,req,true,[id(8)]),/requirements/);
 }
});
