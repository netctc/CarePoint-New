import { readFileSync } from 'node:fs';

const authorityPath = 'docs/v2/traceability/functional-id-authority-v1.csv';
const aliasesPath = 'docs/v2/traceability/legacy-id-aliases-v1.csv';
const reconciliationPath = 'docs/v2/traceability/pr-reconciliation-evidence-20261001.csv';

const fail = (message) => {
  throw new Error(`V2 functional ID authority invalid: ${message}`);
};

const parseCsvLine = (line) => {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      fields.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  fields.push(value);
  if (quoted) fail('unterminated quoted CSV field');
  return fields;
};

const parseCsv = (path) => {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trimEnd();
  return text.split('\n').map(parseCsvLine);
};

const authority = parseCsv(authorityPath);
const expectedHeader = [
  'canonical_id',
  'domain',
  'authority_version',
  'claimed_by_prs',
  'legacy_aliases',
  'traceability_state',
];
if (authority.length !== 231) fail(`expected header + 230 rows, got ${authority.length}`);
if (authority[0].join('|') !== expectedHeader.join('|')) fail('unexpected authority header');

const ranges = [
  ['ADM', 71, 112, 'Admin'],
  ['PAT', 83, 140, 'Patient Mobile'],
  ['DOC', 53, 90, 'Doctor Mobile'],
  ['PRV', 57, 92, 'Other Provider Mobile'],
  ['BE', 1, 56, 'Backend'],
];
const expected = new Map();
for (const [prefix, start, end, domain] of ranges) {
  for (let number = start; number <= end; number += 1) {
    expected.set(`${prefix}-${String(number).padStart(3, '0')}`, domain);
  }
}
if (expected.size !== 230) fail(`validator expected-set size is ${expected.size}`);

const seen = new Set();
const states = new Set(['MERGED_TO_MAIN', 'PARTIAL_PR_HISTORY_RECONCILIATION_REQUIRED', 'CLOSED_UNMERGED_NEEDS_RECONCILIATION', 'UNCLAIMED_OR_NOT_RECONCILED']);
for (const row of authority.slice(1)) {
  if (row.length !== expectedHeader.length) fail(`wrong column count for row ${row[0] ?? '<unknown>'}`);
  const [id, domain, version, prRefs, aliases, state] = row;
  if (!expected.has(id)) fail(`unexpected canonical ID ${id}`);
  if (seen.has(id)) fail(`duplicate canonical ID ${id}`);
  seen.add(id);
  if (expected.get(id) !== domain) fail(`wrong domain for ${id}: ${domain}`);
  if (version !== 'v1') fail(`wrong authority version for ${id}: ${version}`);
  if (!states.has(state)) fail(`invalid traceability state for ${id}: ${state}`);
  if (state === 'MERGED_TO_MAIN' && !prRefs) fail(`merged state requires PR evidence for ${id}`);
  if (state === 'PARTIAL_PR_HISTORY_RECONCILIATION_REQUIRED' && !prRefs) fail(`partial reconciliation state requires PR evidence for ${id}`);
  if (state === 'CLOSED_UNMERGED_NEEDS_RECONCILIATION' && !prRefs) fail(`closed-unmerged state requires PR evidence for ${id}`);
  if (prRefs && !/^(#\d+)(;#\d+)*$/.test(prRefs)) fail(`invalid PR references for ${id}: ${prRefs}`);
  if (aliases && !aliases.split(';').every((alias) => /^PRELIM-2026-09-18:(ADM|PAT|DOC|PRV|BE)-\d{3}$/.test(alias))) {
    fail(`invalid legacy alias namespace for ${id}: ${aliases}`);
  }
}
if (seen.size !== expected.size) fail(`expected ${expected.size} unique IDs, got ${seen.size}`);
for (const id of expected.keys()) if (!seen.has(id)) fail(`missing canonical ID ${id}`);

const aliases = parseCsv(aliasesPath);
const aliasHeader = ['legacy_namespace', 'legacy_id', 'legacy_semantics', 'canonical_target', 'match_type', 'pr_refs', 'notes'];
if (aliases[0].join('|') !== aliasHeader.join('|')) fail('unexpected alias-ledger header');
const matchTypes = new Set(['EXACT', 'SPLIT_PARTIAL', 'PARTIAL', 'BASE_EXTENSION', 'NO_EXACT_CANONICAL_MATCH']);
const aliasKeys = new Set();
for (const row of aliases.slice(1)) {
  if (row.length !== aliasHeader.length) fail(`wrong alias-ledger column count for ${row[1] ?? '<unknown>'}`);
  const [namespace, legacyId, , targets, matchType, prRefs] = row;
  if (namespace !== 'PRELIM-2026-09-18') fail(`unexpected legacy namespace ${namespace}`);
  if (!/^(ADM|PAT|DOC|PRV|BE)-\d{3}$/.test(legacyId)) fail(`invalid legacy ID ${legacyId}`);
  const key = `${namespace}:${legacyId}`;
  if (aliasKeys.has(key)) fail(`duplicate legacy alias ${key}`);
  aliasKeys.add(key);
  if (!matchTypes.has(matchType)) fail(`invalid match type for ${key}: ${matchType}`);
  if (prRefs && !/^(#\d+)(;#\d+)*$/.test(prRefs)) fail(`invalid alias PR refs for ${key}: ${prRefs}`);
  if (targets) {
    for (const target of targets.split(';')) if (!expected.has(target)) fail(`alias ${key} targets non-canonical ID ${target}`);
  }
}

const aliasRows = new Map(aliases.slice(1).map((row) => [`${row[0]}:${row[1]}`, row]));
const expectAlias = (key, target, type) => {
  const row = aliasRows.get(key);
  if (!row) fail(`required collision record missing: ${key}`);
  if (row[3] !== target || row[4] !== type) fail(`wrong collision resolution for ${key}`);
};
expectAlias('PRELIM-2026-09-18:PAT-001', 'PAT-083', 'EXACT');
expectAlias('PRELIM-2026-09-18:BE-038', 'BE-033', 'EXACT');
expectAlias('PRELIM-2026-09-18:BE-050', '', 'NO_EXACT_CANONICAL_MATCH');

console.log(`V2 functional ID authority OK: ${seen.size} canonical IDs, ${aliases.length - 1} legacy alias records.`);


const reconciliation = parseCsv(reconciliationPath);
const reconciliationHeader = [
  'pr_number',
  'github_state',
  'merged',
  'merged_at',
  'authority_row_references',
  'superseded_by_pr',
];
if (reconciliation[0].join('|') !== reconciliationHeader.join('|')) {
  fail('unexpected PR reconciliation evidence header');
}
const prEvidence = new Map();
for (const row of reconciliation.slice(1)) {
  if (row.length !== reconciliationHeader.length) {
    fail(`wrong PR reconciliation evidence column count for ${row[0] ?? '<unknown>'}`);
  }
  const [prRef, githubState, merged, mergedAt, referenceCount, supersededBy] = row;
  if (!/^#\d+$/.test(prRef)) fail(`invalid reconciliation PR reference ${prRef}`);
  if (prEvidence.has(prRef)) fail(`duplicate reconciliation PR reference ${prRef}`);
  if (githubState !== 'closed') fail(`unexpected GitHub state for ${prRef}: ${githubState}`);
  if (merged !== 'true' && merged !== 'false') fail(`invalid merged flag for ${prRef}`);
  if (merged === 'true' && !mergedAt) fail(`merged PR ${prRef} requires merged_at evidence`);
  if (merged === 'false' && mergedAt) fail(`unmerged PR ${prRef} must not carry merged_at evidence`);
  if (!/^\d+$/.test(referenceCount)) fail(`invalid authority reference count for ${prRef}`);
  if (supersededBy && !/^#\d+$/.test(supersededBy)) fail(`invalid superseded_by_pr for ${prRef}`);
  prEvidence.set(prRef, { merged: merged === 'true', referenceCount: Number(referenceCount), supersededBy });
}

const authorityPrUsage = new Map();
for (const row of authority.slice(1)) {
  const [id, , , prRefs, , state] = row;
  const refs = prRefs ? prRefs.split(';') : [];
  for (const ref of refs) authorityPrUsage.set(ref, (authorityPrUsage.get(ref) ?? 0) + 1);
  if (state === 'MERGED_TO_MAIN') {
    if (!refs.length || !refs.every((ref) => prEvidence.get(ref)?.merged === true)) {
      fail(`MERGED_TO_MAIN requires merged PR evidence for ${id}`);
    }
  }
  if (state === 'PARTIAL_PR_HISTORY_RECONCILIATION_REQUIRED') {
    const states = refs.map((ref) => prEvidence.get(ref)?.merged);
    if (!states.includes(true) || !states.includes(false)) {
      fail(`partial reconciliation state requires mixed merged/unmerged PR evidence for ${id}`);
    }
  }
  if (state === 'CLOSED_UNMERGED_NEEDS_RECONCILIATION') {
    if (!refs.length || !refs.every((ref) => prEvidence.get(ref)?.merged === false)) {
      fail(`closed-unmerged state requires only unmerged PR evidence for ${id}`);
    }
  }
}
for (const [prRef, evidence] of prEvidence.entries()) {
  const actual = authorityPrUsage.get(prRef) ?? 0;
  if (actual !== evidence.referenceCount) {
    fail(`PR evidence reference count mismatch for ${prRef}: expected ${evidence.referenceCount}, actual ${actual}`);
  }
}
if (prEvidence.get('#281')?.supersededBy !== '#320') {
  fail('DOC-061 historical PR #281 must remain recorded as superseded by clean integration PR #320');
}
const doc061 = authority.slice(1).find((row) => row[0] === 'DOC-061');
if (!doc061 || doc061[3] !== '#320' || doc061[5] !== 'MERGED_TO_MAIN') {
  fail('DOC-061 must point to merged clean integration PR #320');
}

console.log(`V2 PR reconciliation evidence OK: ${prEvidence.size} PR records.`);
