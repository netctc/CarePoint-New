import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const EVIDENCE_SCHEMA = 'carepoint.release-infrastructure-evidence/v1';
const OCI_PRIMARY_REGION = 'me-riyadh-1';
const OCI_DR_REGION = 'me-jeddah-1';

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

function assertOciExtension(extension) {
  const root = requiredObject(extension, 'OCI extension template');
  if (root.schema !== EVIDENCE_SCHEMA) throw new Error('OCI extension template uses an unsupported evidence schema.');
  if (root.productionAcceptance === true) throw new Error('OCI extension template must never declare productionAcceptance=true.');
  const provider = requiredObject(root.cloudProvider, 'OCI extension cloudProvider');
  if (provider.provider !== 'oci') throw new Error("OCI extension cloudProvider.provider must be 'oci'.");
  requiredArray(root.ociResources, 'OCI extension ociResources');
  return root;
}

export function composeOciLiveEvidenceTemplate(baseTemplate, ociExtensionTemplate) {
  const base = assertDraftBase(baseTemplate);
  const extension = assertOciExtension(ociExtensionTemplate);
  const result = structuredClone(base);

  result.approved = false;
  result.overallStatus = 'DRAFT';
  result.sensitiveDataIncluded = false;
  result.residency = {
    ...result.residency,
    jurisdiction: 'SA',
    primaryRegion: OCI_PRIMARY_REGION,
    approvedRegions: [OCI_PRIMARY_REGION, OCI_DR_REGION],
  };
  result.cloudProvider = structuredClone(extension.cloudProvider);
  result.ociResources = structuredClone(extension.ociResources);

  if (result.productionAcceptance === true) {
    throw new Error('Composed OCI evidence template must never declare productionAcceptance=true.');
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
    dataDestinations: [{ id: 'postgres-primary' }],
    controls: [{ id: 'postgres-tls-version' }],
    approvals: [{ role: 'Operations' }],
  };
  const extension = {
    schema: EVIDENCE_SCHEMA,
    cloudProvider: {
      provider: 'oci',
      tenancyRef: 'REPLACE_WITH_OCI_TENANCY_OCID',
      compartmentRef: 'REPLACE_WITH_OCI_PRODUCTION_COMPARTMENT_OCID',
    },
    ociResources: [{
      id: 'postgres-primary',
      region: OCI_PRIMARY_REGION,
      resourceRef: 'REPLACE_WITH_OCI_POSTGRES_PRIMARY_OCID',
      evidenceRef: 'REPLACE_WITH_EVIDENCE',
    }],
  };

  const result = composeOciLiveEvidenceTemplate(base, extension);
  assert.equal(result.approved, false);
  assert.equal(result.overallStatus, 'DRAFT');
  assert.equal(result.sensitiveDataIncluded, false);
  assert.equal(result.residency.jurisdiction, 'SA');
  assert.equal(result.residency.primaryRegion, OCI_PRIMARY_REGION);
  assert.deepEqual(result.residency.approvedRegions, [OCI_PRIMARY_REGION, OCI_DR_REGION]);
  assert.equal(result.cloudProvider.provider, 'oci');
  assert.equal(result.ociResources.length, 1);
  assert.equal(base.residency.jurisdiction, 'REPLACE');
  assert.equal(extension.cloudProvider.provider, 'oci');

  assert.throws(
    () => composeOciLiveEvidenceTemplate({ ...base, approved: true }, extension),
    /approved=false/,
  );
  assert.throws(
    () => composeOciLiveEvidenceTemplate(base, {
      ...extension,
      cloudProvider: { ...extension.cloudProvider, provider: 'aws' },
    }),
    /provider must be 'oci'/,
  );
  assert.throws(
    () => composeOciLiveEvidenceTemplate(base, { ...extension, productionAcceptance: true }),
    /productionAcceptance=true/,
  );

  console.log('OCI R3 live evidence template composer self-test passed');
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
    const composed = composeOciLiveEvidenceTemplate(
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
    }));
    return;
  }
  throw new Error(
    'Usage: node .ci/compose-release-infrastructure-oci-evidence-template.mjs --self-test | --compose <base-template.json> <oci-extension.json> <output.json>',
  );
}

await main(process.argv.slice(2));
