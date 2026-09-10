#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

function sarifFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".sarif") files.push(path);
    }
  }
  return files.sort();
}

function ruleSecuritySeverity(run, ruleId) {
  const rules = run?.tool?.driver?.rules;
  if (!Array.isArray(rules)) return null;
  const rule = rules.find((candidate) => candidate?.id === ruleId);
  const raw = rule?.properties?.["security-severity"];
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function aggregateSarif(documents) {
  const aggregate = new Map();
  for (const document of documents) {
    for (const run of Array.isArray(document?.runs) ? document.runs : []) {
      for (const result of Array.isArray(run?.results) ? run.results : []) {
        const ruleId = typeof result?.ruleId === "string" && result.ruleId.trim()
          ? result.ruleId.trim()
          : "unknown-rule";
        const previous = aggregate.get(ruleId) ?? { count: 0, securitySeverity: null };
        previous.count += 1;
        const severity = ruleSecuritySeverity(run, ruleId);
        if (severity !== null && (previous.securitySeverity === null || severity > previous.securitySeverity)) {
          previous.securitySeverity = severity;
        }
        aggregate.set(ruleId, previous);
      }
    }
  }
  return [...aggregate.entries()]
    .map(([ruleId, value]) => ({ ruleId, ...value }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

function format(summary) {
  if (summary.length === 0) return ["CodeQL aggregate rule summary: no results."];
  return [
    "CodeQL aggregate rule summary (rule IDs/counts only; locations and messages intentionally suppressed):",
    ...summary.map((item) => `- ${item.ruleId}: ${item.count}${item.securitySeverity === null ? "" : ` (security-severity ${item.securitySeverity})`}`),
  ];
}

function selfTest() {
  const sensitivePath = "services/api/src/secret-sensitive-path.ts";
  const sensitiveMessage = "sensitive exploit detail must never be printed";
  const fixture = {
    runs: [{
      tool: { driver: { rules: [{ id: "js/path-injection", properties: { "security-severity": "7.5" } }] } },
      results: [{
        ruleId: "js/path-injection",
        message: { text: sensitiveMessage },
        locations: [{ physicalLocation: { artifactLocation: { uri: sensitivePath }, region: { startLine: 42 } } }],
      }],
    }],
  };
  const summary = aggregateSarif([fixture]);
  if (summary.length !== 1 || summary[0].ruleId !== "js/path-injection" || summary[0].count !== 1 || summary[0].securitySeverity !== 7.5) {
    throw new Error("aggregate SARIF self-test failed");
  }
  const rendered = format(summary).join("\n");
  if (rendered.includes(sensitivePath) || rendered.includes(sensitiveMessage) || rendered.includes("42")) {
    throw new Error("aggregate SARIF summary leaked location/message data");
  }
  console.log("CodeQL aggregate rule summary self-test: PASS");
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
