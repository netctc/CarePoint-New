import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateEvidence } from './release-infrastructure-evidence-contract.mjs';

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const GCP_PRIMARY_REGION = 'me-central2';
const GCP_RESOURCE_DOMAINS = [
  'cloud-run-api',
  'postgres-primary',
  'postgres-ha-replicas',
  'postgres-backups-pitr',
  'redis-primary',
  'redis-ha-replicas',
  'clinical-object-storage',
  'fhir-bulk-artifacts',
  'kms-key-material',
  'document-signing-key',
  'external-secrets',
  'external-application-load-balancer',
  'managed-tls-certificate',
  'cloud-armor-policy',
  'worker-scheduler-model',
];
const GCS_DOMAINS = new Set(['clinical-object-storage', 'fhir-bulk-artifacts']);
const CONTRACT_DOMAINS = new Set(['worker-scheduler-model']);

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

function assertProjectRef(value, label) {
  const ref = string(value, label);
  if (!/^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]$/i.test(ref)) {
    throw new Error(`${label} must use projects/<gcp-project-id>.`);
  }
  return ref;
}

function assertServiceAccountRef(value, label) {
  const ref = string(value, label);
  if (!/^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/serviceAccounts\/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(ref)) {
    throw new Error(`${label} must be a GCP service-account resource reference.`);
  }
  return ref;
}

function assertGenericGcpResourceRef(value, label) {
  const ref = string(value, label);
  if (!/^projects\/[A-Za-z0-9._:-]+\/(?:locations\/[^/\s]+\/|global\/)?[^\s]+$/.test(ref)) {
    throw new Error(`${label} must be a GCP projects/... resource reference.`);
  }
  return ref;
}

function assertGcsRef(value, label) {
  const ref = string(value, label);
  if (!/^gcs:\/\/[^/\s]+$/i.test(ref)) {
    throw new Error(`${label} must use gcs://<bucket>.`);
  }
  return ref;
}

function assertContractRef(value, label) {
  const ref = string(value, label);
  if (!/^carepoint-contract:\/\/[^\s]+$/i.test(ref)) {
    throw new Error(`${label} must use carepoint-contract://<contract-ref>.`);
  }
  return ref;
}

function validateKsaResidency(root) {
  const residency = object(root.residency, 'residency');
  if (string(residency.jurisdiction, 'residency.jurisdiction').toUpperCase() !== 'SA') {
    throw new Error("GCP Release 1 infrastructure evidence residency.jurisdiction must be 'SA'.");
  }
  if (string(residency.primaryRegion, 'residency.primaryRegion', 120) !== GCP_PRIMARY_REGION) {
    throw new Error(`GCP Release 1 infrastructure evidence primary region must be '${GCP_PRIMARY_REGION}'.`);
  }
  const approved = stringArray(residency.approvedRegions, 'residency.approvedRegions');
  if (!approved.includes(GCP_PRIMARY_REGION)) {
    throw new Error(`GCP Release 1 infrastructure evidence must include '${GCP_PRIMARY_REGION}' in approved regions.`);
  }
  for (const region of approved) {
    if (region !== GCP_PRIMARY_REGION) {
      throw new Error(`GCP infrastructure evidence region '${region}' is outside the currently approved Release 1 GCP KSA region set.`);
    }
  }
  return new Set(approved);
}

export function validateGcpInfrastructureOverlay(evidence) {
  const root = object(evidence, 'evidence');
  if (root.schema !== 'carepoint.release-infrastructure-evidence/v1') {
    throw new Error('GCP extension requires carepoint.release-infrastructure-evidence/v1.');
  }

  const approvedRegions = validateKsaResidency(root);
  const provider = object(root.cloudProvider, 'cloudProvider');
  if (string(provider.provider, 'cloudProvider.provider', 20).toLowerCase() !== 'gcp') {
    throw new Error("cloudProvider.provider must be 'gcp' for the GCP Release 1 evidence extension.");
  }
  const projectRef = assertProjectRef(provider.projectRef, 'cloudProvider.projectRef');
  const runtimeServiceAccountRef = assertServiceAccountRef(
    provider.runtimeServiceAccountRef,
    'cloudProvider.runtimeServiceAccountRef',
  );
  const projectId = projectRef.slice('projects/'.length);
  if (!runtimeServiceAccountRef.startsWith(`${projectRef}/serviceAccounts/`)) {
    throw new Error('cloudProvider.runtimeServiceAccountRef must belong to cloudProvider.projectRef.');
  }

  if (!Array.isArray(root.gcpResources)) throw new Error('gcpResources must be an array.');
  const resources = new Map();
  for (const item of root.gcpResources) {
    const resource = object(item, 'gcpResources record');
    const id = string(resource.id, 'gcpResources.id', 100);
    if (!GCP_RESOURCE_DOMAINS.includes(id)) throw new Error(`Unexpected GCP resource domain ${id}.`);
    if (resources.has(id)) throw new Error(`Duplicate GCP resource domain ${id}.`);
    const region = string(resource.region, `${id}.region`, 120);
    if (!approvedRegions.has(region)) throw new Error(`${id}.region '${region}' is outside residency.approvedRegions.`);

    if (GCS_DOMAINS.has(id)) {
      assertGcsRef(resource.resourceRef, `${id}.resourceRef`);
    } else if (CONTRACT_DOMAINS.has(id)) {
      assertContractRef(resource.resourceRef, `${id}.resourceRef`);
    } else {
      const ref = assertGenericGcpResourceRef(resource.resourceRef, `${id}.resourceRef`);
      if (!ref.startsWith(`projects/${projectId}/`)) {
        throw new Error(`${id}.resourceRef must belong to cloudProvider.projectRef.`);
      }
    }
    string(resource.evidenceRef, `${id}.evidenceRef`);
    resources.set(id, resource);
  }
  for (const id of GCP_RESOURCE_DOMAINS) {
    if (!resources.has(id)) throw new Error(`Missing required GCP resource domain ${id}.`);
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
    provider: 'gcp',
    jurisdiction: 'SA',
    primaryRegion: GCP_PRIMARY_REGION,
    approvedRegions: [...approvedRegions],
    projectRef,
    resourceDomainsValidated: GCP_RESOURCE_DOMAINS.length,
    telemetryDestinationsValidated: 2,
  };
}

export async function validateGcpInfrastructureEvidence(evidence, options = {}) {
  const base = await validateEvidence(evidence, options);
  const gcp = validateGcpInfrastructureOverlay(evidence);
  return {
    ...base,
    cloudProvider: gcp.provider,
    gcpProjectRef: gcp.projectRef,
    gcpResourceDomainsValidated: gcp.resourceDomainsValidated,
  };
}

function validateGcpTemplate(template) {
  const root = object(template, 'template');
  if (root.schema !== 'carepoint.release-infrastructure-evidence/v1') {
    throw new Error('GCP template requires the v1 infrastructure evidence schema.');
  }
  if (root.productionAcceptance === true) {
    throw new Error('GCP extension template must never declare productionAcceptance=true.');
  }
  const provider = object(root.cloudProvider, 'template.cloudProvider');
  if (provider.provider !== 'gcp') throw new Error("template.cloudProvider.provider must be 'gcp'.");
  string(provider.projectRef, 'template.cloudProvider.projectRef');
  string(provider.runtimeServiceAccountRef, 'template.cloudProvider.runtimeServiceAccountRef');
  if (!Array.isArray(root.gcpResources)) throw new Error('template.gcpResources must be an array.');
  const ids = root.gcpResources.map((item) => string(object(item, 'template GCP resource').id, 'template.gcpResources.id', 100));
  for (const id of GCP_RESOURCE_DOMAINS) {
    if (!ids.includes(id)) throw new Error(`Template is missing GCP resource domain ${id}.`);
  }
  if (new Set(ids).size !== ids.length) throw new Error('template.gcpResources must not contain duplicate domains.');
  for (const id of ids) {
    if (!GCP_RESOURCE_DOMAINS.includes(id)) throw new Error(`Template contains unexpected GCP resource domain ${id}.`);
  }
  return {
    schema: root.schema,
    provider: 'gcp',
    primaryRegion: GCP_PRIMARY_REGION,
    requiredGcpResourceDomains: GCP_RESOURCE_DOMAINS.length,
    productionAcceptance: false,
  };
}

function syntheticResourceRef(id, projectId, index) {
  if (GCS_DOMAINS.has(id)) return `gcs://carepoint-${id}`;
  if (CONTRACT_DOMAINS.has(id)) return 'carepoint-contract://release-1/gcp/worker-scheduler-model';
  if (id === 'external-application-load-balancer') return `projects/${projectId}/global/backendServices/carepoint-api`;
  if (id === 'managed-tls-certificate') return `projects/${projectId}/global/sslCertificates/carepoint-api`;
  if (id === 'cloud-armor-policy') return `projects/${projectId}/global/securityPolicies/carepoint-api`;
  return `projects/${projectId}/locations/${GCP_PRIMARY_REGION}/resources/${String(index).padStart(2, '0')}-${id}`;
}

function syntheticOverlay() {
  const projectId = 'carepoint-prod-sa1';
  return {
    schema: 'carepoint.release-infrastructure-evidence/v1',
    residency: {
      jurisdiction: 'SA',
      primaryRegion: GCP_PRIMARY_REGION,
      approvedRegions: [GCP_PRIMARY_REGION],
    },
    cloudProvider: {
      provider: 'gcp',
      projectRef: `projects/${projectId}`,
      runtimeServiceAccountRef: `projects/${projectId}/serviceAccounts/carepoint-runtime@${projectId}.iam.gserviceaccount.com`,
    },
    dataDestinations: [
      { id: 'otlp-processing', regions: [GCP_PRIMARY_REGION] },
      { id: 'siem-processing', regions: [GCP_PRIMARY_REGION] },
    ],
    gcpResources: GCP_RESOURCE_DOMAINS.map((id, index) => ({
      id,
      region: GCP_PRIMARY_REGION,
      resourceRef: syntheticResourceRef(id, projectId, index),
      evidenceRef: `evidence:${id}`,
    })),
  };
}

function expectOverlayReject(label, mutate) {
  const value = structuredClone(syntheticOverlay());
  mutate(value);
  let rejected = false;
  try {
    validateGcpInfrastructureOverlay(value);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`GCP evidence self-test expected rejection: ${label}`);
}

function selfTest() {
  const valid = validateGcpInfrastructureOverlay(syntheticOverlay());
  if (valid.provider !== 'gcp' || valid.resourceDomainsValidated !== GCP_RESOURCE_DOMAINS.length) {
    throw new Error('Synthetic GCP infrastructure evidence overlay did not validate.');
  }
  expectOverlayReject('wrong provider', (value) => { value.cloudProvider.provider = 'oci'; });
  expectOverlayReject('wrong primary region', (value) => { value.residency.primaryRegion = 'me-riyadh-1'; });
  expectOverlayReject('invented second GCP region', (value) => { value.residency.approvedRegions.push('us-central1'); });
  expectOverlayReject('missing required GCP resource', (value) => { value.gcpResources.pop(); });
  expectOverlayReject('resource in another project', (value) => {
    value.gcpResources.find((item) => item.id === 'cloud-run-api').resourceRef =
      `projects/other-project/locations/${GCP_PRIMARY_REGION}/services/carepoint`;
  });
  expectOverlayReject('invalid GCS ref', (value) => {
    value.gcpResources.find((item) => item.id === 'clinical-object-storage').resourceRef = 's3://carepoint-clinical';
  });
  expectOverlayReject('out-of-region OTLP processing', (value) => { value.dataDestinations[0].regions = ['us-central1']; });
  expectOverlayReject('out-of-region SIEM processing', (value) => { value.dataDestinations[1].regions = ['europe-west1']; });
  console.log(`GCP Release 1 infrastructure evidence extension self-test passed (${GCP_RESOURCE_DOMAINS.length} resource domains).`);
}

async function contractEvidence(templatePath, outputPath) {
  const scriptPath = fileURLToPath(import.meta.url);
  const [scriptContent, templateContent] = await Promise.all([readFile(scriptPath), readFile(templatePath)]);
  const template = JSON.parse(templateContent.toString('utf8'));
  const summary = validateGcpTemplate(template);
  const evidence = {
    schema: 'carepoint.release-infrastructure-gcp-extension-contract/v1',
    sourceSha: currentGitSha(),
    evidenceSchema: summary.schema,
    provider: summary.provider,
    primaryRegion: summary.primaryRegion,
    productionAcceptance: false,
    requiredGcpResourceDomains: summary.requiredGcpResourceDomains,
    geographicDrProven: false,
    rpoRtoProven: false,
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
    console.log(JSON.stringify(validateGcpTemplate(template)));
    return;
  }
  if (args.length === 3 && args[0] === '--contract-evidence') {
    await contractEvidence(args[1], args[2]);
    return;
  }
  if ((args.length === 2 || args.length === 4) && args[0] === '--validate') {
    const evidence = JSON.parse(await readFile(args[1], 'utf8'));
    const result = await validateGcpInfrastructureEvidence(evidence);
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
