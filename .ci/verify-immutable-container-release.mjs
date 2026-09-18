import { readFile } from "node:fs/promises";

const COMMIT_PIN = /@[0-9a-f]{40}(?:\s|#|$)/i;
const USES_LINE = /^(?:-\s*)?uses:\s*/;

function fail(message) {
  throw new Error(message);
}

export function assertImmutableReleaseWorkflow(content) {
  const usesLines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => USES_LINE.test(line));
  if (usesLines.length === 0) fail("Immutable container workflow has no uses: actions.");
  for (const line of usesLines) {
    if (!COMMIT_PIN.test(line)) fail(`Every third-party GitHub Action must be pinned to a full commit SHA: ${line}`);
  }

  const requiredFragments = [
    'release/release-1-integration-go-live-readiness',
    'packages: write',
    'id-token: write',
    'attestations: write',
    'CAREPOINT_CONTAINER_SOURCE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}',
    'ref: ${{ env.CAREPOINT_CONTAINER_SOURCE_SHA }}',
    'registry: ghcr.io',
    'username: ${{ github.actor }}',
    'password: ${{ secrets.GITHUB_TOKEN }}',
    "push: ${{ github.event_name == 'push' }}",
    "load: ${{ github.event_name != 'push' }}",
    "provenance: ${{ github.event_name == 'push' && 'mode=max' || 'false' }}",
    "sbom: ${{ github.event_name == 'push' && 'true' || 'false' }}",
    'actions/attest-build-provenance@',
    'push-to-registry: true',
    'Verify exact OCI runtime artifacts',
    'api_ref="$API_IMAGE@$API_DIGEST"',
    'admin_ref="$ADMIN_IMAGE@$ADMIN_DIGEST"',
    'docker pull "$api_ref"',
    'docker pull "$admin_ref"',
    'org.opencontainers.image.revision',
    'docker run --rm --entrypoint openssl "$api_ref" version',
    'openssl-3.0',
    'test -f /app/apps/admin/server.js',
    'runtimeArtifactSmokeVerified: true',
    'apiOpenSslVerified: true',
    'prismaOpenSsl3EngineVerified: true',
    'productionDeploymentEvidence: false',
    'promotionRequiresDigest: true',
    'buildOncePromoteByDigest: true',
    'immutableRef:',
  ];
  for (const fragment of requiredFragments) {
    if (!content.includes(fragment)) fail(`Immutable container workflow is missing required control: ${fragment}`);
  }
  if (content.includes(':latest')) fail('Immutable container workflow must not publish or reference a mutable latest tag.');
  if (!content.includes('target: api') || !content.includes('target: admin')) fail('Immutable container workflow must build both api and admin targets.');

  const buildActionCount = usesLines.filter((line) => line.includes('docker/build-push-action@')).length;
  if (buildActionCount !== 2) fail(`Immutable container workflow must build exactly two deployable images; found ${buildActionCount}.`);
  const attestActionCount = usesLines.filter((line) => line.includes('actions/attest-build-provenance@')).length;
  if (attestActionCount !== 2) fail(`Immutable container workflow must attest API and Admin separately; found ${attestActionCount}.`);
}

function expectFailure(fn, label) {
  let failed = false;
  try { fn(); } catch { failed = true; }
  if (!failed) fail(`Self-test expected failure did not occur: ${label}`);
}

function selfTest() {
  const pin = 'a'.repeat(40);
  const valid = [
    'release/release-1-integration-go-live-readiness',
    'packages: write',
    'id-token: write',
    'attestations: write',
    'CAREPOINT_CONTAINER_SOURCE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}',
    `uses: actions/checkout@${pin}`,
    'ref: ${{ env.CAREPOINT_CONTAINER_SOURCE_SHA }}',
    `uses: docker/login-action@${pin}`,
    'registry: ghcr.io',
    'username: ${{ github.actor }}',
    'password: ${{ secrets.GITHUB_TOKEN }}',
    `uses: docker/build-push-action@${pin}`,
    'target: api',
    "push: ${{ github.event_name == 'push' }}",
    "load: ${{ github.event_name != 'push' }}",
    "provenance: ${{ github.event_name == 'push' && 'mode=max' || 'false' }}",
    "sbom: ${{ github.event_name == 'push' && 'true' || 'false' }}",
    `uses: actions/attest-build-provenance@${pin}`,
    'push-to-registry: true',
    `uses: docker/build-push-action@${pin}`,
    'target: admin',
    "push: ${{ github.event_name == 'push' }}",
    "load: ${{ github.event_name != 'push' }}",
    "provenance: ${{ github.event_name == 'push' && 'mode=max' || 'false' }}",
    "sbom: ${{ github.event_name == 'push' && 'true' || 'false' }}",
    `uses: actions/attest-build-provenance@${pin}`,
    'push-to-registry: true',
    'Verify exact OCI runtime artifacts',
    'api_ref="$API_IMAGE@$API_DIGEST"',
    'admin_ref="$ADMIN_IMAGE@$ADMIN_DIGEST"',
    'docker pull "$api_ref"',
    'docker pull "$admin_ref"',
    'org.opencontainers.image.revision',
    'docker run --rm --entrypoint openssl "$api_ref" version',
    'openssl-3.0',
    'test -f /app/apps/admin/server.js',
    'runtimeArtifactSmokeVerified: true',
    'apiOpenSslVerified: true',
    'prismaOpenSsl3EngineVerified: true',
    'productionDeploymentEvidence: false',
    'promotionRequiresDigest: true',
    'buildOncePromoteByDigest: true',
    'immutableRef:',
  ].join('\n');

  assertImmutableReleaseWorkflow(valid);
  expectFailure(() => assertImmutableReleaseWorkflow(valid.replace(`actions/checkout@${pin}`, 'actions/checkout@v4')), 'mutable action tag');
  expectFailure(() => assertImmutableReleaseWorkflow(`${valid}\nimage: test:latest\n`), 'mutable latest tag');
  expectFailure(() => assertImmutableReleaseWorkflow(valid.replace('packages: write', 'packages: read')), 'missing package write');
  expectFailure(() => assertImmutableReleaseWorkflow(valid.replace('promotionRequiresDigest: true', 'promotionRequiresDigest: false')), 'digest promotion disabled');
  expectFailure(() => assertImmutableReleaseWorkflow(valid.replace('docker pull "$api_ref"', 'echo skip-api-pull')), 'exact API digest pull removed');
  expectFailure(() => assertImmutableReleaseWorkflow(valid.replace('docker run --rm --entrypoint openssl "$api_ref" version', 'echo skip-openssl')), 'API OpenSSL smoke removed');
  expectFailure(() => assertImmutableReleaseWorkflow(valid.replace('openssl-3.0', 'openssl-native')), 'Prisma OpenSSL 3 engine smoke removed');
  console.log('immutable container release contract self-test passed');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const workflow = await readFile('.github/workflows/release1-immutable-containers.yml', 'utf8');
  assertImmutableReleaseWorkflow(workflow);
  console.log('immutable container release contract verified');
}
