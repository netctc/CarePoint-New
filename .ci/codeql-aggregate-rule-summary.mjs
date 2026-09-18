#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

function sarifFiles(root) {
  // The CodeQL SARIF directory is runner-generated and trusted. Enumerate it in
  // one recursive operation and attempt to read only *.sarif entries instead
  // of checking file metadata and reopening paths later (TOCTOU pattern).
  return readdirSync(root, { recursive: true })
    .filter((entry) => typeof entry === "string" && extname(entry).toLowerCase() === ".sarif")
    .map((entry) => join(root, entry))
    .sort();
}

function ruleSecuritySeverity(run, ruleId) {
  const rules = run?.tool?.driver?.rules;
  if (!Array.isArray(rules)) return null;
  const rule = rules.find((candidate) => candidate?.id === ruleId);
  const raw = rule?.properties?.["security-severity"];
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}

function decodedUri(rawUri) {
  const normalized = String(rawUri ?? "")
    .replace(/^file:\/\//i, "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function subsequenceIndex(parts, expected) {
  if (expected.length === 0 || parts.length < expected.length) return -1;
  for (let index = 0; index <= parts.length - expected.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < expected.length; offset += 1) {
      if (parts[index + offset] !== expected[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

function resultComponent(result) {
  const locations = Array.isArray(result?.locations) ? result.locations : [];
  const rawUri = locations[0]?.physicalLocation?.artifactLocation?.uri;
  if (typeof rawUri !== "string" || !rawUri.trim()) return "other";

  const parts = decodedUri(rawUri).split("/").filter(Boolean);

  // SARIF artifact URIs can be repository-relative or prefixed with a checkout,
  // CodeQL extraction or workspace root. Match trusted repository path segments
  // anywhere in the URI, then expose only a deliberately coarse component.
  const apiModules = subsequenceIndex(parts, ["services", "api", "src", "modules"]);
  if (apiModules >= 0) {
    const moduleName = parts[apiModules + 4];
    return moduleName ? `services/api/src/modules/${moduleName}` : "services/api/src/modules";
  }

  const apiSrc = subsequenceIndex(parts, ["services", "api", "src"]);
  if (apiSrc >= 0) {
    const areaName = parts[apiSrc + 3];
    return areaName ? `services/api/src/${areaName}` : "services/api/src";
  }

  const api = subsequenceIndex(parts, ["services", "api"]);
  if (api >= 0) return "services/api";

  const identitySrc = subsequenceIndex(parts, ["packages", "identity", "src"]);
  if (identitySrc >= 0) return "packages/identity/src";
  const identityTest = subsequenceIndex(parts, ["packages", "identity", "test"]);
  if (identityTest >= 0) return "packages/identity/test";
  const identityDist = subsequenceIndex(parts, ["packages", "identity", "dist"]);
  if (identityDist >= 0) return "packages/identity/dist";

  const packages = parts.lastIndexOf("packages");
  if (packages >= 0) {
    const packageName = parts[packages + 1];
    return packageName ? `packages/${packageName}` : "packages";
  }

  const apps = parts.lastIndexOf("apps");
  if (apps >= 0) {
    const appName = parts[apps + 1];
    return appName ? `apps/${appName}` : "apps";
  }

  if (parts.includes(".ci")) return ".ci";
  if (parts.includes("scripts")) return "scripts";
  return "other";
}

export function aggregateSarif(documents) {
  const aggregate = new Map();
  for (const document of documents) {
    for (const run of Array.isArray(document?.runs) ? document.runs : []) {
      for (const result of Array.isArray(run?.results) ? run.results : []) {
        const ruleId = typeof result?.ruleId === "string" && result.ruleId.trim()
          ? result.ruleId.trim()
          : "unknown-rule";
        const component = resultComponent(result);
        const key = `${ruleId}\u0000${component}`;
        const previous = aggregate.get(key) ?? { ruleId, component, count: 0, securitySeverity: null };
        previous.count += 1;
        const severity = ruleSecuritySeverity(run, ruleId);
        if (severity !== null && (previous.securitySeverity === null || severity > previous.securitySeverity)) {
          previous.securitySeverity = severity;
        }
        aggregate.set(key, previous);
      }
    }
  }
  return [...aggregate.values()]
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.component.localeCompare(b.component));
}

function format(summary) {
  if (summary.length === 0) return ["CodeQL aggregate rule/component summary: no results."];
  return [
    "CodeQL aggregate rule/component summary (coarse components/counts only; files, locations and messages intentionally suppressed):",
    ...summary.map((item) => `- ${item.ruleId} | ${item.component}: ${item.count}${item.securitySeverity === null ? "" : ` (security-severity ${item.securitySeverity})`}`),
  ];
}

function resultFixture(uri, message = "sensitive exploit detail must never be printed", line = 42) {
  return {
    ruleId: "js/path-injection",
    message: { text: message },
    locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: line } } }],
  };
}

function selfTest() {
  const sensitiveFile = "secret-sensitive-path.ts";
  const sensitiveMessage = "sensitive exploit detail must never be printed";
  const fixture = {
    runs: [{
      tool: { driver: { rules: [{ id: "js/path-injection", properties: { "security-severity": "7.5" } }] } },
      results: [
        resultFixture(`/home/runner/work/CarePoint-New/CarePoint-New/services/api/src/modules/iam/${sensitiveFile}`),
        resultFixture(`file:///workspace/packages/identity/src/${sensitiveFile}`, sensitiveMessage, 99),
      ],
    }],
  };
  const summary = aggregateSarif([fixture]);
  if (
    summary.length !== 2 ||
    summary[0].ruleId !== "js/path-injection" ||
    summary[0].component !== "packages/identity/src" ||
    summary[0].count !== 1 ||
    summary[0].securitySeverity !== 7.5 ||
    summary[1].component !== "services/api/src/modules/iam" ||
    summary[1].count !== 1
  ) {
    throw new Error("aggregate SARIF self-test failed");
  }
  const rendered = format(summary).join("\n");
  if (
    rendered.includes(sensitiveFile) ||
    rendered.includes(sensitiveMessage) ||
    rendered.includes("42") ||
    rendered.includes("99") ||
    rendered.includes("runner/work") ||
    rendered.includes("/workspace/")
  ) {
    throw new Error("aggregate SARIF summary leaked file/location/message data");
  }
  if (!rendered.includes("js/path-injection | services/api/src/modules/iam: 1")) {
    throw new Error("aggregate SARIF summary omitted the safe module component");
  }
  if (!rendered.includes("js/path-injection | packages/identity/src: 1")) {
    throw new Error("aggregate SARIF summary omitted the safe identity component");
  }
  console.log("CodeQL aggregate rule/component summary self-test: PASS");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const root = process.argv[2] ?? "codeql-results";
const files = sarifFiles(root);
if (files.length === 0) throw new Error(`No SARIF files found under ${root}`);
const documents = files.map((file) => JSON.parse(readFileSync(file, "utf8")));
for (const line of format(aggregateSarif(documents))) console.log(line);
