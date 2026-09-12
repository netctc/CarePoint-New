import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const RELEASE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const NEST_COMMON = "@nestjs/common";
const HTTP_DECORATORS = new Map([
  ["Get", "GET"],
  ["Post", "POST"],
  ["Put", "PUT"],
  ["Patch", "PATCH"],
  ["Delete", "DELETE"],
  ["Options", "OPTIONS"],
  ["Head", "HEAD"],
  ["All", "ALL"],
  ["Sse", "GET"],
]);
const RELEVANT_DECORATORS = new Set(["Controller", ...HTTP_DECORATORS.keys()]);

function fail(message) {
  throw new Error(message);
}

function command(name, args, options = {}) {
  return execFileSync(name, args, {
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
    ...options,
  }).trim();
}

function assertFullSha(value, label) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!FULL_GIT_SHA.test(normalized)) fail(`${label} must be a full 40-hex Git SHA.`);
  return normalized;
}

function assertReleaseVersion(value) {
  const normalized = String(value ?? "").trim();
  if (!RELEASE_VERSION.test(normalized)) fail("Release version is malformed.");
  return normalized;
}

function gitObjectExists(sha, cwd) {
  return spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd, encoding: "utf8" }).status === 0;
}

function assertReleaseRange(baseSha, candidateSha, cwd) {
  if (!gitObjectExists(baseSha, cwd)) fail(`Base SHA is unavailable: ${baseSha}`);
  if (!gitObjectExists(candidateSha, cwd)) fail(`Candidate SHA is unavailable: ${candidateSha}`);
  if (baseSha === candidateSha) fail("Base and candidate SHAs must differ.");
  const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", baseSha, candidateSha], { cwd, encoding: "utf8" });
  if (ancestry.status !== 0) {
    if (ancestry.status === 1) fail("Release base SHA must be an ancestor of the candidate SHA.");
    fail(`Unable to verify release ancestry: ${ancestry.stderr?.trim() || "git merge-base failed"}`);
  }
}

function sourceFile(fileName, sourceText) {
  const parsed = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (parsed.parseDiagnostics.length > 0) {
    const diagnostic = parsed.parseDiagnostics[0];
    fail(`TypeScript parse failed for ${fileName}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }
  return parsed;
}

function decoratorsOf(node) {
  if (!ts.canHaveDecorators(node)) return [];
  return ts.getDecorators(node) ?? [];
}

function nestDecoratorAliases(parsed) {
  const aliases = new Map();
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== NEST_COMMON) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (RELEVANT_DECORATORS.has(imported)) aliases.set(element.name.text, imported);
    }
  }
  return aliases;
}

function decoratorCall(decorator, aliases) {
  const expression = decorator.expression;
  const call = ts.isCallExpression(expression) ? expression : null;
  const target = call ? call.expression : expression;
  if (!ts.isIdentifier(target)) return null;
  const canonical = aliases.get(target.text);
  if (!canonical) return null;
  return { name: canonical, args: call ? [...call.arguments] : [] };
}

function literalString(node, context) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  fail(`${context} must use static string literal paths for deterministic route evidence.`);
}

function literalPaths(node, context) {
  if (!node) return [""];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node)) {
    if (node.elements.length === 0) return [""];
    return node.elements.map((element) => literalString(element, context));
  }
  fail(`${context} must use a string literal or array of string literals.`);
}

function controllerPaths(args, context) {
  if (args.length === 0) return [""];
  const first = args[0];
  if (ts.isObjectLiteralExpression(first)) {
    const pathProperty = first.properties.find((property) => {
      if (!ts.isPropertyAssignment(property)) return false;
      return (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === "path";
    });
    if (!pathProperty || !ts.isPropertyAssignment(pathProperty)) return [""];
    return literalPaths(pathProperty.initializer, `${context} path`);
  }
  return literalPaths(first, `${context} path`);
}

function normalizeSegment(value) {
  return String(value).trim().replace(/^\/+|\/+$/g, "");
}

export function joinRoute(globalPrefix, controllerPath, methodPath) {
  const segments = [globalPrefix, controllerPath, methodPath]
    .map(normalizeSegment)
    .filter(Boolean);
  return `/${segments.join("/")}`.replace(/\/{2,}/g, "/");
}

export function extractGlobalPrefix(sourceText, fileName = "services/api/src/main.ts") {
  const parsed = sourceFile(fileName, sourceText);
  const prefixes = [];
  function visit(node) {
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "setGlobalPrefix") {
      if (node.arguments.length !== 1) fail(`${fileName} setGlobalPrefix must have exactly one static argument.`);
      prefixes.push(literalString(node.arguments[0], `${fileName} setGlobalPrefix`));
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (prefixes.length !== 1) fail(`${fileName} must define exactly one static setGlobalPrefix call.`);
  return normalizeSegment(prefixes[0]);
}

export function extractRoutesFromSource(sourceText, fileName, globalPrefix = "api/v1") {
  const parsed = sourceFile(fileName, sourceText);
  const aliases = nestDecoratorAliases(parsed);
  if (![...aliases.values()].includes("Controller")) return [];
  const routes = [];

  for (const statement of parsed.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    const className = statement.name?.text ?? "<anonymous>";
    const controllerDecorator = decoratorsOf(statement)
      .map((decorator) => decoratorCall(decorator, aliases))
      .find((item) => item?.name === "Controller");
    if (!controllerDecorator) continue;
    const controllers = controllerPaths(controllerDecorator.args, `${fileName}:${className} @Controller`);

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const handler = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
        ? member.name.text
        : member.name.getText(parsed);
      const methodDecorators = decoratorsOf(member)
        .map((decorator) => decoratorCall(decorator, aliases))
        .filter((item) => item && HTTP_DECORATORS.has(item.name));

      for (const methodDecorator of methodDecorators) {
        const httpMethod = HTTP_DECORATORS.get(methodDecorator.name);
        const methodPaths = literalPaths(methodDecorator.args[0], `${fileName}:${className}.${handler} @${methodDecorator.name}`);
        for (const controllerPath of controllers) {
          for (const methodPath of methodPaths) {
            routes.push({
              method: httpMethod,
              path: joinRoute(globalPrefix, controllerPath, methodPath),
              sourceFile: fileName,
              controller: className,
              handler,
            });
          }
        }
      }
    }
  }

  return routes;
}

function listTypeScriptSourcesAt(sha, cwd) {
  const raw = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", "-z", sha, "--", "services/api/src"],
    { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  return raw.split("\0").filter((item) => item.endsWith(".ts")).sort();
}

function gitFileAt(sha, relativePath, cwd) {
  return execFileSync("git", ["show", `${sha}:${relativePath}`], {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function routeIdentity(route) {
  return `${route.method} ${route.path}`;
}

function sortRoutes(routes) {
  return [...routes].sort((a, b) =>
    routeIdentity(a).localeCompare(routeIdentity(b))
    || a.sourceFile.localeCompare(b.sourceFile)
    || a.controller.localeCompare(b.controller)
    || a.handler.localeCompare(b.handler));
}

function assertNoDuplicateRoutes(routes, sha) {
  const seen = new Map();
  for (const route of routes) {
    const identity = routeIdentity(route);
    const previous = seen.get(identity);
    if (previous) {
      fail(`Duplicate API route identity at ${sha}: ${identity} (${previous.sourceFile} and ${route.sourceFile}).`);
    }
    seen.set(identity, route);
  }
}

function emptySurface(sha) {
  return {
    schema: "carepoint.api-route-surface/v1",
    sourceSha: sha,
    globalPrefix: null,
    routeCount: 0,
    routes: [],
    evidenceBoundaries: {
      generatedOfflineFromTypeScriptAst: true,
      applicationStarted: false,
      databaseOrProviderAccessRequired: false,
      includesRequestResponseSchemas: false,
      fullOpenApiSchema: false,
      emptySourceTreeRepresentsNoApiAtThisSha: true,
    },
  };
}

function surfaceAt(sha, cwd) {
  const mainPath = "services/api/src/main.ts";
  const files = listTypeScriptSourcesAt(sha, cwd);
  if (files.length === 0) return emptySurface(sha);
  if (!files.includes(mainPath)) {
    fail(`API TypeScript sources exist at ${sha}, but ${mainPath} is missing.`);
  }

  const prefix = extractGlobalPrefix(gitFileAt(sha, mainPath, cwd), mainPath);
  const routes = [];
  for (const relativePath of files) {
    routes.push(...extractRoutesFromSource(gitFileAt(sha, relativePath, cwd), relativePath, prefix));
  }
  const sorted = sortRoutes(routes);
  assertNoDuplicateRoutes(sorted, sha);
  return {
    schema: "carepoint.api-route-surface/v1",
    sourceSha: sha,
    globalPrefix: `/${prefix}`,
    routeCount: sorted.length,
    routes: sorted,
    evidenceBoundaries: {
      generatedOfflineFromTypeScriptAst: true,
      applicationStarted: false,
      databaseOrProviderAccessRequired: false,
      includesRequestResponseSchemas: false,
      fullOpenApiSchema: false,
      emptySourceTreeRepresentsNoApiAtThisSha: false,
    },
  };
}

function diffSurfaces(baseSurface, candidateSurface) {
  const baseByIdentity = new Map(baseSurface.routes.map((route) => [routeIdentity(route), route]));
  const candidateByIdentity = new Map(candidateSurface.routes.map((route) => [routeIdentity(route), route]));
  const added = [...candidateByIdentity.entries()]
    .filter(([identity]) => !baseByIdentity.has(identity))
    .map(([, route]) => route);
  const removed = [...baseByIdentity.entries()]
    .filter(([identity]) => !candidateByIdentity.has(identity))
    .map(([, route]) => route);

  return {
    schema: "carepoint.api-route-surface-diff/v1",
    baseSha: baseSurface.sourceSha,
    candidateSha: candidateSurface.sourceSha,
    baseRouteCount: baseSurface.routeCount,
    candidateRouteCount: candidateSurface.routeCount,
    addedRouteCount: added.length,
    removedRouteCount: removed.length,
    hasRemovedRoutes: removed.length > 0,
    addedRoutes: sortRoutes(added),
    removedRoutes: sortRoutes(removed),
    evidenceBoundaries: {
      routeIdentityOnly: true,
      includesRequestResponseSchemas: false,
      fullOpenApiSchemaDiff: false,
      removedRoutesRequireReleaseReview: true,
    },
  };
}

function renderSummary(surface, diff, version) {
  const routeLine = (route) => `- \`${route.method} ${route.path}\``;
  const added = diff.addedRoutes.length ? diff.addedRoutes.map(routeLine).join("\n") : "- None";
  const removed = diff.removedRoutes.length ? diff.removedRoutes.map(routeLine).join("\n") : "- None";
  return [
    "# CarePoint API route-surface change summary",
    "",
    `**Release version:** \`${version}\`  `,
    `**Base SHA:** \`${diff.baseSha}\`  `,
    `**Candidate SHA:** \`${diff.candidateSha}\`  `,
    `**Base route count:** ${diff.baseRouteCount}  `,
    `**Candidate route count:** ${diff.candidateRouteCount}`,
    "",
    "This is an offline Nest route-surface inventory, not a full OpenAPI request/response schema contract.",
    "",
    `## Added routes (${diff.addedRouteCount})`,
    "",
    added,
    "",
    `## Removed routes (${diff.removedRouteCount})`,
    "",
    removed,
    "",
    "## Review boundary",
    "",
    "- Route additions/removals are reported from static Nest decorators.",
    "- Request bodies, query schemas, response schemas and semantic compatibility are not represented.",
    "- Any removed route requires explicit release review; this generator does not automatically declare the change acceptable.",
    "- A SHA with no services/api/src TypeScript tree is represented as an empty pre-API baseline, not as an error.",
    "- No application process, database, external provider or production environment is used to generate this evidence.",
    "",
  ].join("\n");
}

async function selfTest() {
  const fixture = `
    import { Controller, Get, Post as Create } from "@nestjs/common";
    @Controller(["alpha", "beta"])
    class FixtureController {
      @Get()
      list() {}
      @Create(["one", "two"])
      create() {}
    }
  `;
  const routes = extractRoutesFromSource(fixture, "fixture.ts", "api/v1");
  const identities = routes.map(routeIdentity).sort();
  const expected = [
    "GET /api/v1/alpha",
    "GET /api/v1/beta",
    "POST /api/v1/alpha/one",
    "POST /api/v1/alpha/two",
    "POST /api/v1/beta/one",
    "POST /api/v1/beta/two",
  ].sort();
  if (JSON.stringify(identities) !== JSON.stringify(expected)) fail("Route extraction self-test failed.");
  if (joinRoute("/api/v1/", "/billing/", "/me") !== "/api/v1/billing/me") fail("Route joining self-test failed.");
  if (extractGlobalPrefix('async function x(){ app.setGlobalPrefix("api/v1"); }') !== "api/v1") fail("Global prefix self-test failed.");

  const empty = emptySurface("a".repeat(40));
  if (empty.routeCount !== 0 || empty.routes.length !== 0 || empty.globalPrefix !== null
      || empty.evidenceBoundaries.emptySourceTreeRepresentsNoApiAtThisSha !== true) {
    fail("Empty pre-API surface self-test failed.");
  }

  let dynamicRejected = false;
  try {
    extractRoutesFromSource(`
      import { Controller, Get } from "@nestjs/common";
      const dynamicPath = "x";
      @Controller(dynamicPath)
      class DynamicController { @Get() read() {} }
    `, "dynamic.ts", "api/v1");
  } catch {
    dynamicRejected = true;
  }
  if (!dynamicRejected) fail("Dynamic controller path self-test failed.");

  let dynamicMethodRejected = false;
  try {
    extractRoutesFromSource(`
      import { Controller, Get } from "@nestjs/common";
      const dynamicPath = "x";
      @Controller("static")
      class DynamicMethodController { @Get(dynamicPath) read() {} }
    `, "dynamic-method.ts", "api/v1");
  } catch {
    dynamicMethodRejected = true;
  }
  if (!dynamicMethodRejected) fail("Dynamic method path self-test failed.");

  console.log("api route-surface generator self-test passed");
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const cwd = process.cwd();
  const outputDir = path.resolve(cwd, process.argv[2] || "rc-evidence");
  const version = assertReleaseVersion(process.env.CAREPOINT_RELEASE_VERSION);
  const baseSha = assertFullSha(process.env.CAREPOINT_RELEASE_BASE_SHA, "CAREPOINT_RELEASE_BASE_SHA");
  const candidateSha = assertFullSha(process.env.CAREPOINT_RELEASE_SHA, "CAREPOINT_RELEASE_SHA");
  const headSha = assertFullSha(command("git", ["rev-parse", "HEAD"], { cwd }), "checked-out HEAD");
  if (headSha !== candidateSha) fail(`Candidate SHA mismatch: checkout is ${headSha}, requested candidate is ${candidateSha}.`);
  assertReleaseRange(baseSha, candidateSha, cwd);

  const baseSurface = surfaceAt(baseSha, cwd);
  const candidateSurface = surfaceAt(candidateSha, cwd);
  const diff = diffSurfaces(baseSurface, candidateSurface);

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "api-route-surface.json"), `${JSON.stringify(candidateSurface, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "api-route-surface-diff.json"), `${JSON.stringify(diff, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "api-route-surface-summary.md"), renderSummary(candidateSurface, diff, version), "utf8");

  console.log(JSON.stringify({
    schema: diff.schema,
    baseSha,
    candidateSha,
    baseRouteCount: diff.baseRouteCount,
    candidateRouteCount: diff.candidateRouteCount,
    addedRouteCount: diff.addedRouteCount,
    removedRouteCount: diff.removedRouteCount,
    hasRemovedRoutes: diff.hasRemovedRoutes,
  }));
}
