#!/usr/bin/env node
// Review-only entrypoint. No signing, votes, payments or external writes.
import fs from 'node:fs';
import {writeEditorRunReport} from './editor-run-report.mjs';
import {recordHistoryReceipt,historyKey} from './review-history.mjs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {SPACES,normalizeId,readJson,atomicJson,withLock,loadState,assemble,recordReview,reportDraft,prepareReportDraft,recordDecision,recordDelivery,caseEvidence,hash,editorSummary,editorSummaryMarkdown,reviewReadiness} from './review-core.mjs';
import {readBounty,readEntity,readEntities,query} from './review-client.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const argv=process.argv.slice(2),command=argv.shift();
const arg=(key,fallback)=>{const i=argv.indexOf('--'+key);if(i<0)return fallback;if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('--'+key+' needs a value');return argv[i+1];};
const stateDir=arg('state');if(!stateDir)throw Error('--state <directory> is required');
const stateFile=path.resolve(stateDir,'state.json'),out=path.resolve(arg('out',path.join(stateDir,'runs',new Date().toISOString().replaceAll(':','-'))));
const configFile=arg('config'),config=configFile?readJson(configFile):null;
const trace=s=>console.log(new Date().toISOString()+' '+s);
async function intakeSpecs(manifest,scope,state,space){
  const specs={},errors={};
  const bountyIds=[...new Set([...Object.keys(scope.bountyProfiles??{}),...Object.values(state.cases).filter(c=>c.space===space).map(c=>c.bountyId),...manifest.flatMap(p=>[...p.bounties.map(b=>b.id),...(scope.assignments?.[p.id]??[]).map(a=>a.bountyId)])])];
  for(const id of bountyIds){trace('Retrieving full bounty '+id);try{specs[id]=await readBounty(id,query,true,scope.bountyProfiles?.[id]?.specSpaceId?[scope.bountyProfiles[id].specSpaceId]:[SPACES[space].main,SPACES[space].datasets]);}catch(e){errors[id]=e.message;}}
  return {specs,errors};
}
await withLock(stateDir,async()=>{
  fs.mkdirSync(out,{recursive:true});
  const receipt={command,startedAt:new Date().toISOString(),state:'running',complete:false};atomicJson(path.join(out,'workflow-status.json'),receipt);
  try{
    const state=loadState(stateFile);
    if(command==='summary'){
      Object.assign(receipt,writeEditorRunReport(arg('summary'),out));
    }else if(command==='scan'||command==='import'){
      if(!config||!config.spaces)throw Error('--config is required');normalizeId(config.editorSpaceId);
      const space=arg('space');if(!SPACES[space]||!config.spaces[space])throw Error('Configured --space is required');
      const scope=config.spaces[space];
      let intakePath=arg('intake');
      if(command==='scan'){
        if(!scope.enabled)throw Error('Space is disabled pending its preflight');
        const previous=state.spaces[space]?.discoveryCutoff;
        const since=arg('since',previous?new Date(Date.parse(previous)-60000).toISOString():scope.firstSince);
        const until=arg('until',new Date().toISOString());
        if(!since||!Number.isFinite(Date.parse(since))||!Number.isFinite(Date.parse(until)))throw Error('An explicit first-run cutoff is required');
        if(previous&&Date.parse(until)<Date.parse(previous))throw Error('Cannot move a persisted discovery cutoff backward; use an isolated replay state');
        intakePath=path.join(out,'intake');
        const args=[path.join(here,'review-stage0.mjs'),'--space',space,'--since',since,'--until',until,'--editor',config.editorSpaceId,'--out',intakePath,'--cache',path.resolve(config.cacheDir??path.join(stateDir,'cache'))];
        if(config.injectorSpaceId)args.push('--injector',config.injectorSpaceId);
        args.push('--concurrency',String(config.concurrency??8));
        trace('Starting bounded read-only intake');
        const run=spawnSync(process.execPath,args,{stdio:'inherit',timeout:config.intakeTimeoutMs??600000,env:process.env});
        if(run.error||run.status!==0)throw Error('Intake did not complete: '+(run.error?.message??run.status));
      }
      if(!intakePath)throw Error('--intake directory is required for import');
      intakePath=path.resolve(intakePath);
      const runStatus=readJson(path.join(intakePath,'run-status.json'));
      if(runStatus.space!==space||!runStatus.complete||runStatus.state!=='complete')throw Error('Intake has no matching complete receipt');
      const manifest=readJson(path.join(intakePath,'manifest.json'));
      const newProposalIds=new Set(manifest.map(p=>p.id));
      const rawEdits=readJson(path.join(intakePath,'raw-edits.json'));
      const items=readJson(path.join(intakePath,'items.json'));
      // Full proposal metadata closes the preview's 40-relation tag limit.
      const metadata={};
      if(command==='scan'){const batch=await readEntities(manifest.map(p=>p.id));for(const p of manifest){
        const e=batch.records[p.id];if(e){metadata[p.id]=e;p.bounties=e.relations.nodes.filter(r=>r.type.name==='Bounties').map(r=>({id:r.toEntity.id,name:r.toEntity.name}));}
        else{p.metadataError=batch.errors[p.id];metadata[p.id]={error:p.metadataError};p.bounties=[];}
      }}
      // Revisit captured ambiguous work and existing cases without refetching immutable CIDs.
      const capturedIds=new Set([...(state.spaces[space]?.identification??[]).map(r=>r.proposalId),...Object.values(state.cases).filter(c=>c.space===space).flatMap(c=>c.proposalIds)]);
      for(const id of capturedIds)if(!newProposalIds.has(id)&&state.proposals[id]){const r=state.proposals[id];manifest.push(r.proposal);rawEdits[id]=r.snapshots;items.push(...(r.items??[]));}
      const supplied=arg('specs');const savedSpecs=supplied?readJson(supplied):null;
      const specResult=supplied?(savedSpecs.specs?{specs:savedSpecs.specs,errors:savedSpecs.errors??{}}:{specs:savedSpecs,errors:{}}):await intakeSpecs(manifest,scope,state,space);
      atomicJson(path.join(out,'bounty-specs.json'),specResult);atomicJson(path.join(out,'proposal-metadata.json'),metadata);
      const result=assemble(state,{space,manifest,rawEdits,items,specs:specResult.specs,runStatus},{...config,intakePath});
      if(state.spaces[space]?.discoveryCutoff&&Date.parse(state.spaces[space].discoveryCutoff)<Date.parse(loadState(stateFile).spaces[space]?.discoveryCutoff??0))throw Error('Import would move discovery cutoff backward');
      state.history.push({at:new Date().toISOString(),space,intakePath,result});
      atomicJson(stateFile,state);atomicJson(path.join(out,'case-summary.json'),result);
      atomicJson(path.join(out,'review-queue.json'),Object.values(state.cases).filter(c=>c.space===space&&['needs_review','review_unresolved'].includes(c.status)));
      Object.assign(receipt,{space,...result,specErrors:specResult.errors});
    }else if(command==='record'){
      const input=readJson(arg('review'));const rows=Array.isArray(input)?input:[input];
      if(rows.some(r=>r.feedbackPolicy!=='error_types_v1'))throw Error('New reviews require the error_types_v1 feedback policy; preserve historical reviews without re-recording them');
      const updated=rows.map(r=>recordReview(state,r));atomicJson(stateFile,state);receipt.recordedCases=updated.map(c=>c.id);
    }else if(command==='history-receipt'){
      const input=readJson(arg('history'));const rows=Array.isArray(input)?input:[input];receipt.historyLogs=rows.map(r=>recordHistoryReceipt(state,r).id);atomicJson(stateFile,state);
    }else if(command==='decision'){
      const input=readJson(arg('decision'));const rows=Array.isArray(input)?input:[input];receipt.decisions=rows.map(d=>recordDecision(state,d).id);atomicJson(stateFile,state);
    }else if(command==='delivery'){
      const input=readJson(arg('delivery'));const rows=Array.isArray(input)?input:[input];receipt.deliveries=rows.map(d=>recordDelivery(state,d).id);atomicJson(stateFile,state);
    }else if(command==='evidence'){
      const ids=arg('case')?[arg('case')]:Object.keys(state.cases);for(const id of ids)atomicJson(path.join(out,id+'.evidence.json'),caseEvidence(state,id));receipt.cases=ids;
    }else if(command==='reports'){
      const drafts=[],unchangedDrafts=[],investigationNeeded=[],reconciliationNeeded=[],historyLoggingPending=[];for(const c of Object.values(state.cases)){
        const keys=new Set((c.curatorReviewLog??[]).map(r=>r.key));
        for(const key of keys){const rows=c.curatorReviewLog.filter(r=>r.key===key),last=rows.at(-1);if(!rows.some(r=>r.status==='verified')&&['unknown','failed'].includes(last.status))historyLoggingPending.push({caseId:c.id,key,status:'reconciliation_needed',receipt:last});}
        if(['submitted','unknown','failed'].includes(c.delivery?.status)){reconciliationNeeded.push({caseId:c.id,delivery:c.delivery});continue;}
        if(c.review?.fingerprint!==c.fingerprint)continue;
        const readiness=reviewReadiness(c);if(!readiness.complete){c.status='review_unresolved';investigationNeeded.push({caseId:c.id,...readiness});continue;}
        const prepared=prepareReportDraft(c,path.join(out,c.id+'.json'));const {draft,changed}=prepared;if(prepared.reconciliationNeeded)reconciliationNeeded.push({caseId:c.id,delivery:c.delivery});else (prepared.readyToPublish?drafts:unchangedDrafts).push(draft);atomicJson(path.join(out,c.id+'.json'),draft);fs.writeFileSync(path.join(out,c.id+'.md'),draft.markdown);
        if(c.review.feedbackPolicy==='error_types_v1'&&c.delivery?.status==='verified'&&c.delivery.fingerprint===c.fingerprint){const key=historyKey(c);if(!(c.curatorReviewLog??[]).some(r=>r.key===key&&r.status==='verified')&&!historyLoggingPending.some(r=>r.caseId===c.id&&r.key===key))historyLoggingPending.push({caseId:c.id,key,status:'needs_logging'});}
        const summary=editorSummary(c);if(summary){atomicJson(path.join(out,c.id+'.editor.json'),summary);fs.writeFileSync(path.join(out,c.id+'.editor.md'),editorSummaryMarkdown(summary));}
      }atomicJson(stateFile,state);receipt.investigationNeeded=investigationNeeded;receipt.reconciliationNeeded=reconciliationNeeded;receipt.historyLoggingPending=historyLoggingPending;receipt.drafts=drafts.map(d=>({caseId:d.caseId,pageId:d.pageId,targetSpaceId:d.targetSpaceId}));receipt.unchangedDrafts=unchangedDrafts.map(d=>d.caseId);
    }else if(command==='preflight'){
      if(!config)throw Error('--config required');
      const checks=[];for(const [name,ids] of Object.entries(SPACES)){
        try{const d=await query('query($id:UUID!){space(id:$id){id type page{id name} editorsList{memberSpaceId}}}',{id:ids.datasets});
          if(!d.space||!Array.isArray(d.space.editorsList))throw Error('Membership response incomplete');checks.push({space:name,...ids,configured:!!config.spaces?.[name],dataset:d.space.page?.name,canPublish:d.space.editorsList.some(e=>normalizeId(e.memberSpaceId)===normalizeId(config.editorSpaceId)),checkedAt:new Date().toISOString()});}
        catch(e){checks.push({space:name,...ids,error:e.message});}
      }atomicJson(path.join(out,'space-preflight.json'),checks);receipt.spaces=checks;if(checks.some(c=>c.error))throw Error('Preflight incomplete; see per-space errors');
    }else throw Error('Expected scan, import, evidence, record, decision, delivery, history-receipt, reports, summary or preflight');
    receipt.state='complete';receipt.complete=true;receipt.finishedAt=new Date().toISOString();atomicJson(path.join(out,'workflow-status.json'),receipt);trace(JSON.stringify(receipt));
  }catch(error){receipt.state='failed';receipt.error=error.message;receipt.finishedAt=new Date().toISOString();atomicJson(path.join(out,'workflow-status.json'),receipt);throw error;}
});
