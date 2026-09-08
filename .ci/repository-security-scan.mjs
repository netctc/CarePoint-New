import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const MAX_TEXT_FILE_BYTES = 2_000_000;
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tgz", ".jar", ".wasm",
  ".woff", ".woff2", ".ttf", ".eot", ".mp3", ".mp4", ".mov", ".avi", ".sqlite", ".db",
]);
const RUNTIME_PATH = /^(?:services\/[^/]+\/src\/|packages\/[^/]+\/src\/|apps\/[^/]+\/(?:app|src)\/)/;
const SENSITIVE_NAME = /(?:PASSWORD|PASSCODE|SECRET|API_KEY|TOKEN|PRIVATE_KEY|CLIENT_SECRET)/i;

const HIGH_CONFIDENCE_RULES = [
  {
    id: "PRIVATE_KEY_PEM",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    id: "AWS_ACCESS_KEY_ID",
    pattern: /(?:AKIA|ASIA)[0-9A-Z]{16}/g,
  },
  {
    id: "GITHUB_TOKEN",
    pattern: /(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})/g,
  },
  {
    id: "SLACK_TOKEN",
    pattern: /xox[baprs]-[A-Za-z0-9-]{20,}/g,
  },
  {
    id: "STRIPE_LIVE_SECRET",
    pattern: /sk_live_[A-Za-z0-9]{16,}/g,
  },
  {
    id: "SENDGRID_API_KEY",
    pattern: /SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{30,}/g,
  },
  {
    id: "GOOGLE_API_KEY",
    pattern: /AIza[A-Za-z0-9_-]{35}/g,
  },
];

const RUNTIME_SECURITY_RULES = [
  {
    id: "TLS_VERIFICATION_DISABLED",
    pattern: /(?:NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|rejectUnauthorized\s*:\s*false)/g,
  },
  {
    id: "DYNAMIC_CODE_EXECUTION",
    pattern: /(?:(?<![.$A-Za-z0-9_])eval\s*\(|\bnew\s+Function\s*\()/g,
  },
  {
    id: "WEAK_CRYPTO_HASH",
    pattern: /(?:createHash\s*\(\s*["'](?:md5|sha1)["']|createHmac\s*\(\s*["']md5["'])/gi,
  },
  {
    id: "EMBEDDED_CREDENTIAL_URL",
    pattern: /(?:https?|postgres(?:ql)?|redis(?:s)?):\/\/[^\s/:@]+:[^\s/@]+@/gi,
  },
];

function lineNumber(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function finding(rule, file, text, index) {
  return { rule, file, line: lineNumber(text, index) };
}

function isTrackedSecretEnv(file) {
  const base = path.posix.basename(file);
  if (!base.startsWith(".env")) return false;
  return !/(?:\.example|\.sample|\.template)$/.test(base);
}

function looksLikePlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return !normalized
    || normalized.includes("${")
    || normalized.includes("{{")
    || normalized.includes("<")
    || normalized.includes("runtime-secret")
    || normalized.includes("secret-manager")
    || normalized.includes("changeme")
    || normalized.includes("placeholder")
    || normalized === "example";
}

export function scanText(file, text) {
  const findings = [];
  for (const rule of HIGH_CONFIDENCE_RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) findings.push(finding(rule.id, file, text, match.index ?? 0));
  }

  if (RUNTIME_PATH.test(file)) {
    for (const rule of RUNTIME_SECURITY_RULES) {
      rule.pattern.lastIndex = 0;
      for (const match of text.matchAll(rule.pattern)) findings.push(finding(rule.id, file, text, match.index ?? 0));
    }

    const envFallback = /process\.env\.([A-Z0-9_]+)\s*(?:\?\?|\|\|)\s*["'`]([^"'`\n]{8,})["'`]/g;
    for (const match of text.matchAll(envFallback)) {
      const envName = match[1] ?? "";
      const value = match[2] ?? "";
      if (SENSITIVE_NAME.test(envName) && !looksLikePlaceholder(value)) {
        findings.push(finding("HARDCODED_SECRET_FALLBACK", file, text, match.index ?? 0));
      }
    }

    const literalAssignment = /\b([A-Za-z_$][A-Za-z0-9_$]*(?:Password|Passcode|Secret|ApiKey|Token|PrivateKey|ClientSecret)[A-Za-z0-9_$]*)\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/gi;
    for (const match of text.matchAll(literalAssignment)) {
      const value = match[2] ?? "";
      if (!looksLikePlaceholder(value)) findings.push(finding("HARDCODED_SECRET_LITERAL", file, text, match.index ?? 0));
    }
  }

  return findings;
}

function trackedFiles() {
  const raw = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return raw.split("\0").filter(Boolean).sort();
}

function scanRepository() {
  const findings = [];
  let scanned = 0;
  for (const file of trackedFiles()) {
    const normalized = file.replaceAll("\\", "/");
    if (isTrackedSecretEnv(normalized)) {
      findings.push({ rule: "TRACKED_SECRET_ENV_FILE", file: normalized, line: 1 });
    }
    if (BINARY_EXTENSIONS.has(path.extname(normalized).toLowerCase())) continue;
    let stats;
    try {
      stats = statSync(normalized);
    } catch {
      continue;
    }
    if (!stats.isFile() || stats.size > MAX_TEXT_FILE_BYTES) continue;
    let text;
    try {
      text = readFileSync(normalized, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    scanned += 1;
    findings.push(...scanText(normalized, text));
  }
  return { findings, scanned };
}

function selfTest() {
  const aws = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
  const github = ["ghp_", "a".repeat(40)].join("");
  const pem = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
  const slack = ["xoxb-", "A".repeat(30)].join("");
  const stripe = ["sk_live_", "A".repeat(24)].join("");
  const sendgrid = ["SG.", "A".repeat(22), ".", "B".repeat(43)].join("");
  const google = ["AIza", "A".repeat(35)].join("");
  const cases = [
    ["AWS_ACCESS_KEY_ID", aws],
    ["GITHUB_TOKEN", github],
    ["PRIVATE_KEY_PEM", pem],
    ["SLACK_TOKEN", slack],
    ["STRIPE_LIVE_SECRET", stripe],
    ["SENDGRID_API_KEY", sendgrid],
    ["GOOGLE_API_KEY", google],
    ["TLS_VERIFICATION_DISABLED", "const tls = { rejectUnauthorized: false };"],
    ["DYNAMIC_CODE_EXECUTION", "const x = eval(input);"],
    ["WEAK_CRYPTO_HASH", "createHash('sha1').update(value);"],
    ["EMBEDDED_CREDENTIAL_URL", "const url = 'https://user:password@example.test/api';"],
    ["HARDCODED_SECRET_FALLBACK", "const token = process.env.PAYMENT_GATEWAY_API_KEY ?? 'hardcoded-production-key';"],
    ["HARDCODED_SECRET_LITERAL", "const paymentApiKey = 'hardcoded-production-key';"],
  ];
  for (const [expected, text] of cases) {
    const rules = new Set(scanText("services/api/src/security/c10-self-test.ts", text).map((item) => item.rule));
    if (!rules.has(expected)) throw new Error(`C10 scanner self-test did not detect ${expected}.`);
  }
  const safe = scanText(
    "services/api/src/security/c10-safe-test.ts",
    "const token = process.env.PAYMENT_GATEWAY_API_KEY;\nconst digest = createHash('sha256').update(value);\nconst otp = createHmac('sha1', key).update(counter);\nawait redis.eval(script, 1, key);\n",
  );
  if (safe.length !== 0) throw new Error(`C10 scanner self-test produced ${safe.length} false-positive finding(s) for the safe fixture.`);
  console.log("Phase C10 repository security scanner self-test passed");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const { findings, scanned } = scanRepository();
  if (findings.length > 0) {
    console.error(`Phase C10 repository security scan failed with ${findings.length} finding(s).`);
    for (const item of findings) console.error(`${item.rule} ${item.file}:${item.line}`);
    process.exitCode = 1;
  } else {
    console.log(`Phase C10 repository security scan passed: ${scanned} tracked text files scanned`);
  }
}
