import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const EVIDENCE_SCHEMA = 'carepoint.release-infrastructure-evidence/v1';
const GCP_PRIMARY_REGION = 'me-central2';

function requiredObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requiredArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
  return value;
}

function assertDraftBase(base) {
  const root = requiredObject(base, 'base template');
  if (root.schema !== EVIDENCE_SCHEMA) throw new Error('Base template uses an unsupported evidence schema.');
  if (root.approved !== false) throw new Error('Base template must remain approved=false.');
  if (root.overallStatus !== 'DRAFT') throw new Error('Base template must remain overallStatus=DRAFT.');
  if (root.sensitiveDataIncluded !== false) throw new Error('Base template must remain sensitiveDataIncluded=false.');
  if (root.productionAcceptance === true) throw new Error('Base template must never declare productionAcceptance=true.');
  requiredObject(root.residency, 'base template residency');
  requiredArray(root.dataDestinations, 'base template dataDestinations');
  requiredArray(root.controls, 'base template controls');
  requiredArray(root.approvals, 'base template approvals');
  return root;
}

function assertGcpExtension(extension) {
  const root = requiredObject(extension, 'GCP extension template');
  if (root.schema !== EVIDENCE_SCHEMA) throw new Error('GCP extension template uses an unsupported evidence schema.');
  if (root.productionAcceptance === true) throw new Error('GCP extension template must never declare productionAcceptance=true.');
  const provider = requiredObject(root.cloudProvider, 'GCP extension cloudProvider');
  if (provider.provider !== 'gcp') throw new Error("GCP extension cloudProvider.provider must be 'gcp'.");
  requiredArray(root.gcpResources, 'GCP extension gcpResources');
  return root;
}

export function composeGcpLiveEvidenceTemplate(baseTemplate, gcpExtensionTemplate) {
  const base = assertDraftBase(baseTemplate);
  const extension = assertGcpExtension(gcpExtensionTemplate);
  const result = structuredClone(base);

  result.approved = false;
  result.overallStatus = 'DRAFT';
  result.sensitiveDataIncluded = false;
  result.residency = {
    ...result.residency,
    jurisdiction: 'SA',
    primaryRegion: GCP_PRIMARY_REGION,
    approvedRegions: [GCP_PRIMARY_REGION],
  };
  result.cloudProvider = structuredClone(extension.cloudProvider);
  result.gcpResources = structuredClone(extension.gcpResources);

  if (result.productionAcceptance === true) {
    throw new Error('Composed GCP evidence template must never declare productionAcceptance=true.');
  }
  return result;
}

function selfTest() {
  const base = {
    schema: EVIDENCE_SCHEMA,
    approved: false,
    overallStatus: 'DRAFT',
    sensitiveDataIncluded: false,
    residency: {
      jurisdiction: 'REPLACE',
      primaryRegion: 'REPLACE',
      approvedRegions: ['REPLACE'],
      approvalRef: 'REPLACE',
      providerLocationEvidenceRef: 'REPLACE',
    },
    dataDestinations: [{ id: 'postgres-primary', applicability: 'UNDECIDED', regions: [] }],
    controls: [{ id: 'postgres-tls-version', applicability: 'UNDECIDED', status: 'BLOCKED' }],
    approvals: [{ role: 'Operations', decision: 'PENDING' }],
  };
  const extension = {
    schema: EVIDENCE_SCHEMA,
    productionAcceptance: false,
    cloudProvider: {
      provider: 'gcp',
      projectRef: 'projects/REPLACE_WITH_GCP_PROJECT_ID',
      runtimeServiceAccountRef: 'projects/REPLACE_WITH_GCP_PROJECT_ID/serviceAccounts/REPLACE_WITH_RUNTIME_SERVICE_ACCOUNT_EMAIL',
    },
    gcpResources: [{
      id: 'cloud-run-api',
      region: GCP_PRIMARY_REGION,
      resourceRef: 'projects/REPLACE_WITH_GCP_PROJECT_ID/locations/me-central2/services/REPLACE_WITH_CLOUD_RUN_SERVICE',
      evidenceRef: 'REPLACE_WITH_EVIDENCE',
    }],
  };

  const result = composeGcpLiveEvidenceTemplate(base, extension);
  assert.equal(result.approved, false);
  assert.equal(result.overallStatus, 'DRAFT');
  assert.equal(result.sensitiveDataIncluded, false);
  assert.equal(result.residency.jurisdiction, 'SA');
  assert.equal(result.residency.primaryRegion, GCP_PRIMARY_REGION);
  assert.deepEqual(result.residency.approvedRegions, [GCP_PRIMARY_REGION]);
  assert.equal(result.cloudProvider.provider, 'gcp');
  assert.equal(result.gcpResources.length, 1);
  assert.equal(base.residency.jurisdiction, 'REPLACE');
  assert.equal(extension.cloudProvider.provider, 'gcp');

  assert.throws(
    () => composeGcpLiveEvidenceTemplate({ ...base, approved: true }, extension),
    /approved=false/,
  );
  assert.throws(
    () => composeGcpLiveEvidenceTemplate(base, {
      ...extension,
      cloudProvider: { ...extension.cloudProvider, provider: 'oci' },
    }),
    /provider must be 'gcp'/,
  );
  assert.throws(
    () => composeGcpLiveEvidenceTemplate(base, { ...extension, productionAcceptance: true }),
    /productionAcceptance=true/,
  );

  console.log('GCP R3 live evidence template composer self-test passed');
}

async function main(args) {
  if (args.length === 1 && args[0] === '--self-test') {
    selfTest();
    return;
  }
  if (args.length === 4 && args[0] === '--compose') {
    const [, basePath, extensionPath, outputPath] = args;
    const [baseContent, extensionContent] = await Promise.all([
      readFile(basePath, 'utf8'),
      readFile(extensionPath, 'utf8'),
    ]);
    const composed = composeGcpLiveEvidenceTemplate(
      JSON.parse(baseContent),
      JSON.parse(extensionContent),
    );
    await writeFile(outputPath, `${JSON.stringify(composed, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({
      schema: composed.schema,
      provider: composed.cloudProvider.provider,
      jurisdiction: composed.residency.jurisdiction,
      primaryRegion: composed.residency.primaryRegion,
      approvedRegions: composed.residency.approvedRegions,
      approved: composed.approved,
      overallStatus: composed.overallStatus,
      productionAcceptance: false,
      geographicDrProven: false,
      rpoRtoProven: false,
    }));
    return;
  }
  throw new Error(
    'Usage: node .ci/compose-release-infrastructure-gcp-evidence-template.mjs --self-test | --compose <base-template.json> <gcp-extension.json> <output.json>',
  );
}

await main(process.argv.slice(2));
