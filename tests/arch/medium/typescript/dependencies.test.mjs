import assert from "node:assert/strict";
import { globSync, readFileSync, realpathSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const contract = "contracts/book-vault";
const extractors = "libs/book-products";
const obsidian = "runtimes/obsidian";
const extension = "runtimes/book-extension";
const dependencies = new Map([
  [contract, { packages: [], externals: ["zod"] }],
  [extractors, { packages: [], externals: [] }],
  [
    obsidian,
    {
      packages: [contract, extractors],
      externals: ["yaml", "@peculiar/x509", "reflect-metadata", "ws"],
    },
  ],
  [extension, { packages: [contract, extractors], externals: [] }],
]);
const sourceOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
};

function manifest(path) {
  return JSON.parse(readFileSync(resolve(root, path, "package.json"), "utf8"));
}

function moduleSpecifiers(file) {
  const parsed = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      specifiers.push(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifiers.push(node.argument.literal);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifiers.push(node.arguments[0]);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      specifiers.push(node.moduleReference.expression);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return specifiers.map((specifier) => {
    assert.ok(
      specifier && ts.isStringLiteralLike(specifier),
      `${file} has an uninspectable import`,
    );
    return specifier.text;
  });
}

function verifyBuiltin(area, source, specifier, message) {
  assert.equal(area, obsidian, message);
  const restricted = [
    ["/src/local-move-copies.ts", /^node:(?:fs\/promises|os|path)$/],
    ["/src/connection-grant.ts", /^node:(?:child_process|fs\/promises|os|path|util)$/],
    ["/src/connection.ts", /^node:(?:http|stream|tls)$/],
    ["/src/tls-identity.ts", /^node:tls$/],
  ];
  if (restricted.some(([caller, allowed]) => source.endsWith(caller) && allowed.test(specifier)))
    return;
  assert.match(specifier, /^node:(?:crypto|https)$/, message);
}

function verifyImport({ area, policy, source, specifier, workspaceEntries }) {
  const message = `${source}: ${specifier}`;
  if (
    area === obsidian &&
    source.endsWith("/src/wasm.ts") &&
    /^\.\.\/dist\/wasm\/book_props_vault(?:\.js|_bg\.wasm)$/.test(specifier)
  )
    return;
  if (
    area === extension &&
    source.endsWith("/src/vault-transport.ts") &&
    specifier === "../dist/tls/vault_tls.js"
  )
    return;
  if (area === obsidian && specifier === "obsidian") return;
  if (isBuiltin(specifier)) return verifyBuiltin(area, source, specifier, message);
  if (specifier === "ws") assert.ok(source.endsWith("/src/connection.ts"), message);
  if (policy.externals.includes(specifier)) return;
  if (workspaceEntries.has(specifier)) {
    assert.ok(policy.packages.includes(workspaceEntries.get(specifier)), message);
    assert.ok(
      ts.resolveModuleName(specifier, source, sourceOptions, ts.sys).resolvedModule,
      message,
    );
    return;
  }
  assert.ok(specifier.startsWith("./") || specifier.startsWith("../"), message);
  const local = ts.resolveModuleName(specifier, source, sourceOptions, ts.sys).resolvedModule;
  assert.ok(local, message);
  const boundary = resolve(root, area, area.startsWith("runtimes/") ? "src" : "");
  assert.ok(realpathSync(local.resolvedFileName).startsWith(`${realpathSync(boundary)}/`), message);
  assert.doesNotMatch(
    local.resolvedFileName,
    /\/(?:tests?|dist|node_modules)\/|\.test\.[^/]+$/,
    message,
  );
}

await test("runtime dependencies resolve only through the active package boundaries", () => {
  const manifests = globSync(
    ["contracts/*/package.json", "libs/*/package.json", "runtimes/*/package.json"],
    { cwd: root, exclude: ["**/node_modules/**"] },
  );
  assert.deepEqual(new Set(manifests.map(dirname)), new Set(dependencies.keys()));
  const workspaceEntries = new Map(
    [...dependencies.keys()].map((area) => [manifest(area).name, area]),
  );
  for (const [area, policy] of dependencies) {
    const allowed = new Set([
      ...policy.packages.map((path) => manifest(path).name),
      ...policy.externals,
    ]);
    assert.deepEqual(new Set(Object.keys(manifest(area).dependencies ?? {})), allowed, area);
    const search = area.startsWith("runtimes/") ? `${area}/src/**/*.ts` : `${area}/*.ts`;
    const sources = globSync(search, { cwd: root });
    assert.notEqual(sources.length, 0, area);
    for (const source of sources.map((path) => resolve(root, path))) {
      for (const specifier of moduleSpecifiers(source))
        verifyImport({ area, policy, source, specifier, workspaceEntries });
    }
  }
});
