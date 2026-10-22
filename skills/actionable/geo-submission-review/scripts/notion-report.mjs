// Offline Notion presentation. Review identity stays unchanged; presentation upgrades are prospective.
import {acceptanceSummary,recipientGroups,findingIssue,reviewReadiness,reviewContentHash,stableId,hash} from './review-core.mjs';

export const NOTION_REPORT_LAYOUT='three-bullets-geo-table-classified-v2';
export const NOTION_COLUMNS=['Review','Related entities','Full original statement','Exact excerpt under review','Issue','Sources','Evidence detail'];
const labels=['Accepted','Needs correction','Next steps'];
const fields=['accepted','needsCorrection','nextSteps'];
const escape=text=>String(text).replace(/[\\*~`$\[\]<>{}|^]/g,'\\$&');
const cell=text=>escape(text).replace(/\r\n|\r|\n/g,'<br>');
const link=(name,value)=>{
  const url=new URL(value);
  if(url.protocol!=='https:'||/[\r\n]/.test(value))throw Error('Notion report links require HTTPS URLs');
  return `[${escape(String(name).replace(/\s+/g,' ').trim())}](${value.replace(/[()<>]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())})`;
};

function summaryFor(c,supplied,items){
  const findings=c.review.findings??[],groups=recipientGroups(c);
  const summary=supplied??{
    accepted:acceptanceSummary(c,items),
    needsCorrection:groups.changes.length?'Address the items in Submissions requiring changes.':findings.length?'See the findings for rejection reasons and future checks; no current repairs are requested.':'No supported issue requiring correction was found.',
    nextSteps:groups.changes.length?'Address eligible corrections and check the submission for similar issues.':findings.length?'Use the findings to improve future submissions; do not repair independently rejected work.':'No corrections are requested for the reviewed scope.'
  };
  const result={};
  for(const field of fields){
    const text=summary[field];
    if(typeof text!=='string'||!text.trim()||text.length>200||/[\r\n\u2028\u2029<>]/.test(text))throw Error('Notion introduction requires three concise single-line texts (maximum 200 characters each)');
    // These bullets describe the review, never execution, messaging or payment.
    if(supplied&&/\b(published|executed|paid|awarded|sent|votes?|payouts?)\b/i.test(text))throw Error('Keep action claims out of Notion review introductions; describe review recommendations');
    result[field]=text.trim();
  }
  // Legacy authored acceptance prose cannot override the recorded classifications.
  result.accepted=acceptanceSummary(c,items);
  return result;
}

export function validateNotionReport(content,{findingCount}={}){
  if(typeof content!=='string')throw Error('Notion report body is required');
  const lines=content.trim().split('\n');
  for(let i=0;i<3;i++){
    const prefix=`- **${labels[i]}:** `,line=lines[i]??'';
    if(!line.startsWith(prefix)||!line.slice(prefix.length).trim()||line.slice(prefix.length).replace(/\\([\\*~`$\[\]<>{}|^])/g,'$1').length>200||/<br\s*\/?\s*>|[<>\r\u2028\u2029]/i.test(line))throw Error('Notion report needs exactly three concise single-line introductory bullets');
  }
  const rest=lines.slice(3).join('\n').trim();
  const toggleStart=rest.indexOf('<details>\n<summary>Submissions reviewed</summary>\n');
  if(toggleStart<0)throw Error('Notion report must end with a Submissions reviewed toggle');
  const table=rest.slice(0,toggleStart).trim(),toggles=rest.slice(toggleStart);
  const blocks=[...toggles.matchAll(/<details>\n<summary>([^\n]+)<\/summary>\n([\s\S]*?)\n<\/details>/g)];
  if(blocks.length!==4||blocks.map(m=>m[0]).join('\n')!==toggles)throw Error('Notion report must end with exactly four collapsed submission lists');
  const titles=['Submissions reviewed','Submissions accepted','Submissions rejected','Submissions requiring changes'];
  const counts=[];
  for(const [i,m] of blocks.entries()){
    const heading=i===0?null:m[1].slice(titles[i].length).match(/^ \((\d+) (?:story|stories|item|items)\)$/);
    if(i===0?m[1]!==titles[i]:!m[1].startsWith(titles[i])||!heading)throw Error('Submission lists must keep their ordered titles and accurate item counts');
    const entries=m[2].split('\n').filter(line=>line.startsWith('\t- ['));
    const note=i===1?'\tRecommendations only; editor approval, publication and payment are separate.':i===2?'\tRejection recommendations only.':i===3?'\tAccepted items with repairs also appear in the accepted list; do not add these counts together.':null;
    const body=note?m[2].replace(note+'\n',''):m[2];
    if(note&&!m[2].startsWith(note+'\n'))throw Error('Submission lists must explain recommendation status and repair overlap');
    if(body!=='\t- None.'&&!/^(?:\t- \[[^\n]+\]\(https:\/\/[^\s]+\)(?: — [^\n]+)?\n?)+$/.test(body))throw Error('Submission lists need indented linked bullets or an explicit empty group');
    if(i===0&&!entries.length||i>0&&Number(heading[1])!==entries.length)throw Error('Submission list counts must match their entries');
    counts.push(entries.length);
  }
  const accepted=lines[0].match(/Accepted:\*\* (\d+) (?:story|stories|item|items) recommended for acceptance[.:]/);
  if(!accepted||Number(accepted[1])!==counts[1])throw Error('Accepted summary count must match the accepted list');
  let count=0;
  if(table){
    if(!/^<table header-row="true">\n(?:<tr>\n(?:<td>[^\n]*<\/td>\n){7}<\/tr>\n)+<\/table>$/.test(table))throw Error('Notion review needs one seven-column table with no extra body sections');
    const rows=[...table.matchAll(/<tr>\n([\s\S]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<td>(.*?)<\/td>/g)].map(c=>c[1]));
    if(JSON.stringify(rows[0])!==JSON.stringify(NOTION_COLUMNS))throw Error('Notion table must use the Geo review columns in order');
    count=rows.length-1;
    if(!count||rows.slice(1).some(r=>r.some(v=>!v.trim())))throw Error('Do not create empty or incomplete finding rows');
  }
  if(findingCount!==undefined&&count!==findingCount)throw Error('Notion table must preserve every full finding');
  return {layout:NOTION_REPORT_LAYOUT,findingCount:count};
}

export function renderNotionReport(c,input,submissionUrls){
  if(!reviewReadiness(c).complete)throw Error('Finish the review before rendering a final Notion report');
  if(!submissionUrls?.length)throw Error('A real submission link is required');
  const summary=summaryFor(c,input.notionSummary,input.items),pageId=c.delivery?.reportId;
  if(!pageId||c.delivery?.status!=='verified'||c.delivery.fingerprint!==c.fingerprint||!c.delivery.receipt?.readbackAt||!c.delivery.receipt?.evidence?.length||c.delivery.reviewContentHash&&c.delivery.reviewContentHash!==reviewContentHash(c))throw Error('Verified current Geo report identity is required');
  const reportUrl=new URL(c.delivery.receipt.url),parts=reportUrl.pathname.split('/').filter(Boolean),spaceId=parts[1];
  if(parts.length!==3||parts[0]!=='space'||parts[2].replaceAll('-','')!==pageId.replaceAll('-','')||!/^[a-f0-9-]{32,36}$/i.test(spaceId))throw Error('Use the verified Geo report URL and ID');
  const rows=(c.review.findings??[]).map((f,index)=>{
    const item=input.items?.[f.itemId],coverage=c.review.coverage?.find(r=>r.itemId===f.itemId);
    const name=item?.name??coverage?.itemName??f.itemName??f.itemId;
    const itemUrl=f.itemUrl??item?.proposalUrl??(f.originalRef?.proposalId&&c.proposalRefs?.[f.originalRef.proposalId]?.spaceId?`https://www.geobrowser.io/space/${c.proposalRefs[f.originalRef.proposalId].spaceId}/governance?proposalId=${f.originalRef.proposalId}`:null);
    if(!itemUrl||!f.issue?.trim()||!f.evidenceDetail?.trim()||!f.citations?.length)throw Error('Notion finding requires its captured item link, full issue, citations and evidence');
    const original=f.originalRef?f.original:f.missingField&&f.missingRequirement?'Not supplied — '+f.missingRequirement:null;
    if(!original?.trim())throw Error('Preserve the full original statement or explicit missing requirement');
    const findingId=stableId(pageId+':finding:'+f.itemId+':'+(f.issueKey??index));
    return [link(name+' — review feedback',`${reportUrl.origin}/space/${spaceId}/${findingId}`),link(name,itemUrl),cell(original),cell(f.excerpt||'Not applicable — missing field'),cell(findingIssue(f)),f.citations.map(x=>{if(!x.locator?.trim())throw Error('Citation locator is required');return link(x.locator,x.url);}).join('<br>'),cell(f.evidenceDetail)];
  });
  const table=rows.length?'<table header-row="true">\n'+[NOTION_COLUMNS.map(cell),...rows].map(r=>'<tr>\n'+r.map(v=>`<td>${v}</td>`).join('\n')+'\n</tr>').join('\n')+'\n</table>\n':'';
  const groups=recipientGroups(c),urls=[...new Set(submissionUrls)];
  const itemLink=row=>{
    const item=input.items?.[row.itemId],finding=c.review.findings?.find(f=>f.itemId===row.itemId);
    const name=item?.name??row.itemName??finding?.itemName??row.itemId;
    const proposalId=item?.proposalId??row.proposalId??finding?.originalRef?.proposalId;
    const spaceId=c.proposalRefs?.[proposalId]?.spaceId;
    const url=item?.proposalUrl??row.itemUrl??finding?.itemUrl??(spaceId?`https://www.geobrowser.io/space/${spaceId}/governance?proposalId=${proposalId}`:urls.length===1?urls[0]:null);
    if(!url)throw Error('Capture a submission link for every classified item; do not guess its proposal');
    return link(name,url);
  };
  const toggle=(title,entries,note)=>'<details>\n<summary>'+title+'</summary>\n'+(note?'\t'+note+'\n':'')+(entries.length?entries.map(x=>'\t- '+x).join('\n'):'\t- None.')+'\n</details>';
  const countTitle=(title,rows)=>title+` (${rows.length} ${c.kind==='news'?(rows.length===1?'story':'stories'):(rows.length===1?'item':'items')})`;
  const reviewed=urls.map((url,i)=>{
    const names=(c.review.coverage??[]).filter(row=>{
      const f=c.review.findings?.find(f=>f.itemId===row.itemId),item=input.items?.[row.itemId],pid=item?.proposalId??row.proposalId??f?.originalRef?.proposalId;
      return item?.proposalUrl===url||row.itemUrl===url||f?.itemUrl===url||pid&&url.includes('proposalId='+pid)||urls.length===1;
    }).map(row=>input.items?.[row.itemId]?.name??row.itemName).filter(Boolean);
    return link(input.submissionTitles?.[url]??(names.length?names.join('; '):'Submission '+(i+1)),url);
  });
  const lists=[toggle('Submissions reviewed',reviewed),
    toggle(countTitle('Submissions accepted',groups.accepted),groups.accepted.map(row=>itemLink(row)+(row.repairs?' — accepted in review; correction still required.':'')),'Recommendations only; editor approval, publication and payment are separate.'),
    toggle(countTitle('Submissions rejected',groups.rejected),groups.rejected.map(itemLink),'Rejection recommendations only.'),
    toggle(countTitle('Submissions requiring changes',groups.changes),groups.changes.map(row=>itemLink(row)+(row.accepted?' — also accepted in review.':' — return for correction; acceptance not yet recommended.')),'Accepted items with repairs also appear in the accepted list; do not add these counts together.')];
  const content=fields.map((field,i)=>`- **${labels[i]}:** ${escape(summary[field])}`).join('\n')+'\n'+table+lists.join('\n');
  validateNotionReport(content,{findingCount:rows.length});
  return {layout:NOTION_REPORT_LAYOUT,content,bodyHash:hash(content)};
}
