import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export const SPACES = {
  crypto:{main:'c9f267dcb0d270718c2a3c45a64afd32',datasets:'5908c73ad336472ccbd983491d2d17e4'},
  ai:{main:'41e851610e13a19441c4d980f2f2ce6b',datasets:'941964642f4d3e70ef48f54a3915277d'},
  health:{main:'52c7ae149838b6d47ce0f3b2a5974546',datasets:'44eb138f564fbed6ed9ce543de1b849c'},
  'world-affairs':{main:'89bd89bf28ff8a0963faf92a8c905e20',datasets:'da96a4c26e718bfa6c27c3b1f3c316cd'},
  'us-politics':{main:'4582fbbee28a16589154f7e36f1ee3c5',datasets:'1b3d2963d14de99d4e440000125edb65'}
};
export const normalizeId = s => { const v=String(s??'').replaceAll('-','').toLowerCase(); if(!/^[a-f0-9]{32}$/.test(v))throw Error('Expected a full Geo ID');return v; };
const canonical = v => Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const hash = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export const stableId = key => {const h=hash(key).slice(0,32);return h.slice(0,12)+'5'+h.slice(13,16)+'a'+h.slice(17);};
export function atomicJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}
export function withLock(dir,fn){
  fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'.review.lock');let fd;
  try{fd=fs.openSync(file,'wx',0o600);}catch{throw Error('Review lock exists; inspect its owner before retrying.');}
  fs.writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
  return Promise.resolve().then(fn).finally(()=>{fs.closeSync(fd);fs.unlinkSync(file);});
}
export const emptyState = () => ({schemaVersion:1,spaces:{},cases:{},proposals:{},history:[]});
export function loadState(file){if(!fs.existsSync(file))return emptyState();const s=JSON.parse(fs.readFileSync(file,'utf8'));if(s.schemaVersion!==1)throw Error('Unsupported state version');return s;}
export function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
export const lagosDay = value => new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));

// Preserve the full operation stream; a compact entity summary cannot replay a revision.
export function snapshotProposal(proposal,raw){
  if(!Array.isArray(raw)||!raw.length||raw.some(r=>r.err||!Array.isArray(r.edit?.ops)))throw Error('Missing lossless edit snapshot: '+proposal.id);
  const snapshots=raw.map(r=>({cid:r.cid,edit:r.edit}));
  return {proposal:{...proposal,id:normalizeId(proposal.id),proposedBy:normalizeId(proposal.proposedBy)},snapshots,ordering:snapshots.length===1?'single-edit':'requires-explicit-order',hash:hash(snapshots)};
}
export function replayEdits(snapshots,order=null){
  if(snapshots.length>1){if(!order||order.length!==snapshots.length||new Set(order).size!==order.length||snapshots.some(s=>!order.includes(s.cid)))throw Error('Multiple edit payloads require an explicit verified order');snapshots=[...snapshots].sort((a,b)=>order.indexOf(a.cid)-order.indexOf(b.cid));}
  const entities={},relations={};
  for(const s of snapshots)for(const op of s.edit.ops){
    if(['createEntity','updateEntity'].includes(op.type)){
      const id=normalizeId(op.id);const e=entities[id]??={id,deleted:false,values:{},unset:[]};
      e.deleted=false;
      for(const v of op.set??op.values??[])e.values[normalizeId(v.property??v.propertyId)]=v.value;
      for(const u of op.unset??[]){const p=normalizeId(typeof u==='string'?u:u.property??u.propertyId);delete e.values[p];e.unset.push(p);}
    }else if(op.type==='deleteEntity'){
      const id=normalizeId(op.id);entities[id]={...(entities[id]??{id,values:{},unset:[]}),deleted:true};
    }else if(op.type==='createRelation')relations[normalizeId(op.id)]={...op,deleted:false};
    else if(op.type==='deleteRelation'){const id=normalizeId(op.id);relations[id]={...(relations[id]??{id}),deleted:true};}
    else throw Error('Operation requires explicit handling: '+op.type);
  }
  return {entities,relations};
}
export function submittedText(state,ref){
  const record=state.proposals[normalizeId(ref.proposalId)];if(!record)throw Error('Original reference is outside the captured proposals');
  const matches=[];
  for(const s of record.snapshots){if(ref.cid&&ref.cid!==s.cid)continue;
    for(const [i,op] of s.edit.ops.entries()){if(ref.opIndex!==undefined&&ref.opIndex!==i)continue;
      if(!['createEntity','updateEntity'].includes(op.type)||normalizeId(op.id)!==normalizeId(ref.entityId))continue;
      for(const v of op.set??op.values??[])if(normalizeId(v.property??v.propertyId)===normalizeId(ref.propertyId)){
        const text=typeof v.value==='string'?v.value:v.value?.value;
        if(typeof text==='string')matches.push(text);
      }
    }
  }
  if(matches.length!==1)throw Error('Original reference must identify exactly one submitted text value; use cid/opIndex');
  return matches[0];
}

function comparableSpecHash(spec){
  // Legacy short-bounty adapters used a different serialization. Compare their
  // captured scoped requirement values, not adapter-specific hash formats.
  if(spec?.complete&&spec.blocks?.length===0){
    const values=spec.descriptionValues??spec.entity?.values?.nodes?.filter(v=>(v.property?.id==='9b1f76ff9711404c861e59dc3fa7d037'||v.property?.name==='Description')&&v.spaceId===spec.spaceId&&v.text?.trim());
    if(values?.length)return hash({name:spec.name,spaceId:spec.spaceId,descriptions:values.map(v=>({spaceId:v.spaceId,text:v.text})),links:spec.linkedCriteriaCandidates??[]});
  }
  return spec?.contentHash;
}
const OUTCOMES=new Set(['meets_requirements','needs_correction','does_not_meet_requirements','unresolved']);
const KINDS=new Set(['news','x','blog','fact-check','organize-claims']);
function eligibleIds(items,kind){const names={news:['News story','News'],x:['Post','Tweet'],blog:['Blog post'], 'fact-check':['Claim'],'organize-claims':['Claim']};return [...new Set(items.filter(i=>names[kind]?.includes(i.kind)).map(i=>normalizeId(i.id)))];}
export function assemble(state,intake,config){
  const {space,manifest,rawEdits,specs,items=[],runStatus}=intake;
  if(!SPACES[space]||runStatus?.state!=='complete'||runStatus?.complete!==true)throw Error('Intake must have a complete run receipt');
  if(runStatus.mode==='selected_replay'&&config.allowSelectedReplay!==true)throw Error('Selected replay requires explicit configuration; it cannot certify discovery coverage');
  const scope=config.spaces?.[space];if(!scope)throw Error('Space configuration missing');
  const partition=(p)=>{
    const explicit=scope.assignments?.[p.id];
    if(explicit)return explicit;
    if(p.bounties.length!==1)return null;
    return [{bountyId:p.bounties[0].id}];
  };
  const preservedCases=new Set(),dependencyWarnings=[],newCases=new Set(),changedCases=new Set(),identification=[...(state.spaces[space]?.identification??[])].filter(r=>!manifest.some(p=>normalizeId(p.id)===r.proposalId));
  const sorted=[...manifest].sort((a,b)=>a.createdEpoch-b.createdEpoch||a.id.localeCompare(b.id));
  for(const p0 of sorted){
    const p={...p0,id:normalizeId(p0.id),proposedBy:normalizeId(p0.proposedBy)};
    const disposition=scope.dispositions?.[p.id];
    if(disposition&&!disposition.evidence?.length)throw Error('Non-bounty disposition requires evidence');
    if(!p.contentUris?.length){state.proposals[p.id]={...(state.proposals[p.id]??{}),proposal:p,items:items.filter(i=>i.pid===p.id),snapshots:[],hash:hash(p.actions??[])};identification.push({proposalId:p.id,reason:'no_edit_payload',actions:p.actions??[]});continue;}
    const record=snapshotProposal(p,rawEdits[p.id]);
    const previous=state.proposals[p.id];
    if(previous&&previous.hash!==record.hash)throw Error('Immutable proposal payload changed; reconcile before overwriting '+p.id);
    state.proposals[p.id]={...previous,...record,items:items.filter(i=>i.pid===p.id)};
    const seed=config.reviewHistory?.[p.id];
    if(seed){if(!seed.evidence?.length)throw Error('History seed requires exact-proposal evidence');state.proposals[p.id].priorReview=seed;}
    if(disposition){state.proposals[p.id].disposition=disposition;continue;}
    const known=Object.values(state.cases).filter(c=>c.space===space&&c.proposalIds.includes(p.id));
    if(previous&&previous.hash===record.hash&&known.length){
      if(known.some(c=>c.curatorId!==p.proposedBy))throw Error('Captured proposal creator changed; reconcile '+p.id);
      for(const c of known){
        preservedCases.add(c.id);
        // Existing membership remains evidence. Dependency failure is not new ambiguity.
        if(!scope.bountyProfiles?.[c.bountyId]||!specs[c.bountyId]?.complete)
          dependencyWarnings.push({caseId:c.id,proposalId:p.id,bountyId:c.bountyId,reason:!scope.bountyProfiles?.[c.bountyId]?'saved_profile_retained':'spec_fetch_failed_history_retained'});
        else if(comparableSpecHash(specs[c.bountyId])!==comparableSpecHash(c.spec))
          dependencyWarnings.push({caseId:c.id,bountyId:c.bountyId,reason:'spec_changed_check_applicability',previousHash:c.spec?.contentHash,currentHash:specs[c.bountyId].contentHash});
      }
      continue;
    }
    let partitionRows=partition(p);
    if(!partitionRows?.length){identification.push({proposalId:p.id,reason:p.bounties.length?'mixed_bounty_requires_item_assignment':'bounty_unidentified'});continue;}
    if(p.bounties.length>1&&!partitionRows.every(r=>r.itemIds?.length)){identification.push({proposalId:p.id,reason:'mixed_bounty_requires_item_assignment'});continue;}
    const assigned=new Set();
    for(const row of partitionRows){
      const bountyId=normalizeId(row.bountyId),profile=scope.bountyProfiles?.[bountyId],spec=specs[bountyId];
      if(!profile||!spec?.complete){identification.push({proposalId:p.id,bountyId,reason:!profile?'bounty_profile_needed':'full_bounty_spec_unavailable'});continue;}
      if(!['bespoke','routine'].includes(profile.family)||profile.family==='routine'&&!KINDS.has(profile.kind))throw Error('Invalid bounty profile');
      let replay;
      try{replay=replayEdits(record.snapshots,scope.editOrder?.[p.id]);}
      catch(error){identification.push({proposalId:p.id,bountyId,reason:'operation_or_order_needs_review',detail:error.message});continue;}
      const touched=new Set([...Object.keys(replay.entities),...Object.values(replay.relations).filter(r=>r.from).map(r=>normalizeId(r.from))]);
      const relevant=row.itemIds?.map(normalizeId)??(profile.family==='routine'?eligibleIds(items.filter(i=>i.pid===p.id),profile.kind):Object.keys(replay.entities));
      if(relevant.some(id=>!touched.has(id)))throw Error('Assigned item is not touched by the submitted edit');
      if(!p.bounties.some(b=>normalizeId(b.id)===bountyId)&&!row.evidence)throw Error('Untagged bounty assignment requires recorded evidence');
      if(!relevant.length){identification.push({proposalId:p.id,bountyId,reason:'item_scope_needed'});continue;}
      for(const id of relevant){if(assigned.has(id))throw Error('Same item assigned twice within proposal '+p.id);assigned.add(id);}
      let suffix=row.caseKey;
      if(!suffix&&profile.family==='bespoke'&&profile.singleDeliverable===true)suffix='deliverable';
      if(!suffix&&profile.family==='routine')suffix=lagosDay(p.createdAt);
      if(!suffix){identification.push({proposalId:p.id,bountyId,reason:'distinct_deliverable_key_needed'});continue;}
      // Repairs of an existing routine item update its case, even on a later day.
      const owners=profile.family==='routine'?Object.values(state.cases).filter(c=>c.space===space&&c.curatorId===p.proposedBy&&c.bountyId===bountyId&&relevant.some(id=>c.itemIds.includes(id))):[];
      if(!row.caseKey&&owners.length){
        if(owners.length!==1||!relevant.every(id=>owners[0].itemIds.includes(id))){identification.push({proposalId:p.id,bountyId,reason:'repair_and_new_items_require_partition'});continue;}
        suffix=owners[0].caseKey;
      }
      const key=[space,p.proposedBy,bountyId,suffix].join(':'),id=stableId('submission-case:'+key);
      const old=state.cases[id];
      const next=old??{id,key,caseKey:suffix,space,curatorId:p.proposedBy,curatorName:p.curator,bountyId,bountyName:spec.name,family:profile.family,kind:profile.kind??'bespoke',proposalIds:[],itemIds:[],revisions:[],editorDecisions:[],delivery:{status:'not_prepared'}};
      if(!old)newCases.add(id);
      next.proposalIds=[...new Set([...next.proposalIds,p.id])];next.proposalRefs={...(next.proposalRefs??{}),[p.id]:{spaceId:p.spaceId??(p.space==='main'?SPACES[space].main:SPACES[space].datasets),createdAt:p.createdAt}};next.itemIds=[...new Set([...next.itemIds,...relevant])];
      next.spec=spec;next.profile=profile;next.editOrders={...(next.editOrders??{}),[p.id]:scope.editOrder?.[p.id]??null};
      if(seed)next.historySeeds={...(next.historySeeds??{}),[p.id]:seed};
      const fp=hash({proposals:next.proposalIds.map(pid=>[pid,state.proposals[pid].hash]),items:next.itemIds,spec:spec.contentHash,profile});
      if(next.fingerprint!==fp){if(next.fingerprint)next.revisions.push({fingerprint:next.fingerprint,review:next.review??null,delivery:next.delivery});next.fingerprint=fp;
        next.status=next.proposalIds.every(pid=>state.proposals[pid].priorReview)?'prior_review_recorded':'needs_review';
        if(!['submitted','unknown','failed'].includes(next.delivery?.status))next.delivery={...next.delivery,status:next.delivery.reportId?'update_draft_needed':'not_prepared'};changedCases.add(id);}
      state.cases[id]=next;
    }
  }
  state.spaces[space]={...(state.spaces[space]??{}),discoveryCutoff:runStatus.mode==='selected_replay'?state.spaces[space]?.discoveryCutoff??null:runStatus.window.until,identification,latestIntake:config.intakePath??null};
  return {newCases:[...newCases],changedCases:[...changedCases],preservedCases:[...preservedCases],dependencyWarnings:[...new Map(dependencyWarnings.map(w=>[JSON.stringify(w),w])).values()],identification,pendingCases:Object.values(state.cases).filter(c=>c.space===space&&['needs_review','review_unresolved'].includes(c.status)).map(c=>c.id)};
}

export function recordReview(state,review){
  const c=state.cases[review.caseId];if(!c)throw Error('Unknown case');
  if(review.fingerprint!==c.fingerprint)throw Error('Review is stale for the current case');
  if(!OUTCOMES.has(review.outcome))throw Error('Invalid review outcome');
  if(!review.coverage?.length||!review.requirements?.length||!review.checkedAt)throw Error('Review must document item coverage, requirements and evidence cutoff');
  if(c.itemIds.some(id=>!review.coverage.some(r=>r.itemId===id)))throw Error('Review omits an item in the agreed case scope');
  if(new Set(review.coverage.map(r=>r.itemId)).size!==review.coverage.length||review.coverage.some(r=>!c.itemIds.includes(r.itemId)))throw Error('Coverage must contain each scoped item once');
  if(!Number.isFinite(Date.parse(review.checkedAt)))throw Error('Invalid evidence cutoff');
  for(const r of [...review.coverage,...review.requirements])if(!OUTCOMES.has(r.outcome)||!r.evidence?.length)throw Error('Each item/requirement needs an assessment and evidence or a concrete gap');
  for(const row of review.coverage)if(row.selection&&(!['qualifies','does_not_qualify','unresolved'].includes(row.selection.outcome)||!row.selection.evidence?.length))throw Error('Selection needs a supported independent item assessment');
  if(review.scoring){
    if(!Number.isFinite(review.scoring.rate)||review.scoring.rate<0||!review.scoring.ruleSource)throw Error('Scoring rate needs applicable rule provenance');
    for(const cap of [review.scoring.weekly,review.scoring.monthly].filter(Boolean)){
      if(!Number.isFinite(cap.limit)||cap.limit<0)throw Error('Invalid points cap');
      if(cap.priorPoints!==null&&cap.priorPoints!==undefined&&(!Number.isFinite(cap.priorPoints)||cap.priorPoints<0||!cap.period||!cap.evidence?.length))throw Error('Known cap usage needs a period and ledger evidence');
    }
  }
  const findings=review.findings??[];
  if(review.recipientSummary){
    for(const key of ['acceptance','rejection','feedback'])if(typeof review.recipientSummary[key]!=='string'||!review.recipientSummary[key].trim()||/[\r\n]/.test(review.recipientSummary[key]))throw Error('Recipient summary needs three nonempty, single-paragraph fields: acceptance, rejection and feedback');
  }
  // Legacy reviews stay readable; newly authored reviews use the category contract.
  if(review.feedbackPolicy==='error_types_v1'){
    const kinds=review.verifiedErrorKinds;
    if(!Array.isArray(kinds)||kinds.some(k=>typeof k!=='string'||!k.trim())||new Set(kinds).size!==kinds.length)throw Error('List each verified error type once');
    if(findings.length!==kinds.length||new Set(findings.map(f=>f.errorKind)).size!==findings.length||kinds.some(k=>!findings.some(f=>f.errorKind===k)))throw Error('Feedback must cover every verified error type, with one example per type');
    for(const f of findings){
      if(!f.processQuestion?.trim()||!f.prevention?.trim()||typeof f.repairEligible!=='boolean')throw Error('Each error type needs a neutral process question, prevention step and explicit repair eligibility');
      if(f.repairEligible&&!f.repairRequest?.trim())throw Error('Eligible repairs need a specific correction request');
      if(!f.repairEligible&&f.repairRequest?.trim())throw Error('Do not request futile repairs to independently ineligible work');
    }
  }else if(review.feedbackPolicy)throw Error('Unknown feedback policy');
  for(const f of findings){
    if(!f.issue||!f.citations?.length||!f.evidenceDetail||!f.itemId||!c.itemIds.includes(f.itemId))throw Error('Incomplete finding or item outside case');
    if(f.originalRef){if(!c.proposalIds.includes(f.originalRef.proposalId))throw Error('Original text comes from another case');if(submittedText(state,f.originalRef)!==f.original)throw Error('Original text is not verbatim');if(!f.excerpt||!f.original.includes(f.excerpt))throw Error('Disputed excerpt is not verbatim');}
    else if(f.missingField!==true||!f.missingRequirement||f.excerpt)throw Error('Missing-field findings need an explicit requirement and no invented excerpt');
    for(const citation of f.citations)if(!/^https:\/\//.test(citation.url)||!citation.locator||!Number.isFinite(Date.parse(citation.retrievedAt)))throw Error('Evidence link needs URL, locator and retrieval time');
  }
  const sameContent=c.review?.fingerprint===review.fingerprint&&reviewContentHash(c)===reviewContentHash({...c,review:{...review,findings}});
  if(!sameContent&&['submitted','unknown','failed'].includes(c.delivery?.status))throw Error('Reconcile pending delivery before replacing its review');
  if(c.review)c.reviewHistory=[...(c.reviewHistory??[]),c.review];
  c.review={...review,findings,agentAssessment:true};c.status=reviewReadiness(c).complete?'reviewed':'review_unresolved';
  if(!sameContent){if(c.delivery?.receipt)c.deliveryHistory=[...(c.deliveryHistory??[]),structuredClone(c.delivery)];c.delivery={...c.delivery,status:'draft_ready'};}
  return c;
}

const esc = s => String(s??'').replaceAll('|','\\|').replaceAll('\n','<br>');
export function findingIssue(f){
  return [f.issue,f.processQuestion,f.repairRequest,f.prevention].filter(Boolean).join('\n\n');
}
function recipientAssessment(review){
  const assessment={
    meets_requirements:'The submission meets the requirements checked in this review.',
    needs_correction:'Please address the issues below before the submission is reviewed again.',
    does_not_meet_requirements:'The submission does not meet the bounty requirements checked in this review.',
    unresolved:'This review is still in progress.'
  }[review.outcome];
  const detail=review.outcome==='unresolved'&&review.findings.length?' The findings below are ready for you to address.':'';
  return assessment+detail;
}
const recipientDate = timestamp => new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(timestamp));
export const usesRoutineIntroduction = c => c.family==='routine'&&['news','x','blog'].includes(c.kind)&&new Set(c.itemIds??[]).size>1;
// Presentation-only groups: never mutate the recorded review or its identity.
export function recipientGroups(c){
  const groups={accepted:[],rejected:[],changes:[]};
  const coverage=c.review?.coverage??[],ids=[...new Set(c.itemIds??coverage.map(r=>r.itemId))];
  if(coverage.length!==ids.length||new Set(coverage.map(r=>r.itemId)).size!==coverage.length||coverage.some(r=>!ids.includes(r.itemId)))throw Error('Recipient classifications need exactly one assessment per scoped item');
  for(const itemId of ids){
    const row=coverage.find(r=>r.itemId===itemId),selection=row.selection?.outcome;
    const accepted=selection?selection==='qualifies':row.outcome==='meets_requirements';
    const repairEligible=(c.review.findings??[]).some(f=>f.itemId===itemId&&f.repairEligible===true);
    // A recorded correction return can fail today's selection without being an
    // independent rejection. Never promote it to accepted before the repair.
    const correctionReturn=row.outcome==='needs_correction'&&repairEligible;
    const rejected=(selection?selection==='does_not_qualify':row.outcome==='does_not_meet_requirements')&&!correctionReturn;
    const repairs=!rejected&&(row.outcome==='needs_correction'||repairEligible);
    if(!accepted&&!rejected&&!repairs)throw Error('Recipient item decision still needs investigation');
    const item={...row,accepted,rejected,repairs};
    if(accepted)groups.accepted.push(item);
    if(rejected)groups.rejected.push(item);
    if(repairs)groups.changes.push(item);
  }
  return groups;
}
export function acceptanceSummary(c,items={}){
  const groups=recipientGroups(c),rows=groups.accepted,n=rows.length;
  const unit=c.kind==='news'?(n===1?'story':'stories'):(n===1?'item':'items');
  if(!n)return `0 ${unit} recommended for acceptance.`;
  const short=value=>String(value).replace(/\s+/g,' ').replaceAll('<','‹').replaceAll('>','›').trim();
  const names=rows.map(r=>short(r.recipientName??items[r.itemId]?.recipientName??items[r.itemId]?.name??r.itemName??r.itemId));
  const repairs=rows.filter(r=>r.repairs).length,suffix=repairs?` ${repairs} still ${repairs===1?'needs':'need'} correction.`:'';
  const prefix=`${n} ${unit} recommended for acceptance: `;
  // The accurate total never changes when a long batch needs a short preview.
  let shown=names.slice(0,3).map(name=>name.length>65?name.slice(0,62).trimEnd()+'…':name);
  const rundown=()=>prefix+shown.join('; ')+(n>shown.length?`; and ${n-shown.length} more.`:'.')+suffix;
  while(shown.length>1&&rundown().length>200)shown.pop();
  return rundown();
}
export function routineIntroduction(c){
  const summary=c.review.recipientSummary;
  let acceptance,rejection,feedback;
  if(summary){({rejection,feedback}=summary);}
  else{
    const coverage=c.review.coverage??[],passing=coverage.filter(r=>r.selection?.outcome==='qualifies'),failing=coverage.filter(r=>r.selection?.outcome==='does_not_qualify');
    const names=rows=>rows.every(r=>r.recipientName||r.itemName)?rows.map(r=>String(r.recipientName??r.itemName).replace(/\s+/g,' ').trim()).join(', '):null;
    const rejected=names(failing),decisions=c.editorDecisions??[];
    const passedVotes=passing.length&&passing.every(r=>decisions.some(d=>d.kind==='vote'&&d.status==='verified'&&d.fingerprint===c.fingerprint&&d.itemId===r.itemId&&d.vote==='YES'));
    const published=passedVotes&&passing.every(r=>decisions.some(d=>d.kind==='vote'&&d.status==='verified'&&d.fingerprint===c.fingerprint&&d.itemId===r.itemId&&d.vote==='YES'&&d.executed===true));
    const rejectedVotes=failing.length&&failing.every(r=>decisions.some(d=>d.kind==='vote'&&d.status==='verified'&&d.fingerprint===c.fingerprint&&d.itemId===r.itemId&&d.vote==='NO'));
    // Keep verified governance stages separate from the acceptance recommendation.
    acceptance=acceptanceSummary(c)+(published?' Confirmed published.':passedVotes?' YES votes recorded; publication is pending.':'');
    rejection=failing.length?(rejectedVotes?'NO votes recorded: ':'Recommended for rejection: ')+(rejected??'the selections that did not meet the requirements')+'. See the findings for the reasons.':'None failed the selection review.';
    const findings=c.review.findings??[],repairs=findings.some(f=>f.repairEligible===true);
    feedback=!reviewReadiness(c).complete?'This review is still in progress.':findings.length?'Please check your work against the bounty requirements and the checks explained in the findings. Could you explain how these issues slipped through your checks? '+(repairs?'Please correct the eligible content issues, check for similar errors throughout this submission, and strengthen your checks to prevent these issues in future work.':'Please strengthen the checks described in the findings for future submissions; no repair is requested for independently rejected work.')+' Open each finding for details.':'No issues requiring correction were found in the reviewed scope.';
  }
  acceptance??=acceptanceSummary(c);
  for(const text of [acceptance,rejection,feedback])if(typeof text!=='string'||!text.trim()||/[\r\n]/.test(text))throw Error('Routine introduction needs exactly three single-paragraph bullets');
  return `- **Accepted:** ${acceptance.trim()}\n- **Rejection:** ${rejection.trim()}\n- **Feedback:** ${feedback.trim()}\n`;
}
// Decision completeness, separate from exhaustive audits and payment-ledger reconciliation.
export function reviewReadiness(c){
  const review=c.review,blockers=[];
  if(!review||review.fingerprint!==c.fingerprint)blockers.push({reason:'No current recorded review'});
  if(!review||!['meets_requirements','needs_correction','does_not_meet_requirements'].includes(review.outcome))blockers.push({reason:'Submission decision still needs investigation'});
  const ids=[...new Set(c.itemIds??review?.coverage?.map(r=>r.itemId)??[])];
  if(!ids.length)blockers.push({reason:'Scoped item decisions are missing'});
  const independent=c.family==='routine'&&['news','x','blog'].includes(c.kind)&&ids.length>1;
  for(const itemId of ids){
    const row=review?.coverage?.find(r=>r.itemId===itemId);
    const resolved=independent?['qualifies','does_not_qualify'].includes(row?.selection?.outcome)&&row.selection.evidence?.length:row?.selection?['qualifies','does_not_qualify'].includes(row.selection.outcome)&&row.selection.evidence?.length:['meets_requirements','needs_correction','does_not_meet_requirements'].includes(row?.outcome)&&row.evidence?.length;
    if(!resolved)blockers.push({itemId,reason:'Item decision still needs investigation'});
  }
  for(const gap of review?.decisionGaps??[])blockers.push({reason:String(gap)});
  return {complete:blockers.length===0,blockers};
}
export function reportDraft(c){
  if(!c.review||c.review.fingerprint!==c.fingerprint)throw Error('No current recorded review');
  const title=c.curatorName+' — '+c.bountyName+' — submission review · '+c.caseKey;
  const proposalLinks=c.proposalIds.map(id=>`- [Proposal ${id.slice(0,8)}](https://www.geobrowser.io/space/${c.proposalRefs[id].spaceId}/governance?proposalId=${id})`);
  const rows=c.review.findings.map(f=>[f.itemUrl??f.itemId,f.originalRef?f.original:'Not supplied — '+f.missingRequirement,f.excerpt||'Not applicable — missing field',findingIssue(f),f.citations.map(x=>`[${x.locator}](${x.url})`).join('<br>'),f.evidenceDetail]);
  const table=rows.length?'| Entity | Full original statement | Exact excerpt under review | Issue | Citations for quality checks | Relevant quote or evidence detail |\n|---|---|---|---|---|---|\n'+rows.map(r=>'| '+r.map(esc).join(' | ')+' |').join('\n'):'No supported actionable issue was established in the recorded scope.';
  const routine=usesRoutineIntroduction(c),introduction=routine?routineIntroduction(c):undefined;
  return {schemaVersion:1,caseId:c.id,fingerprint:c.fingerprint,targetSpaceId:SPACES[c.space].datasets,pageId:c.delivery?.reportId??stableId('submission-report:'+c.id),title,publicationStatus:'draft_only',reviewScope:{itemIds:c.itemIds,kind:c.kind,family:c.family},readiness:reviewReadiness(c),review:c.review,
    introductionLayout:routine?'routine-three-bullets-v1':undefined,introduction,reviewDate:recipientDate(c.review.checkedAt),
    markdown:routine?introduction+(rows.length?'\n## Review feedback\n\n'+table+'\n':''):`Bounty: [${c.bountyName}](https://www.geobrowser.io/space/${c.spec.spaceId}/${c.bountyId})\n\n**Accepted:** ${acceptanceSummary(c)}\n\n${recipientAssessment(c.review)}\n\nLast reviewed: ${recipientDate(c.review.checkedAt)}.\n\n## Proposals reviewed\n\n${proposalLinks.join('\n')}\n\n## Review feedback\n\n${table}\n`,
    findings:rows,editorDecisions:c.editorDecisions};
}

export function recordDecision(state,decision){
  const c=state.cases[decision.caseId];if(!c)throw Error('Unknown case');
  if(!decision.id||!decision.evidence?.length||!decision.recordedAt||!decision.kind)throw Error('Editor decision needs stable ID, kind, date and explicit authorization evidence');
  const old=c.editorDecisions.find(d=>d.id===decision.id);if(old&&hash(old)!==hash(decision))throw Error('Existing decision differs; add a superseding decision instead');
  if(!old)c.editorDecisions.push(decision);return c;
}
export function caseEvidence(state,caseId){
  const c=state.cases[caseId];if(!c)throw Error('Unknown case');
  const records=c.proposalIds.map(id=>state.proposals[id]).sort((a,b)=>a.proposal.createdEpoch-b.proposal.createdEpoch||a.proposal.id.localeCompare(b.proposal.id));
  const snapshots=records.flatMap(r=>(r.snapshots.length>1?replayOrder(r,c):r.snapshots).map((s,i)=>({...s,cid:r.proposal.id+':'+i+':'+s.cid})));
  return {case:c,proposals:records,submittedProjection:replayEdits(snapshots,snapshots.map(s=>s.cid)),projectionLimit:'Submitted operations only; unchanged fields require a separately captured baseline. Current graph state is not the historical baseline.'};
}
function replayOrder(r,c){const order=c.editOrders?.[r.proposal.id];replayEdits(r.snapshots,order);return [...r.snapshots].sort((a,b)=>order.indexOf(a.cid)-order.indexOf(b.cid));}

export function recordDelivery(state,delivery){
  const c=state.cases[delivery.caseId];if(!c)throw Error('Unknown case');
  const priorPending=delivery.fingerprint!==c.fingerprint&&['submitted','unknown','failed'].includes(c.delivery?.status)&&delivery.fingerprint===c.delivery.fingerprint;
  if(delivery.fingerprint!==c.fingerprint&&!priorPending)throw Error('Delivery does not match current or pending report revision');
  if(!['submitted','verified','failed','unknown','retryable'].includes(delivery.status)||!delivery.receipt?.evidence?.length)throw Error('Delivery needs status and explicit receipt evidence');
  if(delivery.status==='verified'&&(!delivery.reportId||!delivery.receipt.readbackAt||!delivery.receipt.url))throw Error('Verified delivery requires report ID and successful readback');
  if(delivery.status==='retryable'&&(!['submitted','failed','unknown'].includes(c.delivery?.status)||delivery.receipt.outcome!=='verified_not_submitted'||!Number.isFinite(Date.parse(delivery.receipt.reconciledAt))))throw Error('Retry requires a reconciled receipt proving no write was submitted');
  c.deliveryHistory=[...(c.deliveryHistory??[]),c.delivery];
  c.delivery={...c.delivery,...delivery,status:delivery.status==='retryable'?'draft_ready':delivery.status,reviewContentHash:priorPending?c.delivery.reviewContentHash:reviewContentHash(c)};
  if(priorPending&&['verified','retryable'].includes(delivery.status)){c.deliveryHistory.push(structuredClone(c.delivery));c.delivery.status='update_draft_needed';}
  return c;
}

// Renderer changes, evidence-check timestamps and private scoring do not constitute
// a new recipient review. Track the actual findings/outcome and submission scope.
export function reviewContentHash(c){
  return hash({fingerprint:c.fingerprint,curatorName:c.curatorName,bountyName:c.bountyName,proposalIds:c.proposalIds,itemIds:c.itemIds,outcome:c.review?.outcome,findings:c.review?.findings?.map(f=>({...f,citations:f.citations?.map(({retrievedAt,...citation})=>citation)})),...(c.review?.recipientSummary?{recipientSummary:c.review.recipientSummary}:{})});
}
export function prepareReportDraft(c,draftFile){
  if(!reviewReadiness(c).complete)throw Error('Final report needs investigation before draft preparation');
  const draft=reportDraft(c), fingerprint=hash(draft), contentHash=reviewContentHash(c);
  const pending=['submitted','unknown','failed'].includes(c.delivery?.status);
  if(pending)return {draft:{...draft,publicationAction:'reconcile'},changed:false,reconciliationNeeded:true};
  // Migrate legacy verified receipts without rebuilding historical pages. A receipt
  // for this exact case fingerprint anchors the recorded review; keep its history.
  if(!c.delivery?.reviewContentHash&&c.delivery?.status==='verified'&&c.delivery.fingerprint===c.fingerprint)
    c.delivery.reviewContentHash=contentHash;
  const changed=c.delivery?.reviewContentHash!==contentHash;
  if(changed){
    if(c.delivery?.receipt)c.deliveryHistory=[...(c.deliveryHistory??[]),structuredClone(c.delivery)];
    c.delivery={...c.delivery,status:'draft_ready',draftFingerprint:fingerprint,reviewContentHash:contentHash,draftFile};
  }else c.delivery={...c.delivery,draftFile};
  const readyToPublish=changed||c.delivery?.status==='draft_ready';
  return {draft:{...draft,publicationAction:readyToPublish?(c.delivery.reportId?'update':'create'):'none'},changed,readyToPublish};
}

// Internal scoring tally. Recipient acceptance counts use recipientGroups instead.
export function editorSummary(c){
  if(c.family!=='routine'||!['news','x','blog'].includes(c.kind)||new Set(c.itemIds).size<2)return null;
  if(!c.review||c.review.fingerprint!==c.fingerprint)throw Error('No current recorded review');
  const groups={accepted:[],rejected:[],unresolved:[]};
  for(const itemId of new Set(c.itemIds)){
    const row=c.review.coverage.find(r=>r.itemId===itemId);
    const outcome=row?.selection?.outcome;
    const key=outcome==='qualifies'?'accepted':outcome==='does_not_qualify'?'rejected':'unresolved';
    groups[key].push({itemId,name:row?.itemName??itemId,evidence:row?.selection?.evidence??['Independent selection assessment not recorded']});
  }
  const rate=c.review.scoring?.rate??null,pointsBeforeCaps=rate===null?null:groups.accepted.length*rate;
  const caps=['weekly','monthly'].map(period=>{
    const cap=c.review.scoring?.[period];
    if(!cap)return {period,status:'unknown',remaining:null};
    const known=Number.isFinite(cap.priorPoints)&&cap.evidence?.length&&cap.period;
    return {...cap,kind:period,status:known?'verified':'unknown',remaining:known?Math.max(0,cap.limit-cap.priorPoints):null};
  });
  const pointsAfterCaps=pointsBeforeCaps===0?0:pointsBeforeCaps===null||caps.some(x=>x.remaining===null)?null:Math.min(pointsBeforeCaps,...caps.map(x=>x.remaining));
  return {audience:'editor_only',caseId:c.id,fingerprint:c.fingerprint,curator:c.curatorName.trim(),bounty:c.bountyName,space:c.space,category:c.kind,decisionStatus:'review_recommendation',totalItems:new Set(c.itemIds).size,counts:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.length])),items:groups,rate,ruleSource:c.review.scoring?.ruleSource??null,pointsBeforeCaps,pointsAfterCaps,caps,unresolvedItemsNotScored:groups.unresolved.length,limits:['Acceptance/rejection here are review recommendations; actual editor votes and payments require separate receipts.','Unresolved items earn no assumed credit in this subtotal; later qualifying items require an updated calculation.']};
}
export function editorSummaryMarkdown(s){
  if(s.counts.unresolved)throw Error('Finish unresolved item decisions before issuing a final editor tally');
  const fmt=n=>n===null?'Not yet determined':String(n);
  const capRows=s.caps.map(c=>`| ${c.kind??c.period} | ${fmt(c.limit??null)} | ${fmt(c.priorPoints??null)} | ${fmt(c.remaining)} |`).join('\n');
  return `# Editor-only review tally

${s.curator} — ${s.bounty}

These are review recommendations. No vote or payout is implied.

| Total items | Accepted in review | Rejected in review |
|---|---|---|
| ${s.totalItems} | ${s.counts.accepted} | ${s.counts.rejected} |

Points before caps: ${s.counts.accepted} × ${fmt(s.rate)} = ${fmt(s.pointsBeforeCaps)}.

Points after caps: ${fmt(s.pointsAfterCaps)}.${s.pointsAfterCaps===null?' Verify the applicable rate and prior weekly/monthly credits before confirming the award.':''}

Rule: ${s.ruleSource??'Applicable point rule not recorded'}.

| Cap | Limit | Prior credits, excluding this case | Remaining |
|---|---|---|---|
${capRows}

`+Object.entries(s.items).filter(([key])=>key!=='unresolved').map(([key,items])=>'## '+key[0].toUpperCase()+key.slice(1)+'\n\n'+(items.length?items.map(i=>'- '+i.name+' ('+i.itemId+')').join('\n'):'None.')).join('\n\n')+'\n';
}
