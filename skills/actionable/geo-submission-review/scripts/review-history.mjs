#!/usr/bin/env node
// Offline history payloads and receipt recording. No Notion writes or credentials.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,reviewContentHash,reviewReadiness,atomicJson} from './review-core.mjs';
import {renderNotionReport} from './notion-report.mjs';

const outcomes={meets_requirements:'Meets requirements',needs_correction:'Needs correction',does_not_meet_requirements:'Does not meet requirements'};
const https=value=>{const url=new URL(value);if(url.protocol!=='https:')throw Error('Expected HTTPS URL');return value;};
const date=value=>{if(!value||!Number.isFinite(Date.parse(value)))throw Error('Actual review publication date is required');return new Date(value).toISOString();};
export const historyKey=c=>hash({kind:'curator-review-history-v1',caseId:c.id,content:reviewContentHash(c)});

export function prepareHistoryEntry(c,input,configuration){
  if(!reviewReadiness(c).complete)throw Error('Finish the review before logging it');
  if(c.delivery?.status!=='verified'||c.delivery.fingerprint!==c.fingerprint||!c.delivery.receipt?.readbackAt||!c.delivery.receipt?.evidence?.length)throw Error('Verify current Geo publication before logging it');
  if(c.delivery.reviewContentHash&&c.delivery.reviewContentHash!==reviewContentHash(c))throw Error('Published review content is stale');
  if(!configuration?.dataSourceId||!configuration.databaseUrl||!configuration.lookupViewUrl)throw Error('Curator review log destination and unfiltered lookup view are not configured');
  https(configuration.databaseUrl);
  if(!/^view:\/\/[a-f0-9-]{36}$/.test(configuration.lookupViewUrl))throw Error('Expected the verified unfiltered lookup view URI');
  const key=historyKey(c),known=(c.curatorReviewLog??[]).find(r=>r.key===key&&r.status==='verified');
  if(known)return {schemaVersion:1,status:'already_logged',caseId:c.id,key,receipt:known};
  const pending=(c.curatorReviewLog??[]).filter(r=>r.key===key).at(-1);
  if(pending&&['unknown','failed'].includes(pending.status))return {schemaVersion:1,status:'reconciliation_needed',caseId:c.id,key,receipt:pending};
  if(!input.feedbackSnapshot?.trim()||!input.publicationEvidence?.length)throw Error('Save the feedback actually published and its readback evidence');
  if(input.snapshotReviewContentHash!==reviewContentHash(c))throw Error('Feedback snapshot does not identify the current published review');
  const publishedAt=date(input.publishedAt),reportUrl=https(c.delivery.receipt.url);
  if(!c.curatorName||!(input.curatorId??c.curatorId)||!c.space)throw Error('Verified curator identity and space are required');
  const proposals=(c.proposalIds??[]).map(id=>{
    const spaceId=c.proposalRefs?.[id]?.spaceId;if(!spaceId)throw Error('Submission proposal perspective is missing');
    return {id,url:`https://www.geobrowser.io/space/${spaceId}/governance?proposalId=${id}`};
  });
  const supplied=(input.submissionUrls??[]).map(https),submissionUrls=[...new Set([...proposals.map(p=>p.url),...supplied])];
  if(!submissionUrls.length)throw Error('A real submission link is required');
  const bounty=c.bountyId?c.bountyName:'No formal bounty';
  if(!bounty||(c.bountyId&&!c.spec?.spaceId))throw Error('Bounty identity and perspective are required');
  const bountyUrl=c.bountyId?`https://www.geobrowser.io/space/${c.spec.spaceId}/${c.bountyId}`:null;
  const properties={Review:`${c.curatorName} — ${bounty} — ${publishedAt.slice(0,10)}`,'date:Review date:start':publishedAt,'date:Review date:is_datetime':1,Curator:c.curatorName,'Curator ID':input.curatorId??c.curatorId,Space:c.space,Submission:submissionUrls.join('\n'),Bounty:bounty,'Bounty URL':bountyUrl,'Geo report':reportUrl,Outcome:outcomes[c.review.outcome],'Error types':c.review.verifiedErrorKinds?.join('; ')??'Not categorized in historical review','Review key':key};
  const previous=(c.curatorReviewLog??[]).filter(r=>r.status==='verified').at(-1);
  const presentation=renderNotionReport(c,input,submissionUrls),content=presentation.content;
  const lookup={mode:'view',view_url:configuration.lookupViewUrl,page_size:100,is_archived:false};
  return {schemaVersion:1,status:'prepared',caseId:c.id,fingerprint:c.fingerprint,key,reviewContentHash:reviewContentHash(c),snapshotHash:hash(input.feedbackSnapshot),bodyHash:presentation.bodyHash,layout:presentation.layout,previousReviewUrl:previous?https(previous.url):undefined,publishedAt,publicationEvidence:input.publicationEvidence,databaseUrl:configuration.databaseUrl,lookup,lookupArchived:{...lookup,is_archived:true},lookupInstruction:'Verify the view has no filters and belongs to the configured data source. Paginate active and archived rows to completion; compare Review key exactly. Do not create after partial, unknown or duplicate results.',create:{parent:{data_source_id:configuration.dataSourceId.replace('collection://','')},pages:[{properties,content}]}};
}

// Explicit, single-page presentation updates only. Never enqueue a migration or
// return a create fallback. Omitted properties preserve live Editor feedback,
// including edits made after this read; do not resend a stale property snapshot.
export function prepareHistoryFormatUpdate(c,input,configuration,existing){
  if(input.allowFormatUpdate!==true)throw Error('A format update needs explicit scope for this existing page');
  const key=historyKey(c),compact=value=>String(value??'').replaceAll('-','');
  if(existing?.properties?.['Review key']!==key||compact(existing.dataSourceId?.replace('collection://',''))!==compact(configuration?.dataSourceId?.replace('collection://','')))throw Error('Existing review key and data source must match exactly');
  if(!/^[a-f0-9]{32}$/i.test(compact(existing.id))||!existing.content?.trim()||!existing.readbackAt||!existing.evidence?.length)throw Error('Fetch the exact existing page body and metadata before preparing an update');
  date(existing.readbackAt);
  if(existing.lookup?.complete!==true||existing.lookup.matchCount!==1||!existing.lookup.evidence?.length)throw Error('Reconcile incomplete or duplicate exact-key matches before updating');
  if(existing.hasInlineComments!==false)throw Error('Preserve inline comments before replacing the managed report body');
  const known=(c.curatorReviewLog??[]).find(r=>r.key===key&&r.status==='verified');
  if(known&&!new URL(https(known.url)).pathname.replaceAll('-','').includes(compact(existing.id)))throw Error('Conflicting history entries require reconciliation');
  if(known&&(known.snapshotHash!==hash(input.feedbackSnapshot)||Date.parse(known.publishedAt)!==Date.parse(input.publishedAt)))throw Error('Preserve the original published snapshot and date during format updates');
  const existingDate=existing.properties['date:Review date:start'];
  if(existingDate&&Math.floor(Date.parse(date(existingDate))/60000)!==Math.floor(Date.parse(date(input.publishedAt))/60000))throw Error('Preserve the existing review publication date');
  if((c.curatorReviewLog??[]).some(r=>r.key===key&&['unknown','failed'].includes(r.status))&&!known)throw Error('Reconcile unknown history writes before updating');
  const prepared=prepareHistoryEntry({...c,curatorReviewLog:[]},input,configuration);
  const content=prepared.create.pages[0].content;
  return {schemaVersion:1,status:content===existing.content?'unchanged':'format_update_prepared',caseId:c.id,key,layout:prepared.layout,bodyHash:prepared.bodyHash,snapshotHash:prepared.snapshotHash,publishedAt:prepared.publishedAt,previousReviewUrl:prepared.previousReviewUrl,update:content===existing.content?undefined:{page_id:existing.id,command:'update_content',content_updates:[{old_str:existing.content,new_str:content}]},preservedProperties:['Editor feedback','Review','Review key','Review date','Curator','Curator ID','Space','Submission','Bounty','Bounty URL','Geo report','Outcome','Error types']};
}

export function recordHistoryReceipt(state,receipt){
  const c=state.cases[receipt.caseId];if(!c)throw Error('Unknown review case');
  const journal=(c.curatorReviewLog??[]).find(r=>r.key===receipt.key);
  if(journal&&(journal.fingerprint!==receipt.fingerprint||journal.snapshotHash!==receipt.snapshotHash||journal.publishedAt!==receipt.publishedAt))throw Error('Preserve the journaled review revision, date and feedback snapshot');
  if((receipt.fingerprint!==c.fingerprint||receipt.key!==historyKey(c))&&!journal)throw Error('History receipt belongs to another review revision');
  if(!['unknown','verified','failed','not_created'].includes(receipt.status)||!receipt.evidence?.length||!receipt.snapshotHash)throw Error('History receipt needs status, feedback hash and evidence');
  if(journal&&journal.snapshotHash!==receipt.snapshotHash)throw Error('Preserve the journaled feedback snapshot');
  date(receipt.recordedAt);date(receipt.publishedAt);
  if(receipt.status==='verified'){https(receipt.url);date(receipt.readbackAt);}
  if(receipt.status==='not_created'){if(receipt.outcome!=='verified_not_created')throw Error('Retry requires positive no-creation evidence');date(receipt.reconciledAt);}
  c.curatorReviewLog??=[];
  const known=c.curatorReviewLog.find(r=>r.key===receipt.key&&r.status==='verified');
  if(known){if(receipt.status==='verified'&&known.url!==receipt.url)throw Error('Conflicting history entries require reconciliation');return c;}
  c.curatorReviewLog.push(structuredClone(receipt));return c;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [inputFile,outFile]=process.argv.slice(2);if(!inputFile||!outFile)throw Error('Usage: review-history.mjs INPUT_JSON OUT_JSON');
  const {case:reviewCase,...input}=JSON.parse(fs.readFileSync(inputFile));atomicJson(outFile,prepareHistoryEntry(reviewCase,input,input.configuration));
}
