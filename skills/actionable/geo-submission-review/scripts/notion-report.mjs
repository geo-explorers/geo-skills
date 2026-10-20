// Offline Notion presentation. Geo rendering and review identity stay unchanged.
import {findingIssue,reviewReadiness,reviewContentHash,stableId,hash} from './review-core.mjs';

export const NOTION_REPORT_LAYOUT='three-bullets-geo-table-v1';
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

function summaryFor(c,supplied){
  const findings=c.review.findings??[],coverage=c.review.coverage??[];
  const passing=coverage.some(r=>r.selection?.outcome==='qualifies'||r.outcome==='meets_requirements');
  const summary=supplied??{
    accepted:c.review.outcome==='meets_requirements'?'The reviewed work meets the checked requirements.':passing?'The qualifying parts of the work meet the checked requirements.':'No unconditional acceptance is recommended; see the findings.',
    needsCorrection:findings.length?'See the findings for verified issues and any eligible corrections.':c.review.outcome==='does_not_meet_requirements'?'The work does not meet the checked requirements.':'No supported issue requiring correction was found.',
    nextSteps:findings.some(f=>f.repairEligible)?'Address eligible corrections and check the submission for similar issues.':findings.length?'Use the findings to improve future submissions; do not repair independently rejected work.':'No corrections are requested for the reviewed scope.'
  };
  const result={};
  for(const field of fields){
    const text=summary[field];
    if(typeof text!=='string'||!text.trim()||text.length>200||/[\r\n\u2028\u2029<>]/.test(text))throw Error('Notion introduction requires three concise single-line texts (maximum 200 characters each)');
    // These bullets describe the review, never execution, messaging or payment.
    if(/\b(published|executed|paid|awarded|sent|votes?|payouts?)\b/i.test(text))throw Error('Keep action claims out of Notion review introductions; describe review recommendations');
    result[field]=text.trim();
  }
  result.accepted='Review recommendation: '+result.accepted;
  return result;
}

export function validateNotionReport(content,{findingCount}={}){
  if(typeof content!=='string')throw Error('Notion report body is required');
  const lines=content.trim().split('\n');
  for(let i=0;i<3;i++){
    const prefix=`- **${labels[i]}:** `,line=lines[i]??'';
    if(!line.startsWith(prefix)||!line.slice(prefix.length).trim()||line.slice(prefix.length).length>225||/<br\s*\/?\s*>|[<>\r\u2028\u2029]/i.test(line))throw Error('Notion report needs exactly three concise single-line introductory bullets');
  }
  const rest=lines.slice(3).join('\n').trim();
  const toggleStart=rest.indexOf('<details>\n<summary>Submissions reviewed</summary>\n');
  if(toggleStart<0)throw Error('Notion report must end with a Submissions reviewed toggle');
  const table=rest.slice(0,toggleStart).trim(),toggle=rest.slice(toggleStart);
  if(!/^<details>\n<summary>Submissions reviewed<\/summary>\n(?:\t- \[[^\n]+\]\(https:\/\/[^\s]+\)\n)+<\/details>$/.test(toggle))throw Error('Submissions reviewed must contain only indented linked bullets and be the final block');
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
  const summary=summaryFor(c,input.notionSummary),pageId=c.delivery?.reportId;
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
  const content=fields.map((field,i)=>`- **${labels[i]}:** ${escape(summary[field])}`).join('\n')+'\n'+table+'<details>\n<summary>Submissions reviewed</summary>\n'+[...new Set(submissionUrls)].map((url,i)=>'\t- '+link('Submission '+(i+1),url)).join('\n')+'\n</details>';
  validateNotionReport(content,{findingCount:rows.length});
  return {layout:NOTION_REPORT_LAYOUT,content,bodyHash:hash(content)};
}
