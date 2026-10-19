// Pure checks shared by Stage 0 and its offline regression tests.
export function requireList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}: expected a list, received missing/invalid data`);
  return value;
}

export function feedCoverage(rows, since, limit) {
  requireList(rows, 'proposal feed');
  const timestamps = rows.map(p => Number(p.createdAt));
  if (timestamps.some(t => !Number.isFinite(t))) throw new Error('proposal feed: invalid createdAt');
  const oldest = rows.length ? Math.min(...timestamps) : null;
  // Equality is not sufficient: more proposals can share the cutoff timestamp.
  const complete = rows.length < limit || oldest < since;
  return { complete, count: rows.length, limit, oldest, reason: complete ? null : 'Feed limit reached before the entire window was covered; narrow the window and retain all boundary proposal IDs.' };
}

export function entityLookup(ids, entities, error = null) {
  const result = {};
  if (error) {
    for (const id of ids) result[id] = { status: 'error', error: String(error.message || error) };
    return result;
  }
  const found = new Set(requireList(entities, 'live entities').map(e => e.id.replace(/-/g, '').toLowerCase()));
  for (const id of ids) result[id] = { status: found.has(id) ? 'found' : 'not-returned' };
  return result;
}

export function validateInputs({ since, until, editor, injector, curators, concurrency, baselineDays }) {
  if (!Number.isFinite(since) || !Number.isFinite(until) || since > until) throw new Error('Use valid --since/--until datetimes with since <= until');
  const validId = id => /^[0-9a-f]{32}$/.test(id);
  if (!validId(editor)) throw new Error('--editor must be a full personal-space ID');
  if (injector && !validId(injector)) throw new Error('--injector must be a full personal-space ID');
  if (curators.some(id => !validId(id))) throw new Error('--curator must be a full proposedBy ID, not a display name');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('--concurrency must be an integer from 1 to 32');
  if (!Number.isFinite(baselineDays) || baselineDays < 0) throw new Error('--baseline-days must be a non-negative number');
}
