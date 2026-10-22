// gql.mjs — canonical zero-dependency GraphQL client for the Geo testnet API.
// Use this instead of hand-rolled curl/fetch. Node 18+ / Bun. See geo-query SKILL.md.
//
//   import { query, Q } from "./gql.mjs";
//   const data = await query(Q.ENTITY_BY_ID, { id: "..." });

export const ENDPOINT = "https://api-testnet.geobrowser.io/graphql";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST a GraphQL query. Retries (2, exponential backoff) on 5xx/429/network
 * errors and on transient GraphQL "Unexpected/Internal error" responses.
 * Throws with the FULL GraphQL error text on schema/validation errors —
 * never swallows errors into an empty `data` (the classic false-"not found" bug).
 * @returns the `data` object of the response.
 */
export async function query(gqlString, variables = undefined, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(variables === undefined ? { query: gqlString } : { query: gqlString, variables }),
      });
    } catch (err) {
      lastErr = new Error(`gql: network error (attempt ${attempt + 1}/${retries + 1}): ${err.message}`);
      continue;
    }
    if (res.status >= 500 || res.status === 429) {
      lastErr = new Error(`gql: HTTP ${res.status} ${res.statusText} (attempt ${attempt + 1}/${retries + 1})`);
      continue;
    }
    const body = await res.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error(`gql: non-JSON response (HTTP ${res.status}): ${body.slice(0, 500)}`);
    }
    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message).join(" | ");
      if (/Unexpected error|Internal/i.test(msg) && attempt < retries) {
        lastErr = new Error(`gql: transient GraphQL error: ${msg}`);
        continue; // endpoint is flaky under load — retry these
      }
      throw new Error(
        `gql: GraphQL error(s): ${msg}\n--- query was ---\n${gqlString.trim().slice(0, 600)}`,
      );
    }
    if (!res.ok) throw new Error(`gql: HTTP ${res.status}: ${body.slice(0, 500)}`);
    return json.data;
  }
  throw lastErr;
}

// ── Known-good query templates (field shapes verified per geo-query SKILL.md 0.2.x) ──
// Pass IDs via `variables` — do NOT string-interpolate.
export const Q = {
  // Single entity, full shape: values (typed fields, NOT `value`) + relations
  // (id = edge/delete handle, entityId = relation-as-entity/property handle).
  // NB: entity(id:) never returns null — test existence via spaceIds/types non-empty.
  ENTITY_BY_ID: `query EntityById($id: UUID!) {
    entity(id: $id) {
      id name description spaceIds
      types { id name }
      values(first: 100) {
        nodes { property { id name } text date datetime boolean decimal integer float }
      }
      relations(first: 100) {
        nodes { id entityId position type { id name } toEntity { id name } }
      }
    }
  }`,

  // Entities of a type in a space — `entities` is FLAT (no `nodes` wrapper). first/offset ≤ 1000.
  ENTITIES_BY_TYPE: `query EntitiesByType($typeId: UUID!, $spaceId: UUID, $first: Int = 50, $offset: Int = 0) {
    entities(typeId: $typeId, spaceId: $spaceId, first: $first, offset: $offset) { id name description }
  }`,

  // Every entity of a type in a space, any length: one page in id order. Use with
  // paginate(), which passes `first` and `filter` (id > last id seen). Cursor pages
  // (`entitiesConnection(after:)`) on long lists hit Geo's 15 s cutoff (504); id order
  // stays fast on every page.
  ENTITIES_BY_TYPE_PAGE: `query EntitiesByTypePage($typeId: UUID!, $spaceId: UUID, $first: Int = 1000, $filter: EntityFilter) {
    entities(typeId: $typeId, spaceId: $spaceId, first: $first, orderBy: ID_ASC, filter: $filter) { id name description }
  }`,

  // Backlinks: all relations pointing AT an entity. No spaceId ARG — scope via filter.
  BACKLINKS: `query Backlinks($id: UUID!, $spaceId: UUID!, $first: Int = 500) {
    entity(id: $id) {
      backlinks(first: $first, filter: { spaceId: { is: $spaceId } }) {
        totalCount
        nodes { id typeId type { name } fromEntity { id name types { id name } } }
      }
    }
  }`,

  // Governance proposals in a space — `proposals` is FLAT (no `nodes`); times are BigInt strings.
  PROPOSALS: `query Proposals($spaceId: UUID!, $first: Int = 20) {
    proposals(filter: { spaceId: { is: $spaceId } }, first: $first, orderBy: CREATED_AT_DESC) {
      id name spaceId proposedBy votingMode startTime endTime executedAt createdAt
      yesCount noCount abstainCount
    }
  }`,
};

/**
 * Read every row of a flat `entities` list query, in id order: the first page has no
 * id filter, each next page asks for ids greater than the last one seen, and a page
 * shorter than `pageSize` ends the list. Every page is a fresh indexed lookup, so
 * page 30 is as fast as page 1.
 *
 * The query must declare `$first: Int` and `$filter: EntityFilter`, use
 * `orderBy: ID_ASC`, and select `id` (see Q.ENTITIES_BY_TYPE_PAGE). A caller's own
 * `filter` variable is kept and combined with the id condition. Nesting per-row
 * relations? Pass a smaller `pageSize` (≤ 100; see geo-query "Memory blow-up").
 * @returns all rows across all pages.
 */
export async function paginate(gqlString, variables = {}, { pageSize = 1000, path = "entities" } = {}) {
  if (!/\$first\b/.test(gqlString) || !/\$filter\b/.test(gqlString) || !/ID_ASC/.test(gqlString)) {
    throw new Error("paginate: the query must declare $first and $filter and use orderBy: ID_ASC (see Q.ENTITIES_BY_TYPE_PAGE)");
  }
  const out = [];
  let last = null;
  while (true) {
    const filter = last === null ? variables.filter : { ...(variables.filter ?? {}), id: { greaterThan: last } };
    const data = await query(gqlString, { ...variables, first: pageSize, filter });
    const rows = path.split(".").reduce((o, k) => o?.[k], data);
    if (!Array.isArray(rows)) throw new Error(`paginate: "${path}" is not a list in the response`);
    for (const row of rows) {
      if (last !== null && !(row.id > last)) throw new Error("paginate: rows are not in id order (orderBy: ID_ASC, and select id)");
      last = row.id;
      out.push(row);
    }
    if (rows.length < pageSize) return out;
  }
}
