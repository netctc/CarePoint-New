import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = fileURLToPath(new URL("../src", import.meta.url));

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(path));
    else if ([".ts", ".mts", ".cts"].includes(extname(entry.name))) output.push(path);
  }
  return output;
}

const files = await sourceFiles(srcRoot);
assert.ok(files.length > 0, "C18 must scan the API source tree");

const violations = [];
for (const path of files) {
  const source = await readFile(path, "utf8");
  if (/\bRawBodyRequest\b/.test(source) || /\.rawBody\b/.test(source) || /\brawBody\s*:/.test(source)) {
    violations.push(path.slice(srcRoot.length + 1));
  }
}
assert.deepEqual(
  violations,
  [],
  `C18 found raw-body consumers/configuration that require an explicitly scoped design: ${violations.join(", ")}`,
);

const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
assert.match(
  mainSource,
  /NestFactory\.create<NestExpressApplication>\(AppModule, \{ cors: false \}\)/,
  "C18 must create Nest without global rawBody retention",
);
assert.doesNotMatch(mainSource, /rawBody\s*:/, "C18 must not enable global rawBody retention");
assert.match(mainSource, /useBodyParser\("json", \{ limit: bodyLimits\.jsonBytes \}\)/, "C17 JSON body limit must remain active");
assert.match(mainSource, /useBodyParser\("urlencoded", \{ limit: bodyLimits\.formBytes, extended: true \}\)/, "C17 form body limit must remain active");

const treeHints = files.map((path) => path.toLowerCase());
assert.equal(treeHints.some((path) => path.includes("webhook")), false, "C18 must be revisited if an inbound webhook module is introduced");
assert.equal(treeHints.some((path) => path.includes("callback")), false, "C18 must be revisited if an inbound callback module is introduced");

const packageSource = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.ok(packageSource.scripts.test.includes("c18:raw-body-minimization"));
assert.equal(packageSource.dependencies["raw-body"], undefined, "C18 must not add a raw-body retention dependency");

console.log("Phase C18 global raw body minimization acceptance passed");
