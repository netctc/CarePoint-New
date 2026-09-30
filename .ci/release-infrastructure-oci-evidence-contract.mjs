import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateEvidence } from './release-infrastructure-evidence-contract.mjs';

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const OCI_PRIMARY_REGION = 'me-riyadh-1';
const OCI_DR_REGION = 'me-jeddah-1';
const OCI_KSA_REGIONS = new Set([OCI_PRIMARY_REGION, OCI_DR_REGION]);
const OCI_RESOURCE_DOMAINS = [
  'postgres-primary',
  'postgres-ha-replicas',
  'postgres-backups-pitr',
  'redis-primary',
  'redis-ha-replicas',
  'clinical-object-storage',
  'fhir-bulk-artifacts',
  'kms-key-material',
  'external-secrets',
];
const OBJECT_STORAGE_DOMAINS = new Set(['clinical-object-storage', 'fhir-bulk-artifacts']);

function command(commandName, args) {
  return execFileSync(commandName, args, { encoding: 'utf8' }).trim();
}

function currentGitSha() {
  const value = command('git', ['rev-parse', 'HEAD']).toLowerCase();
  if (!FULL_GIT_SHA.test(value)) throw new Error('Unable to resolve a full current Git SHA.');
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function string(value, label, maxLength = 500) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string.`);
  const result = value.trim();
  if (result.length > maxLength || /[\r\n\0]/.test(result)) throw new Error(`${label} must be one line and at most ${maxLength} characters.`);
  return result;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.length < 1) throw new Error(`${label} must be a non-empty array.`);
  const result = value.map((item, index) => string(item, `${label}[${index}]`, 120));
  if (new Set(result).size !== result.length) throw new Error(`${label} must not contain duplicates.`);
  return result;
}

function assertOcid(value, type, label) {
  const ref = string(value, label);
  const prefix = `ocid1.${type}.`;
  if (!ref.startsWith(prefix) || ref.length <= prefix.length + 8 || /\s/.test(ref)) {
    throw new Error(`${label} must be an OCI ${type} OCID.`);
  }
  return ref;
}

function assertGenericOciResourceRef(value, label) {
  const ref = string(value, label);
  if (!/^ocid1\.[a-z0-9-]+\./i.test(ref) || /\s/.test(ref)) {
    throw new Error(`${label} must be an OCI OCID.`);
  }
  return ref;
}

function assertObjectStorageRef(value, label) {
  const ref = string(value, label);
  if (!/^oci-object-storage:\/\/[^/\s]+\/[^/\s]+$/i.test(ref)) {
    throw new Error(`${label} must use oci-object-storage://<namespace>/<bucket>.`);
  }
  return ref;
}

function validateKsaResidency(root) {
  const residency = object(root.residency, 'residency');
  if (string(residency.jurisdiction, 'residency.jurisdiction').toUpperCase() !== 'SA') {
    throw new Error("OCI Release 1 infrastructure evidence residency.jurisdiction must be 'SA'.");
  }
  if (string(residency.primaryRegion, 'residency.primaryRegion', 120) !== OCI_PRIMARY_REGION) {
    throw new Error(`OCI Release 1 infrastructure evidence primary region must be '${OCI_PRIMARY_REGION}'.`);
  }
  const approved = stringArray(residency.approvedRegions, 'residency.approvedRegions');
  if (!approved.includes(OCI_PRIMARY_REGION) || !approved.includes(OCI_DR_REGION)) {
    throw new Error('OCI Release 1 infrastructure evidence must include both Riyadh and Jeddah approved regions.');
  }
  for (const region of approved) {
    if (!OCI_KSA_REGIONS.has(region)) throw new Error(`OCI infrastructure evidence region '${region}' is outside the accepted KSA region set.`);
  }
  return new Set(approved);
}

export function validateOciInfrastructureOverlay(evidence) {
  const root = object(evidence, 'evidence');
  if (root.schema !== 'carepoint.release-infrastructure-evidence/v1') {
    throw new Error('OCI extension requires carepoint.release-infrastructure-evidence/v1.');
  }

  const approvedRegions = validateKsaResidency(root);
  const provider = object(root.cloudProvider, 'cloudProvider');
  if (string(provider.provider, 'cloudProvider.provider', 20).toLowerCase() !== 'oci') {
    throw new Error("cloudProvider.provider must be 'oci' for the OCI Release 1 evidence extension.");
  }
  assertOcid(provider.tenancyRef, 'tenancy', 'cloudProvider.tenancyRef');
  assertOcid(provider.compartmentRef, 'compartment', 'cloudProvider.compartmentRef');

  if (!Array.isArray(root.ociResources)) throw new Error('ociResources must be an array.');
  const resources = new Map();
  for (const item of root.ociResources) {
    const resource = object(item, 'ociResources record');
    const id = string(resource.id, 'ociResources.id', 100);
    if (!OCI_RESOURCE_DOMAINS.includes(id)) throw new Error(`Unexpected OCI resource domain ${id}.`);
    if (resources.has(id)) throw new Error(`Duplicate OCI resource domain ${id}.`);
    const region = string(resource.region, `${id}.region`, 120);
    if (!approvedRegions.has(region)) throw new Error(`${id}.region '${region}' is outside residency.approvedRegions.`);
    if (OBJECT_STORAGE_DOMAINS.has(id)) assertObjectStorageRef(resource.resourceRef, `${id}.resourceRef`);
    else assertGenericOciResourceRef(resource.resourceRef, `${id}.resourceRef`);
    string(resource.evidenceRef, `${id}.evidenceRef`);
    resources.set(id, resource);
  }
  for (const id of OCI_RESOURCE_DOMAINS) {
    if (!resources.has(id)) throw new Error(`Missing required OCI resource domain ${id}.`);
  }

  const destinations = new Map((root.dataDestinations ?? []).map((item) => [item?.id, item]));
  for (const id of ['otlp-processing', 'siem-processing']) {
    const destination = object(destinations.get(id), `dataDestinations.${id}`);
    const regions = stringArray(destination.regions, `${id}.regions`);
    for (const region of regions) {
      if (!approvedRegions.has(region)) throw new Error(`${id} declares unapproved residency region ${region}.`);
    }
  }

  return {
    provider: 'oci',
    jurisdiction: 'SA',
    primaryRegion: OCI_PRIMARY_REGION,
    approvedRegions: [...approvedRegions],
    resourceDomainsValidated: OCI_RESOURCE_DOMAINS.length,
    telemetryDestinationsValidated: 2,
  };
}

export async function validateOciInfrastructureEvidence(evidence, options = {}) {
  const base = await validateEvidence(evidence, options);
  const oci = validateOciInfrastructureOverlay(evidence);
  return { ...base, cloudProvider: oci.provider, ociResourceDomainsValidated: oci.resourceDomainsValidated };
}

function validateOciTemplate(template) {
  const root = object(template, 'template');
  if (root.schema !== 'carepoint.release-infrastructure-evidence/v1') throw new Error('OCI template requires the v1 infrastructure evidence schema.');
  const provider = object(root.cloudProvider, 'template.cloudProvider');
  if (provider.provider !== 'oci') throw new Error("template.cloudProvider.provider must be 'oci'.");
  string(provider.tenancyRef, 'template.cloudProvider.tenancyRef');
  string(provider.compartmentRef, 'template.cloudProvider.compartmentRef');
  if (!Array.isArray(root.ociResources)) throw new Error('template.ociResources must be an array.');
  const ids = root.ociResources.map((item) => string(object(item, 'template OCI resource').id, 'template.ociResources.id', 100));
  for (const id of OCI_RESOURCE_DOMAINS) if (!ids.includes(id)) throw new Error(`Template is missing OCI resource domain ${id}.`);
  if (new Set(ids).size !== ids.length) throw new Error('template.ociResources must not contain duplicate domains.');
  return { schema: root.schema, provider: 'oci', requiredOciResourceDomains: OCI_RESOURCE_DOMAINS.length, productionAcceptance: false };
}

function syntheticOverlay() {
  return {
    schema: 'carepoint.release-infrastructure-evidence/v1',
    residency: {
      jurisdiction: 'SA',
      primaryRegion: OCI_PRIMARY_REGION,
      approvedRegions: [OCI_PRIMARY_REGION, OCI_DR_REGION],
    },
    cloudProvider: {
      provider: 'oci',
      tenancyRef: 'ocid1.tenancy.oc1..carepointsynthetictenancy0001',
      compartmentRef: 'ocid1.compartment.oc1..carepointsyntheticprod0001',
    },
    dataDestinations: [
      { id: 'otlp-processing', regions: [OCI_PRIMARY_REGION] },
      { id: 'siem-processing', regions: [OCI_PRIMARY_REGION] },
    ],
    ociResources: OCI_RESOURCE_DOMAINS.map((id, index) => ({
      id,
      region: index === 1 ? OCI_DR_REGION : OCI_PRIMARY_REGION,
      resourceRef: OBJECT_STORAGE_DOMAINS.has(id)
        ? `oci-object-storage://carepointns/${id}`
        : `ocid1.resource.oc1.${OCI_PRIMARY_REGION}.carepoint${String(index).padStart(4, '0')}`,
      evidenceRef: `evidence:${id}`,
    })),
  };
}

function expectOverlayReject(label, mutate) {
  const value = structuredClone(syntheticOverlay());
  mutate(value);
  let rejected = false;
  try {
    validateOciInfrastructureOverlay(value);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`OCI evidence self-test expected rejection: ${label}`);
}

function selfTest() {
  const valid = validateOciInfrastructureOverlay(syntheticOverlay());
  if (valid.provider !== 'oci' || valid.resourceDomainsValidated !== OCI_RESOURCE_DOMAINS.length) {
    throw new Error('Synthetic OCI infrastructure evidence overlay did not validate.');
  }
  expectOverlayReject('wrong provider', (value) => { value.cloudProvider.provider = 'aws'; });
  expectOverlayReject('wrong primary region', (value) => { value.residency.primaryRegion = OCI_DR_REGION; });
  expectOverlayReject('outside KSA approved regions', (value) => { value.residency.approvedRegions.push('eu-frankfurt-1'); });
  expectOverlayReject('missing required OCI resource', (value) => { value.ociResources.pop(); });
  expectOverlayReject('invalid OCI resource ref', (value) => { value.ociResources[0].resourceRef = 'arn:aws:rds:me-central-1:123:db:test'; });
  expectOverlayReject('out-of-region OTLP processing', (value) => { value.dataDestinations[0].regions = ['eu-frankfurt-1']; });
  expectOverlayReject('out-of-region SIEM processing', (value) => { value.dataDestinations[1].regions = ['eu-frankfurt-1']; });
  console.log(`OCI Release 1 infrastructure evidence extension self-test passed (${OCI_RESOURCE_DOMAINS.length} resource domains).`);
}

async function contractEvidence(templatePath, outputPath) {
  const scriptPath = fileURLToPath(import.meta.url);
  const [scriptContent, templateContent] = await Promise.all([readFile(scriptPath), readFile(templatePath)]);
  const template = JSON.parse(templateContent.toString('utf8'));
  const summary = validateOciTemplate(template);
  const evidence = {
    schema: 'carepoint.release-infrastructure-oci-extension-contract/v1',
    sourceSha: currentGitSha(),
    evidenceSchema: summary.schema,
    provider: summary.provider,
    productionAcceptance: false,
    requiredOciResourceDomains: summary.requiredOciResourceDomains,
    contractSha256: `sha256:${sha256(scriptContent)}`,
    templateSha256: `sha256:${sha256(templateContent)}`,
  };
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') {
    selfTest();
    return;
  }
  if (args.length === 2 && args[0] === '--validate-template') {
    const template = JSON.parse(await readFile(args[1], 'utf8'));
    console.log(JSON.stringify(validateOciTemplate(template)));
    return;
  }
  if (args.length === 3 && args[0] === '--contract-evidence') {
    await contractEvidence(args[1], args[2]);
    return;
  }
  if ((args.length === 2 || args.length === 4) && args[0] === '--validate') {
    const evidence = JSON.parse(await readFile(args[1], 'utf8'));
    const result = await validateOciInfrastructureEvidence(evidence);
    if (args.length === 4) {
      if (args[2] !== '--out') throw new Error('Expected --out <path>.');
      await writeFile(args[3], `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result));
    return;
  }
  throw new Error('Usage: --self-test | --validate-template <file> | --contract-evidence <template> <out> | --validate <evidence> [--out <result>]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
