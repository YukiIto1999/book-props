import assert from "node:assert/strict";
import { globSync, readFileSync, realpathSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const contract = "contracts/book-vault";
const extractors = "libs/book-products";
const obsidian = "runtimes/obsidian";
const extension = "runtimes/chrome";
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

const obsidianSource = resolve(root, obsidian, "src");
/**
 * The Obsidian plugin's layers and the source files each may import, by path under `src`; a path
 * ending in `/` names a folder. `values` may be imported at all, `types` only with `import type`.
 * `main.ts` composes the plugin. The core seam starts the core alone; the catalog orchestrates
 * through the note format and the ports it declares, which the other adapters implement; views
 * render what the catalog and the core decide.
 */
const layers = new Map([
  ["main.ts", { values: ["core/", "shared/", "adapters/", "catalog/", "views/"], types: [] }],
  ["core/", { values: ["core/"], types: [] }],
  ["shared/", { values: ["shared/"], types: [] }],
  ["adapters/", { values: ["shared/", "adapters/"], types: ["core/", "catalog/ports.ts"] }],
  ["catalog/", { values: ["shared/", "catalog/", "adapters/note-format/"], types: ["core/"] }],
  ["views/", { values: ["shared/", "views/", "catalog/"], types: ["core/", "adapters/"] }],
]);
/** Only the core seam loads the core's bindings and binary. */
const wasm = /^\.\.\/\.\.\/dist\/wasm\/book_props_vault(?:\.js|_bg\.wasm)$/;
/** Packages that only some layers or files of the plugin may use. */
const confined = new Map([
  ["obsidian", /^(?:main\.ts|adapters\/|views\/)/],
  ["yaml", /^adapters\/note-format\//],
  ["ws", /^adapters\/connection\/connection\.ts$/],
  ["@peculiar/x509", /^adapters\/connection\/tls-identity\.ts$/],
  ["reflect-metadata", /^adapters\/connection\/tls-identity\.ts$/],
]);
/** The adapters that reach the system, each with the Node built-ins it needs. */
const builtins = new Map([
  ["adapters/local-move-copies.ts", /^node:(?:crypto|fs\/promises|os|path)$/],
  [
    "adapters/connection/connection-grant.ts",
    /^node:(?:child_process|crypto|fs\/promises|os|path|util)$/,
  ],
  ["adapters/connection/connection.ts", /^node:(?:crypto|http|stream|tls)$/],
  ["adapters/connection/tls-identity.ts", /^node:(?:crypto|tls)$/],
  ["adapters/bibliography-sources.ts", /^node:https$/],
]);

function manifest(path) {
  return JSON.parse(readFileSync(resolve(root, path, "package.json"), "utf8"));
}

/** An import that brings in types only; node erases it, so it loads nothing at runtime. */
function typeOnly(node) {
  if (ts.isImportTypeNode(node)) return true;
  if (ts.isImportDeclaration(node))
    return node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
  return ts.isExportDeclaration(node) && node.isTypeOnly;
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
      specifiers.push([node.moduleSpecifier, typeOnly(node)]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifiers.push([node.argument.literal, true]);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifiers.push([node.arguments[0], false]);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      specifiers.push([node.moduleReference.expression, false]);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return specifiers.map(([specifier, types]) => {
    assert.ok(
      specifier && ts.isStringLiteralLike(specifier),
      `${file} has an uninspectable import`,
    );
    return { specifier: specifier.text, typeOnly: types };
  });
}

function within(path, prefix) {
  return prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix;
}

function layerOf(path) {
  return [...layers.keys()].find((layer) => within(path, layer));
}

function verifyLayer(source, target, types, message) {
  const policy = layers.get(layerOf(relative(obsidianSource, source)));
  const allowed = [...policy.values, ...(types ? policy.types : [])];
  const imported = relative(obsidianSource, target);
  assert.ok(
    allowed.some((prefix) => within(imported, prefix)),
    `${message}: ${types ? "type" : "value"} import outside the layer`,
  );
}

function verifyBuiltin(area, source, specifier, message) {
  assert.equal(area, obsidian, message);
  const allowed = builtins.get(relative(obsidianSource, source));
  assert.ok(allowed?.test(specifier), message);
}

/** The plugin's own limits on the core's binary and on packages; `true` when nothing else applies. */
function verifyPluginExternal(source, specifier, message) {
  const path = relative(obsidianSource, source);
  if (wasm.test(specifier)) {
    assert.match(path, /^core\//, message);
    return true;
  }
  const confinement = confined.get(specifier);
  if (confinement) assert.match(path, confinement, message);
  return specifier === "obsidian";
}

function verifyImport({ area, policy, source, specifier, typeOnly: types, workspaceEntries }) {
  const message = `${source}: ${specifier}`;
  if (area === obsidian && verifyPluginExternal(source, specifier, message)) return;
  if (
    area === extension &&
    source.endsWith("/src/vault-transport.ts") &&
    specifier === "../dist/tls/vault_tls.js"
  )
    return;
  if (isBuiltin(specifier)) return verifyBuiltin(area, source, specifier, message);
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
  if (area === obsidian) verifyLayer(source, local.resolvedFileName, types, message);
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
      if (area === obsidian)
        assert.ok(layerOf(relative(obsidianSource, source)), `${source} is in no layer`);
      for (const { specifier, typeOnly: types } of moduleSpecifiers(source))
        verifyImport({ area, policy, source, specifier, typeOnly: types, workspaceEntries });
    }
  }
});
