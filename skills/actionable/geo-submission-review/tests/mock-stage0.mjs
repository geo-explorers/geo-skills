// Offline integration fixture: intercept every fetch; never contact Geo or IPFS.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const scenario = process.env.GEO_TEST_CASE;
const main = 'c9f267dcb0d270718c2a3c45a64afd32';
const editor = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const entity = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const proposal = 'cccccccccccccccccccccccccccccccc';
const nameProp = '11111111111111111111111111111111';
const typeProp = '22222222222222222222222222222222';
const newsType = 'e550fe517e904b2c8fffdf13408f5634';
const hasEdit = ['enrich-error', 'not-returned', 'decode-error', 'names-error', 'found'].includes(scenario);
const epoch = Date.parse('2026-09-19T12:00:00Z') / 1000;
const json = data => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/ipfs/')) {
    if (scenario === 'decode-error') return new Response(new Uint8Array([1, 2, 3]));
    const here = path.dirname(fileURLToPath(import.meta.url));
    let sdk;
    try { sdk = await import('@geoprotocol/grc-20'); }
    catch { sdk = await import(pathToFileURL(path.resolve(process.env.GEO_CM_DIR || path.resolve(here, '../../../content-management'), 'node_modules/@geoprotocol/grc-20/dist/index.js'))); }
    const id = hex => new Uint8Array(Buffer.from(hex, 'hex'));
    const edit = new sdk.EditBuilder(id(proposal)).setName('Fixture news').setCreatedAt(1n)
      .createEntity(id(entity), b => b.text(id(nameProp), 'Fixture story').text(id('44444444444444444444444444444444'), 'Full long submitted text. '.repeat(40)))
      .createRelationSimple(id('33333333333333333333333333333333'), id(entity), id(newsType), id(typeProp)).build();
    return new Response(sdk.encodeEdit(edit));
  }
  if (String(url) !== 'https://api-testnet.geobrowser.io/graphql') throw new Error('Unexpected network URL in test');
  const q = JSON.parse(init.body).query;
  if (q.includes('proposals(filter:{ spaceId:')) {
    if (scenario === 'fatal') return new Response('service down', { status: 503 });
    const isMain = q.includes(main);
    if (scenario === 'truncated') return json({ proposals: isMain
      ? Array.from({ length: 300 }, (_, i) => ({ id: i.toString(16).padStart(32, '0'), proposedBy: editor, createdAt: String(epoch), executedAt: null }))
      : [{ id: proposal, proposedBy: editor, createdAt: '1', executedAt: null }] });
    return json({ proposals: hasEdit && isMain ? [{ id: proposal, proposedBy: owner, createdAt: String(epoch), executedAt: null }] : [] });
  }
  if (q.includes('space(id:')) return json({ space: { type: 'PERSONAL', page: { id: owner, name: 'Fixture curator' } } });
  if (q.includes('proposals(filter:{ proposedBy:')) return json({ proposals: [] });
  if (q.includes('proposalActions(')) return json({ proposalActions: [{ proposalId: proposal, actionType: 'EDIT', contentUri: 'ipfs://fixture' }] });
  if (q.includes('relationsList(first:40)')) return json({ entities: [{ id: proposal, name: 'Fixture edit', relationsList: [] }] });
  if (q.includes('valuesList(first:20)')) {
    if (scenario === 'enrich-error') return new Response('down', { status: 503 });
    return json({ entities: scenario === 'found' ? [{ id: entity, name: 'Fixture story', createdAt: String(epoch), spaceIds: [main], types: [{ name: 'News story' }], valuesList: [], relationsList: [] }] : [] });
  }
  if (q.includes('entitiesConnection(')) return json({ entitiesConnection: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
  if (q.includes('typeId:"808af0bad5884e3391f09dd4b25e18be"')) {
    if (scenario === 'bounties-error') return new Response('down', { status: 503 });
    if (scenario === 'malformed-bounties') return json({ entities: null });
    return json({ entities: [] });
  }
  if (q.includes('entities(filter:')) {
    if (scenario === 'names-error') return new Response('down', { status: 503 });
    return json({ entities: [{ id: nameProp, name: 'Name' }, { id: typeProp, name: 'Types' }, { id: newsType, name: 'News story' }, {id:'44444444444444444444444444444444',name:'Summary'}] });
  }
  throw new Error(`Unexpected query in test: ${q}`);
};
