#!/usr/bin/env node
// review-stage0.mjs — Stage 0 + 1a of the bounty submission review, in one fast, resumable run.
//
//   node review-stage0.mjs --space ai --since 2026-09-08T13:30Z --editor <editorSpaceId> [--injector <id>]
//                          [--until <iso>] [--curator <proposedBy id, repeatable or comma-separated>] [--out <dir>] [--concurrency 8] [--baseline-days 2]
//   --curator: single-curator mode (a Discord "have you looked at my proposals" review): only that proposer's proposals, still both spaces.
//
// What it does (read-only, no writes to Geo):
//   1. proposals in the window for MAIN + DATASETS (2 calls)
//   2. resolves every proposer to a curator name (args-form query, parallel)
//   3. proposal titles + Bounties relations (batched, 50 per call)
//   4. proposalActions for all proposals (batched `in:` filter)
//   5. IPFS edit payloads: parallel, 10s timeout per gateway, on-disk cache (re-runs are instant)
//   6. decodeEdit → entities/values/relations, one batched name-resolution pass
//   7. live enrichment of every touched entity (name, types, spaces, Publish date, Sources, Topics)
//   8. News-story baseline for MAIN + DATASETS since (since - baselineDays)
//   9. bounty list for both spaces
//  10. prelim dedup (same-id = dual residency; title-similarity vs baseline and vs earlier batch items)
// Outputs in --out: manifest.json decoded.json entities-live.json news-window.json bounties.json summary.md timing.json
// Every step prints a timestamped line; nothing is silent for more than a few seconds.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requireList, feedCoverage, entityLookup, validateInputs } from "./review-integrity.mjs";

// ---------- deps: @geoprotocol/grc-20 (decodeEdit) ----------
const here = path.dirname(new URL(import.meta.url).pathname);
async function loadGrc20() {
  try { return await import("@geoprotocol/grc-20"); } catch {}
  const candidates = [process.cwd(), here, path.resolve(here, ".."), process.env.GEO_CM_DIR, path.resolve(here, "../../content-management"), path.resolve(here, "../../../content-management")].filter(Boolean);
  for (const c of candidates) {
    const f = path.join(c, "node_modules/@geoprotocol/grc-20/dist/index.js");
    if (fs.existsSync(f)) { try { return await import(pathToFileURL(f).href); } catch {} }
  }
  throw new Error("Cannot find @geoprotocol/grc-20. Run from a folder with it installed (content-management) or set GEO_CM_DIR.");
}


// ---------- args ----------
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf("--" + k); if (i < 0) return d; if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`--${k} requires a value`); return argv[i + 1]; };
const SPACES = {
  crypto:          { main: "c9f267dcb0d270718c2a3c45a64afd32", datasets: "5908c73ad336472ccbd983491d2d17e4" },
  ai:              { main: "41e851610e13a19441c4d980f2f2ce6b", datasets: "941964642f4d3e70ef48f54a3915277d" },
  health:          { main: "52c7ae149838b6d47ce0f3b2a5974546", datasets: "44eb138f564fbed6ed9ce543de1b849c" },
  "world-affairs": { main: "89bd89bf28ff8a0963faf92a8c905e20", datasets: "da96a4c26e718bfa6c27c3b1f3c316cd" },
  "us-politics":   { main: "4582fbbee28a16589154f7e36f1ee3c5", datasets: "1b3d2963d14de99d4e440000125edb65" },
};
const spaceKey = (arg("space", "") || "").toLowerCase().replace(/[\s_]+/g, "-");
if (!SPACES[spaceKey]) { console.error("--space must be one of: " + Object.keys(SPACES).join(", ")); process.exit(1); }
const { main: MAIN, datasets: DS } = SPACES[spaceKey];
const SINCE_ISO = arg("since"); if (!SINCE_ISO) { console.error("--since <ISO datetime> is required"); process.exit(1); }
const SINCE = Math.floor(Date.parse(SINCE_ISO) / 1000);
const UNTIL = Math.floor(Date.parse(arg("until", new Date().toISOString())) / 1000);
const EDITOR = (arg("editor", "") || "").replace(/-/g, "").toLowerCase();
const INJECTOR = (arg("injector", "") || "").replace(/-/g, "").toLowerCase();
const CONC = Number(arg("concurrency", 8));
const CURATORS = argv.flatMap((a, i) => a === "--curator" ? String(argv[i + 1] || "").split(",") : []).map(x => x.trim().replace(/-/g, "").toLowerCase());
const BASELINE_DAYS = Number(arg("baseline-days", 2));
validateInputs({ since: SINCE, until: UNTIL, editor: EDITOR, injector: INJECTOR, curators: CURATORS, concurrency: CONC, baselineDays: BASELINE_DAYS });
const OUT = path.resolve(arg("out", `tasks/${new Date().toISOString().slice(0, 10)}-submission-review-${spaceKey}`));
const CACHE = path.resolve(arg("cache", path.join(here, "..", ".ipfs-cache")));
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });

// ---------- constants ----------
const API = "https://api-testnet.geobrowser.io/graphql";
const T_NEWS = "e550fe517e904b2c8fffdf13408f5634", T_BOUNTY = "808af0bad5884e3391f09dd4b25e18be", T_SPACEOWNER = "362c1dbddc6444bba3c4652f38a642d7", T_PERSON = "7ed45f2bc48b419e8e4664d5ff680b0d";
const GATEWAYS = ["https://ipfs.io/ipfs/", "https://ipfs.filebase.io/ipfs/", "https://dweb.link/ipfs/", "https://gateway.pinata.cloud/ipfs/"]; // measured 2026-09-11: ipfs.io ~0.7 s/file, filebase ~1 s, dweb ~2.3 s, pinata 4-8 s; w3s.link/gateway.ipfs.io/nftstorage.link share ipfs.io's rate limit; cloudflare-ipfs, cf-ipfs, 4everland dead or timing out
const IPFS_TIMEOUT_MS = 10000;

// ---------- helpers ----------
const t0 = Date.now(); const timing = {};
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
async function timed(name, fn) { const s = Date.now(); const r = await fn(); timing[name] = Date.now() - s; return r; }
const hx = (u) => Buffer.from(u).toString("hex");
const aH = (v) => v == null ? null : v instanceof Uint8Array ? hx(v) : typeof v === "string" ? v.replace(/-/g, "") : String(v);
const dashed = (id) => id.includes("-") ? id : id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
const iso = (epoch) => new Date(Number(epoch) * 1000).toISOString().slice(0, 16).replace("T", " ");
const safe = (o) => JSON.stringify(o, (k, v) => typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? hx(v) : v, 1);
const save = (name, o) => fs.writeFileSync(path.join(OUT, name), safe(o));
const chunk = (a, n) => { const r = []; for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n)); return r; };
async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }

const runStatus = { complete: false, state: "running", startedAt: new Date().toISOString(), window: { since: SINCE_ISO, until: new Date(UNTIL * 1000).toISOString() }, space: spaceKey, proposalCoverage: {}, issues: [], warnings: [] };
const issue = (stage, detail) => { runStatus.issues.push({ stage, detail }); save("run-status.json", runStatus); };
save("run-status.json", runStatus);
fs.writeFileSync(path.join(OUT, "summary.md"), "# Stage 0 RUNNING — not ready for review\n\nPrior files in this directory are not valid for this run until run-status.json is complete.\n");
process.on("exit", () => {
  if (runStatus.state !== "running") return;
  runStatus.state = "failed"; runStatus.complete = false;
  runStatus.issues.push({ stage: "run", detail: "Run stopped before completion; inspect the error output and rerun. Do not score or advance the review cutoff." });
  save("run-status.json", runStatus);
  fs.writeFileSync(path.join(OUT, "summary.md"), "# Stage 0 FAILED — do not score or advance the cutoff\n\nSee run-status.json and the command error. Partial/previous artifacts are not a completed review.\n");
});
const { decodeEdit } = await loadGrc20();

async function gql(q, { retries = 2 } = {}) {
  let last;
  for (let a = 0; a <= retries; a++) {
    if (a) await new Promise(r => setTimeout(r, 400 * 2 ** (a - 1)));
    const c = new AbortController(); const tm = setTimeout(() => c.abort(), 45000);
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }), signal: c.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (j.errors?.length) throw new Error(j.errors.map(e => e.message).join(" | "));
      if (!j.data || typeof j.data !== "object") throw new Error("GraphQL response missing data");
      return j.data;
    } catch (e) { last = e; }
    finally { clearTimeout(tm); }
  }
  throw last;
}
const lit = (ids) => ids.map(i => `"${i}"`).join(",");

// ---------- 1. proposals ----------
log(`space=${spaceKey} main=${MAIN.slice(0, 8)} datasets=${DS.slice(0, 8)} window ${new Date(SINCE * 1000).toISOString()} → ${new Date(UNTIL * 1000).toISOString()} out=${OUT}`);
const props = await timed("proposals", async () => {
  const [m, d] = await Promise.all([MAIN, DS].map(sp => gql(`{ proposals(filter:{ spaceId:{ is:"${sp}" } }, first:300, orderBy: CREATED_AT_DESC){ id spaceId proposedBy executedAt createdAt } }`)));
  const tag = (list, label) => {
    const rows = requireList(list.proposals, `${label} proposals`);
    const coverage = feedCoverage(rows, SINCE, 300);
    runStatus.proposalCoverage[label] = coverage;
    if (!coverage.complete) issue("proposal-coverage", `${label}: ${coverage.reason}`);
    return rows.map(p => ({ ...p, id: p.id.replace(/-/g, ""), proposedBy: (p.proposedBy || "").replace(/-/g, ""), space: label }));
  };
  return [...tag(m, "main"), ...tag(d, "datasets")];
});
for (const [label, coverage] of Object.entries(runStatus.proposalCoverage)) if (!coverage.complete) log(`INCOMPLETE ${label}: ${coverage.reason}`);
const skipReason = (p) => p.proposedBy === EDITOR ? "editor" : p.proposedBy === INJECTOR ? "injector" : (p.proposedBy === MAIN || p.proposedBy === DS) ? "space-self" : null;
const inWindow = props.filter(p => Number(p.createdAt) >= SINCE && Number(p.createdAt) <= UNTIL);
const skipped = inWindow.filter(skipReason); const work = inWindow.filter(p => !skipReason(p) && (!CURATORS.length || CURATORS.includes(p.proposedBy)));
if (CURATORS.length) log(`curator mode: only proposer(s) ${CURATORS.map(c => c.slice(0, 8)).join(", ")}`);
log(`proposals fetched ${props.length}; in window ${inWindow.length}; skipped ${skipped.length} (${Object.entries(skipped.reduce((a, p) => (a[skipReason(p)] = (a[skipReason(p)] || 0) + 1, a), {})).map(([k, v]) => k + " " + v).join(", ") || "none"}); to review ${work.length}`);

// ---------- 2. curators ----------
const proposers = [...new Set(work.map(p => p.proposedBy))];
const curator = await timed("curators", async () => {
  const out = {};
  await pool(proposers, 6, async (sp) => {
    let name = null, personId = null, spaceType = null;
    // primary: the space's own page entity is the owner (personal spaces hold copies of other people's Person entities, so a type query is ambiguous)
    try { const d = await gql(`{ space(id:"${sp}"){ type page { id name } } }`); spaceType = d.space?.type || null; if (d.space?.page?.name) { name = d.space.page.name; personId = d.space.page.id; } }
    catch (e) { issue("curator", `${sp}: lookup failed: ${e.message}`); }
    // Never choose a Person copy as owner when space.page is unresolved.
    if (!name) issue("curator", `${sp}: owner unresolved; confirm identity before scoring`);
    out[sp] = { name, personId, spaceType };
  });
  return out;
});
const curName = (sp) => curator[sp]?.name || ("?" + sp.slice(0, 8));
log(`curators: ${proposers.map(sp => `${curName(sp)} (${sp.slice(0, 8)}${curator[sp]?.spaceType && curator[sp].spaceType !== "PERSONAL" ? " " + curator[sp].spaceType : ""}) ${work.filter(p => p.proposedBy === sp).length}`).join(" · ")}`);
// cross-space flag: how much of this proposer's work in the window landed outside these two spaces (never judge a curator from one space)
const xspace = {};
await timed("cross-space", () => pool(proposers, 6, async (sp) => {
  try { const d = await gql(`{ proposals(filter:{ proposedBy:{ is:"${sp}" } }, first:500, orderBy: CREATED_AT_DESC){ spaceId createdAt } }`); const per = {}; for (const p of requireList(d.proposals, "cross-space proposals")) { const t = Number(p.createdAt); if (t < SINCE || t > UNTIL) continue; const k = p.spaceId.replace(/-/g, ""); per[k] = (per[k] || 0) + 1; } xspace[sp] = per; } catch (e) { xspace[sp] = null; runStatus.warnings.push({ stage: "cross-space", detail: `${sp}: ${e.message}` }); }
}));
for (const sp of proposers) { const per = xspace[sp]; if (!per) continue; const other = Object.entries(per).filter(([k]) => k !== MAIN && k !== DS); if (other.length) log(`  ${curName(sp)}: ${Object.values(per).reduce((a, b) => a + b, 0)} proposals in window across ${Object.keys(per).length} spaces; outside ${spaceKey}: ${other.map(([k, v]) => k.slice(0, 8) + " " + v).join(", ")}`); }
const unresolved = proposers.filter(sp => !curator[sp]?.name);
if (unresolved.length) log(`NOTE: ${unresolved.length} proposer(s) did not resolve to a curator (possible new curator or automation): ${unresolved.map(s => s.slice(0, 8)).join(", ")}`);

// ---------- 3. proposal entities (title + bounties) ----------
const meta = await timed("proposal-meta", async () => {
  const out = {};
  await pool(chunk(work.map(p => p.id), 50), 4, async (ids) => {
    const d = await gql(`{ entities(filter:{ id:{ in:[${lit(ids)}] } }, first:60){ id name relationsList(first:40){ type{ name } toEntity{ id name } } } }`);
    for (const e of requireList(d.entities, "proposal metadata")) out[e.id] = { title: e.name, bounties: (e.relationsList || []).filter(r => r.type?.name === "Bounties").map(r => ({ id: r.toEntity.id, name: r.toEntity.name })) };
  });
  return out;
});

// ---------- 4. proposalActions ----------
const actions = await timed("proposal-actions", async () => {
  const out = {};
  await pool(chunk(work.map(p => dashed(p.id)), 50), 4, async (ids) => {
    const d = await gql(`{ proposalActions(filter:{ proposalId:{ in:[${lit(ids)}] } }){ proposalId actionType contentUri } }`);
    for (const a of requireList(d.proposalActions, "proposal actions")) { const k = a.proposalId.replace(/-/g, ""); (out[k] = out[k] || []).push(a); }
  });
  return out;
});
const manifest = work.map(p => ({ id: p.id, space: p.space, spaceId: p.spaceId || (p.space === 'main' ? MAIN : DS), createdAt: new Date(Number(p.createdAt) * 1000).toISOString(), createdEpoch: Number(p.createdAt), executed: !!p.executedAt, curator: curName(p.proposedBy), proposedBy: p.proposedBy, personId: curator[p.proposedBy]?.personId || null, title: meta[p.id]?.title || null, bounties: meta[p.id]?.bounties || [], actions: actions[p.id] || [], contentUris: (actions[p.id] || []).map(a => a.contentUri).filter(Boolean) })).sort((a, b) => a.createdEpoch - b.createdEpoch || a.id.localeCompare(b.id));
save("manifest.json", manifest);
save("proposal-inventory.json", {inWindow, skipped:skipped.map(p=>({...p,reason:skipReason(p)})), selected:work.map(p=>p.id)});
const noPayload = manifest.filter(m => !m.contentUris.length);
log(`manifest saved: ${manifest.length} proposals, ${manifest.filter(m => !m.executed).length} pending, ${noPayload.length} without payload, ${manifest.filter(m => !m.bounties.length).length} without a Bounties link`);

// ---------- 5. IPFS ----------
// Gateway notes (measured 2026-09-11): ipfs.io ~0.7 s/file and dweb.link ~2.3 s share one backend and rate-limit a
// busy IP with 429 (retry-after ~25 min) after a few hundred files; pinata is slow (4-8 s/file) but does not limit.
// So: try fast gateways first, drop a gateway for the rest of the run once it answers 429, give pinata a long timeout,
// then a second, gentler pass over whatever failed.
const GW_TIMEOUT = { "ipfs.io": 10000, "ipfs.filebase.io": 12000, "dweb.link": 12000, "gateway.pinata.cloud": 30000 };
const gwDown = {}; const gwPausedUntil = {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function fetchOnce(cid, g, timeoutMs) {
  const host = g.split("/")[2];
  for (let attempt = 0; attempt < 2; attempt++) {
    if (gwDown[host]) throw new Error(host + " rate-limited");
    if (gwPausedUntil[host] > Date.now()) await sleep(gwPausedUntil[host] - Date.now());
    const c = new AbortController(); const tm = setTimeout(() => c.abort(), timeoutMs);
    try {
      const r = await fetch(g + cid, { signal: c.signal });
      if (r.status === 429) {
        const ra = Number(r.headers.get("retry-after") || 0);
        if (ra > 120) { if (!gwDown[host]) log(`  ${host} answered 429 with retry-after ${ra} s: skipping it for the rest of this run`); gwDown[host] = true; throw new Error(host + " 429"); }
        const pause = Math.min(Math.max(ra * 1000, 5000), 20000);   // short burst limit (pinata): pause everyone on this host, then retry once
        if (!(gwPausedUntil[host] > Date.now())) { gwPausedUntil[host] = Date.now() + pause; log(`  ${host} answered 429 (burst): pausing it ${pause / 1000} s`); }
        if (attempt === 0) continue;
        throw new Error(host + " 429 twice");
      }
      if (!r.ok) throw new Error(host + " http " + r.status);
      return { bytes: Buffer.from(await r.arrayBuffer()), from: host };
    } catch (e) { if (e.name === "AbortError") throw new Error(host + " timeout " + timeoutMs / 1000 + "s"); throw e; }
    finally { clearTimeout(tm); }
  }
}
async function fetchCid(cid, { slow = false } = {}) {
  const f = path.join(CACHE, cid + ".bin");
  if (fs.existsSync(f)) {
    const bytes = fs.readFileSync(f);
    try { decodeEdit(new Uint8Array(bytes)); return { bytes, from: "cache" }; }
    catch { log(`  invalid cached edit ${cid.slice(0, 12)}; fetching a valid replacement`); }
  }
  const errs = [];
  for (const g of GATEWAYS) {
    const host = g.split("/")[2];
    try { const r = await fetchOnce(cid, g, (GW_TIMEOUT[host] || 15000) * (slow ? 2 : 1)); decodeEdit(new Uint8Array(r.bytes)); const temp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(temp, r.bytes); fs.renameSync(temp, f); return r; }
    catch (e) { errs.push(String(e.message)); }
  }
  throw new Error(errs.join("; "));
}
const cids = [...new Set(manifest.flatMap(m => m.contentUris.map(u => u.replace("ipfs://", ""))))];
const blobs = {}; let done = 0; const srcCount = {}; const failedCids = [];
await timed("ipfs", async () => {
  await pool(cids, CONC, async (cid) => {
    try { const r = await fetchCid(cid); blobs[cid] = r.bytes; srcCount[r.from] = (srcCount[r.from] || 0) + 1; }
    catch (e) { failedCids.push([cid, String(e.message)]); }
    if (++done % 10 === 0 || done === cids.length) log(`  ipfs ${done}/${cids.length}${failedCids.length ? ` (${failedCids.length} to retry)` : ""}`);
  });
  if (failedCids.length) {   // second pass: fewer in flight, double timeouts
    log(`  ipfs retry pass over ${failedCids.length} file(s); reasons seen: ${[...new Set(failedCids.map(x => x[1].split("; ").pop()))].slice(0, 4).join(" | ")}`);
    const retry = failedCids.splice(0);
    await pool(retry, 3, async ([cid]) => {
      try { const r = await fetchCid(cid, { slow: true }); blobs[cid] = r.bytes; srcCount[r.from] = (srcCount[r.from] || 0) + 1; }
      catch (e) { blobs[cid] = null; failedCids.push([cid, String(e.message)]); log(`  ipfs FAILED ${cid.slice(0, 12)}: ${String(e.message).slice(0, 120)}`); }
    });
  }
});
log(`ipfs done: ${JSON.stringify(srcCount)}${failedCids.length ? ` · ${failedCids.length} FAILED (listed above; rerun later, the cache keeps what succeeded)` : ""}`);

// ---------- 6. decode + names ----------
const names = {};
async function resolveNames(ids) {
  const need = [...new Set(ids)].filter(i => i && /^[0-9a-f]{32}$/.test(i) && !(i in names));
  await pool(chunk(need, 50), 5, async (c) => {
    try { const d = await gql(`{ entities(filter:{ id:{ in:[${lit(c)}] } }, first:60){ id name } }`); c.forEach(x => names[x] = null); requireList(d.entities, "resolved names").forEach(n => names[n.id] = n.name); }
    catch (e) { c.forEach(x => names[x] = null); issue("names", `Lookup failed for ${c.length} IDs: ${e.message}`); }
  });
}
const plain = (x) => typeof x === "bigint" ? x.toString() : x instanceof Uint8Array ? hx(x) : x;
const valOf = (v) => { let x = v?.value; if (x && typeof x === "object" && !(x instanceof Uint8Array)) { x = x.value ?? x.text ?? x.datetime ?? x.url ?? x.string ?? x.decimal ?? x.integer ?? x.float ?? x.boolean ?? x.point ?? (x.mantissa != null ? `${x.mantissa}e${x.exponent ?? 0}` : null) ?? safe(x); } return plain(x ?? v?.text ?? v?.datetime ?? v?.url ?? v?.string ?? null); };
const propId = (v) => aH(v?.property ?? v?.propertyId);
const rawEdits = {};
for (const m of manifest) { rawEdits[m.id] = m.contentUris.map(u => { const cid = u.replace("ipfs://", ""); const b = blobs[cid]; if (!b) return { cid, err: "fetch failed" }; try { return { cid, edit: decodeEdit(new Uint8Array(b)) }; } catch (e) { return { cid, err: "decode: " + String(e.message || e).slice(0, 80) }; } }); }
// Lossless authority for reviews. decoded.json below remains a compact preview.
// Raw ops preserve typed values, IDs, set/unset/delete, and each edit's operation order.
save('raw-edits.json', rawEdits);
save('actions.json', actions);
const ref = [];
for (const list of Object.values(rawEdits)) for (const { edit } of list) for (const o of edit?.ops || []) {
  const t = String(o.type || "");
  if (/relation/i.test(t)) { ref.push(aH(o.relationType ?? o.typeId ?? o.type_id), aH(o.to ?? o.toEntity)); }
  const vv = o.set ?? o.values ?? o.entity?.values ?? []; for (const v of (Array.isArray(vv) ? vv : [vv])) if (v) ref.push(propId(v));
}
await timed("names", () => resolveNames(ref));
save('resolved-names.json', names);
const decoded = {};
await timed("decode", async () => {
  for (const m of manifest) {
    const rec = { id: m.id, curator: m.curator, space: m.space, createdAt: m.createdAt, title: m.title, editNames: [], entities: {}, relations: [], errors: [] };
    for (const { cid, edit, err } of rawEdits[m.id]) {
      if (err) { rec.errors.push(cid.slice(0, 12) + ": " + err); continue; }
      rec.editNames.push(edit.name || "");
      for (const o of edit.ops || []) {
        const t = String(o.type || "");
        if (/relation/i.test(t)) {
          if (/delete/i.test(t)) { rec.relations.push({ del: true, id: aH(o.id) }); continue; }
          const from = aH(o.fromEntity ?? o.from ?? o.entity), to = aH(o.to ?? o.toEntity), rt = aH(o.relationType ?? o.typeId ?? o.type_id);
          rec.relations.push({ from, type: names[rt] || rt, to, toName: names[to] || null, toSpace: aH(o.toSpace) || null });
        } else if (/entity/i.test(t)) {
          const id = aH(o.id ?? o.entity?.id ?? o.entityId); if (!id) continue;
          const en = rec.entities[id] || (rec.entities[id] = { id, vals: {}, unset: [] });
          const vv = o.set ?? o.values ?? o.entity?.values ?? [];
          for (const v of (Array.isArray(vv) ? vv : [vv])) { if (!v) continue; const p = propId(v); const val = valOf(v); if (val != null) en.vals[names[p] || p] = String(val).slice(0, 300); }
          for (const u of o.unset || []) en.unset.push(names[propId(u)] || propId(u) || String(u));
        } else rec.other = (rec.other || 0) + 1;
      }
    }
    for (const en of Object.values(rec.entities)) { const mine = rec.relations.filter(r => r.from === en.id); en.types = mine.filter(r => r.type === "Types").map(r => r.toName || r.to); en.relCounts = {}; mine.forEach(r => en.relCounts[r.type] = (en.relCounts[r.type] || 0) + 1); }
    rec.copyToSpace = rec.relations.some(r => r.toSpace) && Object.keys(rec.entities).length === 0;
    rec.relationFroms = [...new Set(rec.relations.filter(r => r.from).map(r => r.from))];
    decoded[m.id] = rec;
  }
});
save("decoded.json", decoded);
for (const rec of Object.values(decoded)) if (rec.errors.length) issue("decode", `${rec.id}: ${rec.errors.join("; ")}`);
log(`decoded ${Object.keys(decoded).length} proposals: ${Object.values(decoded).reduce((a, r) => a + Object.keys(r.entities).length, 0)} entities, ${Object.values(decoded).reduce((a, r) => a + r.relations.length, 0)} relations, ${Object.values(decoded).filter(r => r.errors.length).length} with errors`);

// ---------- 7. live enrichment ----------
const touched = [...new Set(Object.values(decoded).flatMap(r => [...Object.keys(r.entities), ...r.relationFroms]))];
const live = {}; const lookup = {};
await timed("live-enrich", () => pool(chunk(touched, 50), 5, async (c) => {
  try {
    const d = await gql(`{ entities(filter:{ id:{ in:[${lit(c)}] } }, first:60){ id name createdAt spaceIds types{ name } valuesList(first:20){ property{ name } text datetime } relationsList(first:80){ type{ name } toEntity{ id name } } } }`);
    const rows = requireList(d.entities, "live entities");
    Object.assign(lookup, entityLookup(c, rows));
    c.forEach(x => live[x] = null);
    for (const e of rows) { const vals = {}; for (const v of e.valuesList || []) if (v.text || v.datetime) vals[v.property.name] = v.text || v.datetime; live[e.id] = { name: e.name, createdAt: Number(e.createdAt), createdIso: iso(e.createdAt), spaces: e.spaceIds, types: (e.types || []).map(t => t.name), vals, rels: (e.relationsList || []).map(r => [r.type.name, r.toEntity.id, r.toEntity.name]) }; }
  } catch (e) {
    c.forEach(x => { delete live[x]; });
    Object.assign(lookup, entityLookup(c, null, e));
    issue("live-enrich", `Lookup failed for ${c.length} IDs: ${e.message}`);
    log(`  enrich chunk FAILED (unknown graph state): ${String(e.message).slice(0, 80)}`);
  }
}));
save("entities-live.json", live);
save("entity-lookup.json", lookup);
log(`live-enriched ${touched.length} entities: ${Object.values(lookup).filter(v => v.status === "not-returned").length} not returned; ${Object.values(lookup).filter(v => v.status === "error").length} lookup errors (unknown, not absent)`);

// ---------- 8. news baseline + 9. bounties ----------
const BASE_SINCE = SINCE - BASELINE_DAYS * 86400;
async function newsSince(sp) { const out = []; let after = null; while (true) { const d = await gql(`{ entitiesConnection(typeId:"${T_NEWS}", spaceId:"${sp}", first:500, orderBy: CREATED_AT_DESC${after ? `, after:"${after}"` : ""}){ nodes{ id name createdAt spaceIds } pageInfo{ hasNextPage endCursor } } }`); const c = d.entitiesConnection; let stop = false; for (const n of requireList(c.nodes, "news baseline")) { if (Number(n.createdAt) < BASE_SINCE) { stop = true; break; } out.push({ id: n.id, name: n.name, createdAt: Number(n.createdAt), createdIso: iso(n.createdAt), spaces: n.spaceIds }); } if (stop || !c.pageInfo.hasNextPage) return out; if (!c.pageInfo.endCursor || c.pageInfo.endCursor === after) throw new Error("News baseline cursor did not advance"); after = c.pageInfo.endCursor; } }
async function captureList(stage, fn) {
  try { return requireList(await fn(), stage); }
  catch (e) { issue(stage, e.message); return null; }
}
const [newsMainResult, newsDsResult, bountiesMain, bountiesDs] = await timed("baseline+bounties", () => Promise.all([
  captureList("baseline-main", () => newsSince(MAIN)), captureList("baseline-datasets", () => newsSince(DS)),
  captureList("bounties-main", () => gql(`{ entities(typeId:"${T_BOUNTY}", spaceId:"${MAIN}", first:100){ id name } }`).then(d => d.entities)),
  captureList("bounties-datasets", () => gql(`{ entities(typeId:"${T_BOUNTY}", spaceId:"${DS}", first:100){ id name } }`).then(d => d.entities)),
]));
save("news-window.json", { main: newsMainResult, datasets: newsDsResult, since: new Date(BASE_SINCE * 1000).toISOString() });
save("bounties.json", { main: bountiesMain, datasets: bountiesDs });
const newsMain = newsMainResult || [], newsDs = newsDsResult || []; // partial candidate flags only; run gate blocks scoring
for (const [label, rows] of [["main", bountiesMain], ["datasets", bountiesDs]]) if (rows?.length >= 100) issue("bounties", `${label}: 100-row bounty limit reached; verify complete list`);
log(`baseline since ${iso(BASE_SINCE)}: main ${newsMainResult?.length ?? "UNKNOWN"} news, datasets ${newsDsResult?.length ?? "UNKNOWN"} news · bounties: main ${bountiesMain?.length ?? "UNKNOWN"}, datasets ${bountiesDs?.length ?? "UNKNOWN"}`);

// ---------- 10. prelim dedup + summary ----------
const STOP = new Set("the a an of to in on for and or as at by with from after over its is are new says said will has have into that this".split(" "));
const toks = (s) => new Set((s || "").toLowerCase().match(/[a-z0-9]+/g)?.filter(w => !STOP.has(w) && w.length > 2) || []);
const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / Math.max(1, a.size + b.size - i); };
const items = [];
for (const rec of Object.values(decoded)) {
  const m = manifest.find(x => x.id === rec.id);
  const ids = new Set([...Object.keys(rec.entities), ...rec.relationFroms]);
  for (const id of ids) {
    const L = live[id]; const ed = rec.entities[id];
    const types = L?.types?.length ? L.types : (ed?.types || []);
    const kind = types.includes("News story") ? "News story" : types.includes("Post") || types.includes("Tweet") ? "Post" : types.includes("Blog post") ? "Blog post" : types.includes("Claim") ? "Claim" : types.includes("Article") ? "Article" : null;
    if (!kind) continue;
    const rels = L?.rels || [];
    const attachedTo = kind === "Claim" ? [...new Set(rec.relations.filter(r => r.to === id && /Supporting|Opposing/i.test(r.type || "")).map(r => live[r.from]?.name || rec.entities[r.from]?.vals?.Name || r.from.slice(0, 8)))] : [];
    items.push({ pid: rec.id, curator: rec.curator, proposedBy: m.proposedBy, space: rec.space, when: m.createdEpoch, whenIso: rec.createdAt, id, kind, attachedTo, name: L?.name || ed?.vals?.Name || null, liveFieldsKnown: !!L, graphState: lookup[id]?.status || "error", onGraph: lookup[id]?.status === "error" ? null : !!L, spaces: L?.spaces || [], pub: L?.vals?.["Publish date"] || L?.vals?.["Publish datetime"] || ed?.vals?.["Publish date"] || null, url: L?.vals?.["Web URL"] || ed?.vals?.["Web URL"] || null, sources: L ? rels.filter(r => r[0] === "Sources").length : null, claims: L ? rels.filter(r => r[0] === "Notable claims").length : null, sup: L ? rels.filter(r => r[0] === "Supporting arguments").length : null, opp: L ? rels.filter(r => r[0] === "Opposing arguments").length : null, topics: rels.filter(r => r[0] === "Topics").map(r => r[2]), dualResidency: L ? kind === "News story" && (L.spaces || []).includes(MAIN) && rec.space === "datasets" : null, flags: [] });
  }
}
const baseline = [...newsMain.map(n => ({ ...n, where: "main" })), ...newsDs.map(n => ({ ...n, where: "datasets" }))];
const newsItems = items.filter(i => i.kind === "News story");
for (const i of newsItems) {
  const tk = toks(i.name);
  for (const b of baseline) { if (b.id === i.id) continue; const s = jac(tk, toks(b.name)); if (s >= 0.45 && b.createdAt <= i.when + 60) i.flags.push({ kind: "baseline-" + b.where, id: b.id, name: b.name, createdIso: b.createdIso, score: +s.toFixed(2), earlier: b.createdAt < i.when }); }
  for (const j of newsItems) { if (j === i || j.id === i.id) continue; const s = jac(tk, toks(j.name)); if (s >= 0.45) i.flags.push({ kind: j.proposedBy === i.proposedBy ? "same-curator" : "other-curator", id: j.id, name: j.name, curator: j.curator, createdIso: j.whenIso, score: +s.toFixed(2), earlier: j.when < i.when }); }
  // dedupe flags by id keep highest
  const best = {}; for (const f of i.flags) if (!best[f.id] || best[f.id].score < f.score) best[f.id] = f; i.flags = Object.values(best).sort((a, b) => b.score - a.score);
}
save("items.json", items);

// Mechanical completeness is not editorial acceptance or payment authorization.
runStatus.complete = runStatus.issues.length === 0;
// Keep state running until every output has been saved.
runStatus.finishedAt = new Date().toISOString();
save("run-status.json", runStatus);
// summary.md
const L = [];
L.push(`# Stage 0 summary — ${spaceKey} · window ${new Date(SINCE * 1000).toISOString()} → ${new Date(UNTIL * 1000).toISOString()} · generated ${new Date().toISOString()}`, "");
L.push(runStatus.complete ? "**Mechanical checks complete. Stage 1 source/quality review still required.**" : "**INCOMPLETE — do not finalize scores, votes, payouts or the review cutoff.**", "");
for (const item of runStatus.issues) L.push(`- BLOCKER [${item.stage}]: ${item.detail}`);
for (const item of runStatus.warnings) L.push(`- WARNING [${item.stage}]: ${item.detail}`);
L.push("");
L.push(`Proposals to review: ${manifest.length} (pending ${manifest.filter(m => !m.executed).length}, no payload ${noPayload.length}). Skipped: ${skipped.length}. Baseline: main ${newsMainResult?.length ?? "UNKNOWN"} / datasets ${newsDsResult?.length ?? "UNKNOWN"} News stories since ${iso(BASE_SINCE)}.`, "");
L.push(`| Curator | proposedBy | Proposals (main/datasets) | News | Posts | Blog | Claims | Articles |`, `|---|---|---|---|---|---|---|---|`);
for (const sp of proposers) { const P = manifest.filter(m => m.proposedBy === sp); const I = items.filter(i => i.proposedBy === sp); const c = (k) => I.filter(i => i.kind === k).length; L.push(`| ${curName(sp)} | \`${sp.slice(0, 8)}\` | ${P.length} (${P.filter(p => p.space === "main").length}/${P.filter(p => p.space === "datasets").length}) | ${c("News story")} | ${c("Post")} | ${c("Blog post")} | ${c("Claim")} | ${c("Article")} |`); }
L.push("");
for (const sp of proposers) {
  L.push(`## ${curName(sp)} (\`${sp.slice(0, 8)}\`)`, "");
  { const per = xspace[sp]; if (per) { const other = Object.entries(per).filter(([k]) => k !== MAIN && k !== DS); L.push(`Cross-space: ${Object.values(per).reduce((a, b) => a + b, 0)} proposals in this window across ${Object.keys(per).length} space(s)${other.length ? "; outside " + spaceKey + ": " + other.map(([k, v]) => "`" + k.slice(0, 8) + "` " + v).join(", ") : ""}.`, ""); } }
  for (const m of manifest.filter(x => x.proposedBy === sp)) {
    const rec = decoded[m.id]; const I = items.filter(i => i.pid === m.id);
    L.push(`- \`${m.id.slice(0, 8)}\` ${m.createdAt} ${m.space} ${m.executed ? "executed" : "**PENDING**"} · edit "${rec.editNames.join('" / "') || "(no payload)"}" · bounty: ${m.bounties.map(b => b.name).join(", ") || "-"} · ${Object.keys(rec.entities).length} entities / ${rec.relations.length} relations${rec.copyToSpace ? " · **copy-to-space (relations only)**" : ""}${rec.errors.length ? " · ERR " + rec.errors.join("; ") : ""}`);
    const stories = I.filter(i => i.kind === "News story" || i.kind === "Post" || i.kind === "Blog post");
    const claims = I.filter(i => i.kind === "Claim");
    const show = stories.length ? stories : claims.slice(0, 6);   // claims inside a story are part of the story, not claim work
    for (const i of show) {
      const bits = [i.kind.toUpperCase(), i.name ? i.name.slice(0, 100) : "(no name)", i.graphState === "error" ? "LOOKUP FAILED: GRAPH STATE UNKNOWN" : i.onGraph ? "" : "NOT RETURNED (pending/deleted/unindexed unresolved)", !i.onGraph ? "LIVE FIELDS UNKNOWN: inspect decoded edit" : i.pub ? "pub " + String(i.pub).slice(0, 10) : (i.kind === "News story" ? "NO PUBLISH DATE" : ""), i.onGraph && i.kind === "News story" ? `src ${i.sources} claims ${i.claims}` : i.onGraph && i.kind === "Claim" ? `src ${i.sources} sup ${i.sup} opp ${i.opp}` : i.url ? i.url.slice(0, 60) : "", i.kind === "Claim" && i.attachedTo?.length ? "attached to: " + i.attachedTo.map(a => a.slice(0, 60)).join(" | ") : "", i.topics.length ? "topics " + i.topics.slice(0, 3).join("/") : (i.onGraph && (i.kind === "News story" || (i.kind === "Claim" && !i.attachedTo?.length)) ? "NO TOPICS" : ""), i.dualResidency ? "DUAL-RESIDENCY (own entity, already in main)" : ""].filter(Boolean);
      L.push(`    - ${bits.join(" · ")}`);
      for (const f of i.flags.slice(0, 3)) L.push(`        - ${f.earlier ? "EARLIER" : "later"} ${f.kind} ${f.createdIso} \`${f.id.slice(0, 8)}\` ${f.curator ? f.curator + ": " : ""}${(f.name || "").slice(0, 80)} (sim ${f.score})`);
    }
    if (!stories.length && claims.length > 6) L.push(`    - ... +${claims.length - 6} more claims (${claims.filter(c => c.onGraph && !c.sup && !c.opp && !c.topics.length && !c.attachedTo?.length).length} floating: no Topics, no Supporting/Opposing edge, not attached to a proposition)`);
    if (stories.length && claims.length) L.push(`    - (${claims.length} claims inside the story, counted as part of it)`);
    if (!stories.length && !claims.length && Object.keys(rec.entities).length) { const kinds = {}; for (const id of Object.keys(rec.entities)) for (const t of (live[id]?.types || rec.entities[id].types || ["?"])) kinds[t] = (kinds[t] || 0) + 1; L.push(`    - other entities: ${Object.entries(kinds).map(([k, v]) => k + " " + v).join(", ")}`); }
  }
  L.push("");
}
if (skipped.length) { L.push(`## Skipped (not curator work)`, ""); for (const p of skipped) L.push(`- \`${p.id.slice(0, 8)}\` ${iso(p.createdAt)} ${p.space} ${skipReason(p)} ${p.proposedBy.slice(0, 8)}`); L.push(""); }
if (unresolved.length) { L.push(`## Unresolved proposers (confirm with the editor)`, "", ...unresolved.map(s => `- \`${s}\` — ${manifest.filter(m => m.proposedBy === s).length} proposals: ${manifest.filter(m => m.proposedBy === s).map(m => `"${decoded[m.id].editNames[0] || m.title || ""}"`).slice(0, 4).join(", ")}`), ""); }
fs.writeFileSync(path.join(OUT, "summary.md"), L.join("\n"));
timing.total = Date.now() - t0; save("timing.json", timing);
log(`summary.md written. timing (s): ${Object.entries(timing).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}`).join(" · ")}`);

runStatus.state = runStatus.complete ? "complete" : "incomplete";
save("run-status.json", runStatus);
if (!runStatus.complete) process.exitCode = 2;
