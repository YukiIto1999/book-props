import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { connectionFile } from "@book-props/vault-contract";
import { ConnectionGrant, vaultGrant } from "../../src/connection-grant.ts";
import { establish, SetupFailure } from "../../src/connection-setup.ts";
import { Connection, scopeOf } from "../../src/connection.ts";
import { createHost } from "../../src/tls-identity.ts";
import { post, prove, readCard } from "./connection-support.mjs";

async function temporary(context, prefix) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  context.after(async () => await rm(path, { recursive: true, force: true }));
  return realpath(path);
}

async function vaultNamed(context, name) {
  const vault = join(await temporary(context, "book-props-vaults-"), name);
  await mkdir(vault);
  return vault;
}

function setup(context, vault, profile) {
  const host = createHost();
  const scope = scopeOf(vault, "Books");
  const records = [];
  const start = async (grant) => {
    const connection = await Connection.start(host, 0, scope, grant, async () => ({
      kind: "unavailable",
    }));
    context.after(() => connection.stop());
    return connection;
  };
  const options = {
    vault,
    scope,
    profile,
    start,
    save: async (record) => {
      records.push(record);
    },
    reopen: async () => assert.fail("nothing to reopen"),
  };
  return { records, start, options };
}

await test("connection folders are named after the Vault under Book Props and numbered when taken", async (context) => {
  const home = await temporary(context, "book-props-profile-");
  const first = await vaultGrant(await vaultNamed(context, "書庫"), undefined, home);
  const second = await vaultGrant(await vaultNamed(context, "書庫"), undefined, home);
  assert.equal(first.directory, join(home, "Book Props", "書庫"));
  assert.equal(second.directory, join(home, "Book Props", "書庫 (2)"));
  assert.deepEqual(await readdir(home), ["Book Props"]);
  await first.clear();
  await second.clear();
  assert.deepEqual(await readdir(home), []);
});

await test("a saved folder name cannot point the connection outside Book Props", async (context) => {
  const home = await temporary(context, "book-props-profile-");
  const vault = await vaultNamed(context, "書庫");
  const { options } = setup(context, vault, home);
  const known = await vaultGrant(vault, undefined, home);
  await mkdir(join(home, "escape"));
  for (const name of ["..", ".", "../escape", "..\\escape", "a/b", "書庫:card", "escape "]) {
    await assert.rejects(ConnectionGrant.open(known.id, name, home), {
      message: "接続用フォルダの記録が不正です。",
    });
  }
  const saved = { id: known.id, scope: options.scope, name: "../escape" };
  const connection = await establish({ ...options, saved });
  assert.equal(dirname(connection.grant.directory), join(home, "Book Props"));
  assert.deepEqual(await readdir(join(home, "escape")), []);
});

await test("a restored record does not take over the folder another Vault reuses", async (context) => {
  const home = await temporary(context, "book-props-profile-");
  const first = setup(context, await vaultNamed(context, "書庫"), home);
  const second = setup(context, await vaultNamed(context, "書庫"), home);
  const departed = await establish(first.options);
  departed.stop();
  await departed.grant.clear();
  const current = await establish(second.options);
  assert.equal(current.grant.directory, departed.grant.directory);
  const [returning] = first.records;
  await assert.rejects(ConnectionGrant.open(returning.id, returning.name, home), {
    message: "接続用フォルダは別の接続に使われています。",
  });
  const restored = await establish({ ...first.options, saved: returning });
  assert.equal(restored.grant.directory, join(home, "Book Props", "書庫 (2)"));
  assert.equal((await readCard(current.grant)).grantId, second.records[0].id);
});

await test("reconfiguring renews the folder's connection ID and a failed save keeps the saved one", async (context) => {
  const home = await temporary(context, "book-props-profile-");
  const { records, start, options } = setup(context, await vaultNamed(context, "書庫"), home);
  const first = await establish(options);
  const earlier = await readCard(first.grant);
  first.stop();
  const second = await establish({ ...options, saved: records[0], running: first.grant });
  assert.equal(second.grant.directory, first.grant.directory);
  assert.notEqual(records[1].id, records[0].id);
  const current = await readCard(second.grant);
  assert.equal(current.grantId, records[1].id);
  await assert.rejects(ConnectionGrant.open(records[0].id, records[0].name, home), {
    message: "接続用フォルダは別の接続に使われています。",
  });
  const stale = { action: "pair", code: randomBytes(16).toString("base64url") };
  await prove(second.grant, earlier.anchor, stale.code);
  assert.equal((await post(second, current.anchor, stale)).payload.kind, "unauthorized");
  second.stop();
  const reopened = [];
  await assert.rejects(
    establish({
      ...options,
      saved: records[1],
      running: second.grant,
      save: async () => {
        throw new Error("disk full");
      },
      reopen: async (grant) => {
        reopened.push(await start(grant));
      },
    }),
    (error) => error instanceof SetupFailure && error.stage === "save",
  );
  assert.equal(reopened.length, 1);
  assert.equal((await readCard(second.grant)).grantId, records[1].id);
  const kept = await ConnectionGrant.open(records[1].id, records[1].name, home);
  assert.equal(kept.directory, second.grant.directory);
});

await test("a renewed ID published without being saved leaves the folder to the same Vault", async (context) => {
  const home = await temporary(context, "book-props-profile-");
  const { records, start, options } = setup(context, await vaultNamed(context, "書庫"), home);
  const first = await establish(options);
  first.stop();
  const unsaved = first.grant.renew();
  (await start(unsaved)).stop();
  assert.equal((await readCard(first.grant)).grantId, unsaved.id);
  const restored = await establish({ ...options, saved: records[0] });
  assert.equal(restored.grant.directory, first.grant.directory);
  assert.deepEqual(await readdir(join(home, "Book Props")), ["書庫"]);
  assert.equal((await readCard(restored.grant)).grantId, records[1].id);
});

await test("moving a v0.3.0 connection removes its folder from the home directory", async (context) => {
  const home = await temporary(context, "book-props-profile-");
  const vault = await vaultNamed(context, "書庫");
  const { options } = setup(context, vault, home);
  const id = crypto.randomUUID();
  const legacy = join(home, `Book Props ${id}`);
  await mkdir(legacy);
  await writeFile(join(legacy, connectionFile), "{}");
  const connection = await establish({ ...options, saved: { id, scope: options.scope } });
  assert.equal(connection.grant.directory, join(home, "Book Props", "書庫"));
  assert.deepEqual(await readdir(home), ["Book Props"]);
});
