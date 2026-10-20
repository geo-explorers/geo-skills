#!/usr/bin/env node
// geo-publish dry-run helper. Builds ops only; cannot sign, upload or broadcast.
import {createRequire} from 'node:module';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {stableId,normalizeId,atomicJson,reviewReadiness,findingIssue,usesRoutineIntroduction,acceptanceSummary} from './review-core.mjs';
const P={related:'dfa6aebe1ca94bf29faccc4cc7afb24c',sources:'49c5d5e1679a4dbdbfd33f618f227c94',url:'412ff593e9154012a43d4c27ec5c68b6',markdown:'e3e363d1dd294ccb8e6ff3b76d99bc33',blocks:'beaba5cba67741a8b35377030613fc70',columns:'01412f8381894ab1836565c7fd358cc1',types:'8f151ba4de204e3c9cb499ddf96f48f1',sourceType:'1f69cc9880d444abad493df6a7b15ee4',item:'a99f9ce12ffa4dac8c61f6310d46064a',view:'1907fd1c81114a3ca378b1f353425b65',original:'5d4dda664938562da3eec5bc6017c04c',excerpt:'4ecf5a8df4e45301a72b9c29d59f3f7a',issue:'6bb3a7b114ac5582af25aeb811115301',evidence:'77508faa156b5802a5e46147f5fbd8a1'};
const T={page:'480e3fc267f3499385fbacdf4ddeaa6b',finding:'b14985a95e0c5a3ca872f29e22719ace',text:'76474f2f00894e77a0410b39fb17d0bf',data:'b8803a8665de412bbb357e0c84adf473',source:'706779bf537744a68694ea06cf87a3a2'};
const hex=x=>Buffer.from(x).toString('hex');
const serialize=(k,v)=>typeof v==='bigint'?v.toString():v instanceof Uint8Array?hex(v):v;
export function buildReportOps(draft,plan,Graph){
  if(draft.publicationAction&&draft.publicationAction!=='create')throw Error('Report must be reconciled or updated through geo-publish; create is not allowed: '+draft.publicationAction);
  const readiness=reviewReadiness({fingerprint:draft.fingerprint,review:draft.review,...draft.reviewScope});
  if(!readiness.complete)throw Error('Final report needs investigation: '+readiness.blockers.map(b=>b.itemId??b.reason).join(', '));
  if(draft.publicationStatus!=='draft_only'||draft.pageId!==stableId('submission-report:'+draft.caseId))throw Error('Expected a deterministic recorded report draft');
  if(plan.targetSpaceId!==draft.targetSpaceId||plan.caseFingerprint!==draft.fingerprint)throw Error('Delivery plan does not match draft scope/revision');
  for(const key of ['discoveryReceipt','duplicateCheckReceipt','schemaReceipt']){
    if(typeof plan[key]!=='string'||!fs.existsSync(plan[key]))throw Error('geo-publish receipt must be an existing JSON file: '+key);
    const receipt=JSON.parse(fs.readFileSync(plan[key]));if(receipt.complete!==true||receipt.verified===false||!['complete','verified'].includes(receipt.state))throw Error('geo-publish receipt is incomplete or unverified: '+key);
  }
  // This first delivery supports create-only report-owned content. Updates need live baseline/merge planning.
  if(plan.mode!=='create')throw Error('Existing report updates require a geo-publish preservation/merge plan');
  const ops=[],created=[],edges=[],pageId=normalizeId(draft.pageId);
  const val=(property,value)=>({property,type:'text',value:String(value)});
  const rewrite=op=>{if(op.type==='createRelation'&&hex(op.relationType)===P.types){const key=[hex(op.from),hex(op.relationType),hex(op.to)].join(':');op.id=new Uint8Array(Buffer.from(stableId('report-edge:'+key),'hex'));op.entity=new Uint8Array(Buffer.from(stableId('report-edge-entity:'+key),'hex'));}return op;};
  function create(id,name,type,values=[]){const r=Graph.createEntity({id,name,types:[type],values});ops.push(...r.ops.map(rewrite));created.push({id,name,types:[type]});return id;}
  function rel(from,type,to,options={}){const {identityKey='',...targetOptions}=options;const key=[from,type,to,identityKey].join(':');const id=stableId('report-edge:'+key),entityId=stableId('report-edge-entity:'+key);ops.push(...Graph.createRelation({id,entityId,fromEntity:from,type,toEntity:to,...targetOptions}).ops.map(rewrite));edges.push({id,entityId,from,type,to});if(targetOptions.entityTypes?.length)created.push({id:entityId,name:'Citation relation',types:targetOptions.entityTypes});return entityId;}
  function text(parent,slug,body,position){const id=stableId(pageId+':text:'+slug);create(id,undefined,T.text,[val(P.markdown,body)]);rel(parent,P.blocks,id,{position});return id;}
  if(plan.addIssueToFindingSchema){rel(T.finding,P.columns,P.issue);}
  create(pageId,draft.title,T.page);
  let intro;
  if(usesRoutineIntroduction(draft.reviewScope??{})){
    if(draft.introductionLayout!=='routine-three-bullets-v1'||typeof draft.introduction!=='string')throw Error('Routine reports need the three-bullet introduction');
    const lines=draft.introduction.trim().split('\n');
    if(lines.length!==3||lines.some((line,i)=>!line.startsWith(['- **Accepted:** ','- **Rejection:** ','- **Feedback:** '][i])||!line.split('** ')[1]?.trim()))throw Error('Routine report text area must contain exactly the acceptance, rejection and feedback bullets');
    const accepted=acceptanceSummary({...draft.reviewScope,review:draft.review});
    if(!lines[0].startsWith('- **Accepted:** '+accepted))throw Error('Accepted must use the accurate count and specific item rundown from the recorded review');
    intro=draft.introduction;
  }else{
    intro=draft.review.findings.length?draft.markdown.split('## Review feedback')[0].trimEnd():draft.markdown;
    if(draft.review.findings.length&&!/Open each (?:review|finding)/i.test(intro))intro+='\n\nOpen each review in the table below to see the full details, including the original statement, the issue and supporting sources.\n';
  }
  text(pageId,'feedback',intro,'a0');
  if(draft.review.findings.length){
    const tableId=stableId(pageId+':feedback-table');create(tableId,'Review feedback',T.data);
    rel(tableId,P.sourceType,'1295037a5d9c4d09b27c5502654b9177');const config=rel(pageId,P.blocks,tableId,{position:'a1'});
    rel(config,P.view,'cba271cef7c140339047614d174c69f1');[P.related,P.original,P.excerpt,P.issue,P.sources,P.evidence].forEach((p,i)=>rel(config,P.columns,p,{position:'a'+i}));
    draft.review.findings.forEach((f,index)=>{
      const findingId=stableId(pageId+':finding:'+f.itemId+':'+(f.issueKey??index));
      const item=plan.items[f.itemId];if(!item?.proposalUrl||!item.name||!item.spaceId)throw Error('Pending/live item identity and proposal URL must be captured');
      create(findingId,item.name+' — review feedback',T.finding,[val(P.original,f.originalRef?f.original:'Not supplied — '+f.missingRequirement),val(P.excerpt,f.excerpt||'Not applicable — missing field'),val(P.issue,findingIssue(f)),val(P.evidence,f.evidenceDetail)]);
      rel(findingId,P.related,f.itemId,{toSpace:item.spaceId});rel(tableId,P.item,findingId,{position:'a'+index});
      for(const citation of f.citations){const source=plan.citations[citation.url];if(!source?.entityId||!source.spaceId||!['verified_live','captured_pending'].includes(source.state))throw Error('Citation target identity/provenance required: '+citation.url);
        rel(findingId,P.sources,source.entityId,{toSpace:source.spaceId,identityKey:citation.url,entityTypes:[T.source],entityValues:[val(P.url,citation.url)]});
      }
      const citations=f.citations.map(c=>'['+c.locator+']('+c.url+')').join('\n\n');
      text(findingId,'finding:'+f.itemId,`## Entity\n\n[${item.name}](${item.proposalUrl})\n\n${item.state==='captured_pending'?'Submitted content is captured in the linked proposal; a live item page was not verified.\n\n':''}## Full original statement\n\n${f.originalRef?f.original:'Not supplied — '+f.missingRequirement}\n\n## Exact excerpt under review\n\n${f.excerpt||'Not applicable — missing field'}\n\n## Issue\n\n${findingIssue(f)}\n\n## Citations for quality checks\n\n${citations}\n\n## Relevant quote or evidence detail\n\n${f.evidenceDetail}`,'a0');
    });
  }
  for(const op of ops)if(['deleteEntity','deleteRelation'].includes(op.type)||op.unset?.length)throw Error('Report create draft must not remove existing data');
  return {schemaVersion:1,status:'dry_run_only',caseId:draft.caseId,fingerprint:draft.fingerprint,targetSpaceId:draft.targetSpaceId,pageId,created,edges,opCount:ops.length,ops:JSON.parse(JSON.stringify(ops,serialize)),limits:['Native table includes mandatory Name and shortened previews; complete finding pages show all six comparison fields.','Captured-pending citation targets are proposed content references, not verified live pages.'],schemaPlan:plan.addIssueToFindingSchema?'Add the existing Issue property to the reused Review finding schema in the datasets perspective; do not delete existing schema properties.':'Reuse current compatible schema'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [draftFile,planFile,outFile]=process.argv.slice(2);if(!outFile)throw Error('Usage: report-ops.mjs DRAFT_JSON DELIVERY_PLAN_JSON OUT_JSON');
  const cm=process.env.GEO_CM_DIR;if(!cm)throw Error('GEO_CM_DIR is required for the geo-publish SDK');
  const require=createRequire(path.join(cm,'package.json'));const {Graph}=await import(require.resolve('@geoprotocol/geo-sdk'));
  const result=buildReportOps(JSON.parse(fs.readFileSync(draftFile)),JSON.parse(fs.readFileSync(planFile)),Graph);atomicJson(outFile,result);
  console.log(JSON.stringify({status:result.status,created:result.created,opCount:result.opCount,pageId:result.pageId,targetSpaceId:result.targetSpaceId,schemaPlan:result.schemaPlan}));
}
