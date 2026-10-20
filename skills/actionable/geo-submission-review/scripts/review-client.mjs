import {hash,normalizeId} from './review-core.mjs';
const ENDPOINT='https://api-testnet.geobrowser.io/graphql';
export async function query(text,variables={},options={}){
  let last;for(let attempt=0;attempt<3;attempt++){
    if(attempt)await new Promise(r=>setTimeout(r,500*2**attempt));
    const signal=AbortSignal.timeout(options.timeoutMs??30000);
    try{const response=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:text,variables}),signal});
      if(!response.ok)throw Error('HTTP '+response.status);const json=await response.json();
      if(json.errors?.length)throw Error(json.errors.map(e=>e.message).join('; '));
      if(!json.data||typeof json.data!=='object')throw Error('Missing GraphQL data');return json.data;
    }catch(e){last=e;if(/Cannot query|Unknown argument|validation/i.test(e.message))break;}
  }throw last;
}
const ENTITY_FIELDS='id name description spaceIds types{id name} values(first:1000){totalCount nodes{spaceId property{id name} text date datetime time decimal integer float boolean language unit point}} relations(first:1000){totalCount nodes{id entityId spaceId position type{id name} toEntity{id name}}}';
function validateEntity(e,id){
  if(!e||!Array.isArray(e.values?.nodes)||!Array.isArray(e.relations?.nodes)||!Number.isInteger(e.values.totalCount)||!Number.isInteger(e.relations.totalCount))throw Error('Full entity response incomplete: '+id);
  e.complete=e.values.nodes.length===e.values.totalCount&&e.relations.nodes.length===e.relations.totalCount;
  if(!e.complete)throw Error('Entity field coverage incomplete: '+id);
  if(!e.spaceIds?.length&&!e.types?.length)throw Error('Entity is a stub, not a verified submission/specification: '+id);
  return e;
}
export async function readEntities(ids,request=query){
  ids=[...new Set(ids.map(normalizeId))];const records={},errors={};
  for(let i=0;i<ids.length;i+=50){const batch=ids.slice(i,i+50);
    try{const d=await request('query($ids:[UUID!]!){entities(first:50,filter:{id:{in:$ids}}){'+ENTITY_FIELDS+'}}',{ids:batch});if(!Array.isArray(d.entities))throw Error('Batch entity response incomplete');
      for(const id of batch){try{records[id]=validateEntity(d.entities.find(e=>normalizeId(e.id)===id),id);}catch(error){errors[id]=error.message;}}
    }catch(error){for(const id of batch)errors[id]=error.message;}
  }return {records,errors};
}
export async function readEntity(id,request=query){
  id=normalizeId(id);
  const result=await request('query($id:UUID!){entity(id:$id){'+ENTITY_FIELDS+'}}',{id});return validateEntity(result.entity,id);
}
export async function readBounty(id,request=query,followCriteria=true,scopeSpaceIds=null){
  const e=await readEntity(id,request);
  const allowed=scopeSpaceIds?.map(normalizeId);
  const edges=e.relations.nodes.filter(r=>r.type.name==='Blocks'&&(!allowed||r.spaceId&&allowed.includes(normalizeId(r.spaceId)))).sort((a,b)=>((a.position??'')<(b.position??'')?-1:(a.position??'')>(b.position??'')?1:0)||a.id.localeCompare(b.id));
  const blocks=[];
  for(const edge of edges){const block=await readEntity(edge.toEntity.id,request);const texts=block.values.nodes.filter(v=>v.property.name==='Markdown content'&&typeof v.text==='string'&&v.text.trim()&&(!allowed||v.spaceId&&allowed.includes(normalizeId(v.spaceId))));blocks.push({id:block.id,position:edge.position,texts: texts.map(v=>({spaceId:v.spaceId,text:v.text})),entity:block});}
  const descriptions=e.values.nodes.filter(v=>(v.property.id==='9b1f76ff9711404c861e59dc3fa7d037'||v.property.name==='Description')&&typeof v.text==='string'&&v.text.trim()&&(!allowed||v.spaceId&&allowed.includes(normalizeId(v.spaceId))));
  const texts=blocks.flatMap(b=>b.texts.map(t=>t.text));
  // Only a complete entity read proving no scoped Blocks permits a short brief.
  // Never fall back after a failed/empty block read or to the aggregate description.
  const descriptionOnly=edges.length===0&&descriptions.length>0;
  if(descriptionOnly)texts.push(...descriptions.map(v=>v.text));
  if(!texts.length||edges.length&&blocks.some(b=>!b.texts.length&&!b.entity.types.some(t=>t.name==='Data block')))throw Error('Bounty requirements were not retrieved completely: '+id);
  const links=[...new Set(texts.flatMap(t=>[...t.matchAll(/https:\/\/[^\s)<>]+/g)].map(m=>m[0])))];
  const linkedCriteria=[];
  if(followCriteria)for(const link of links){const match=link.match(/https:\/\/(?:www\.)?geobrowser\.io\/space\/([a-f0-9-]{32,36})\/([a-f0-9-]{32,36})(?:$|[?#])/i);if(!match)continue;
    try{linkedCriteria.push({url:link,snapshot:await readBounty(match[2],request,false,[match[1]])});}catch(error){linkedCriteria.push({url:link,error:error.message});}
  }
  const spec={id:e.id,name:e.name,spaceId:edges[0]?.spaceId??descriptions[0]?.spaceId??(allowed?allowed[0]:e.spaceIds[0]),complete:true,format:descriptionOnly?'description_only':'blocks',descriptionValues:descriptions,entity:e,blocks,linkedCriteriaCandidates:links,linkedCriteria,retrievedAt:new Date().toISOString()};
  spec.contentHash=hash({name:e.name,description:e.description,...(descriptionOnly?{descriptionValues:descriptions}:{}),blocks:blocks.map(b=>({id:b.id,position:b.position,texts:b.texts,entity:b.entity})),linkedCriteria:linkedCriteria.map(c=>({url:c.url,contentHash:c.snapshot?.contentHash??null,error:c.error??null}))});return spec;
}
export async function proposalHistory(spaceId,since,until,request=query){
  let after=null;const seen=new Set(),rows=[];
  for(let page=0;page<100;page++){
    const d=await request(`query($spaceId:UUID!,$after:Cursor){proposalsConnection(filter:{spaceId:{is:$spaceId}},first:500,after:$after,orderBy:CREATED_AT_DESC){totalCount nodes{id spaceId proposedBy createdAt executedAt proposalVersions(first:1){name}} pageInfo{hasNextPage endCursor}}}`,{spaceId,after});const c=d.proposalsConnection;
    if(!Array.isArray(c?.nodes)||typeof c.pageInfo?.hasNextPage!=='boolean')throw Error('Proposal connection incomplete');
    for(const p of c.nodes){if(!seen.has(p.id)&&Number(p.createdAt)>=since&&Number(p.createdAt)<=until)rows.push(p);seen.add(p.id);}
    if(!c.pageInfo.hasNextPage||c.nodes.some(p=>Number(p.createdAt)<since))return rows;
    if(!c.pageInfo.endCursor||c.pageInfo.endCursor===after)throw Error('Proposal cursor did not advance');after=c.pageInfo.endCursor;
  }throw Error('Proposal pagination exceeded page guard');
}
