// Temporary R6 diagnostic: encrypt static SARIF locations to a session-only
// recipient. No private key, source snippets, credentials or plaintext findings
// are emitted. This does not change, filter or suppress the CodeQL upload.
import { readFileSync } from "node:fs";
import { createCipheriv, publicEncrypt, randomBytes, constants } from "node:crypto";

const recipient = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAviq0QbXnUFgauNeVvFJT
2ZRpw1lHzqW/6Sb72s25tw1yvFsbic6EjaugQLMj2UsKvSUpwHstEL8EsgPJ1QPN
6AUH6YNYTaKcS1s0DkZT6oC4isHk7raUT7rSzMrNk2W0sWOxo/0jBwoK+jP1Bqgw
O96SK69Hf1SQxWejRL5iWlQWTsna7oBlwJmI87Tr0tl1Prts+ciQqU8czUpk7l7p
Imp3S+PDSQr4fD5w/RNn8PIf2uDyH2k2wA4G5fXSTNvxJDAfrw4/GFarOzmiWvR+
mposaly0ceD4U1zJN7dx0T1NvwaRv7UzpusRm2x94tKo/lcUGeljCAklPiDsmh+l
FQpJtJEVJXh1N/MyrKY8GVTtY4o5NtXavJguCWBkvVUkjvLdjvz9ltTuwAV1EJUV
MJmCCrUPMU5rA7XfpMk8tsrS4ZmJ3TJQez/gX5q8utZ9n1X0cisHv8erubQbWW0Y
0oswLGxhpGhlO7A+I2p9TK7SvgV5MbMVlY2CAoEgruhJAgMBAAE=
-----END PUBLIC KEY-----`;

function site(location) {
  const physical = location?.physicalLocation;
  return { uri: physical?.artifactLocation?.uri, line: physical?.region?.startLine, column: physical?.region?.startColumn };
}

function seal(value, aad) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const wrappedKey = publicEncrypt({ key: recipient, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
  key.fill(0);
  return { v: 1, aad, key: wrappedKey.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: ciphertext.toString("base64") };
}

try {
  const sha = process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("Missing run identity");
  const document = JSON.parse(readFileSync("codeql-results/javascript.sarif", "utf8"));
  const findings = (document.runs ?? []).flatMap((run) => (run.results ?? []).map((result) => ({
    rule: result.ruleId,
    message: result.message?.text,
    sites: (result.locations ?? []).map(site),
    related: (result.relatedLocations ?? []).map((location) => ({ id: location.id, ...site(location) })),
    flow: (result.codeFlows ?? []).flatMap((flow) => (flow.threadFlows ?? []).flatMap((thread) => (thread.locations ?? []).map((entry) => site(entry.location)))),
  })));
  const envelope = seal({ sha, findings }, `carepoint.r6.location/v1:${sha}`);
  console.log(`CAREPOINT_R6_ENCRYPTED=${JSON.stringify(envelope)}`);
} catch {
  console.error("Encrypted diagnostic failed; plaintext details intentionally withheld.");
  process.exitCode = 1;
}
