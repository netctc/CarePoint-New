import { readFile } from "node:fs/promises";

const repoRoot=new URL("../../../",import.meta.url);
const ledger=JSON.parse(await readFile(
  new URL("ops/release-1/external-closure-blocker-ledger-20261001.json",repoRoot),
  "utf8"
));

const lines=[
  "# CarePoint External Closure Worklist",
  "",
  `Decision: **${ledger.decision}**`,
  "",
  "Automated validation is green, but the following gates still require real external/human evidence.",
  ""
];

for(const gate of ledger.gates){
  lines.push(`## ${gate.id}`);
  lines.push("");
  lines.push(`Status: **${gate.status}**`);
  lines.push(`Primary issues: ${gate.primaryIssues.map(n=>`#${n}`).join(", ")}`);
  if(gate.relatedIssues.length) lines.push(`Related issues: ${gate.relatedIssues.map(n=>`#${n}`).join(", ")}`);
  lines.push(`Owner roles: ${gate.ownerRoles.join(", ")}`);
  lines.push("");
  lines.push("Required evidence:");
  for(const item of gate.requiredEvidence) lines.push(`- ${item}`);
  lines.push("");
}

lines.push("## Safety boundary");
lines.push("");
lines.push("- productionAcceptance=false");
lines.push("- mainMergeAllowed=false");
lines.push("- projectClosureReady=false");
lines.push("- projectClosed=false");
lines.push("- external evidence must not be synthesized");
lines.push("- no gate may be auto-closed");
lines.push("");

process.stdout.write(lines.join("\n")+"\n");
