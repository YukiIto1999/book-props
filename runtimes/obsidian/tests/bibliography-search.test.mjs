import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { Readable } from "node:stream";
import test, { mock } from "node:test";
import { bibliographySources } from "../src/adapters/bibliography-sources.ts";
import { core } from "./core.mjs";

const isbn = "9784569857152";
const fixture = (name) => readFileSync(new URL(`./fixtures/ndl/${name}.xml`, import.meta.url));
const answer = fixture(`isbn-${isbn}`);
const tooMany = fixture("too-many-requests");
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * 国立国会図書館サーチの代わりに、問い合わせを受けたまま、`respond`を呼ぶまで答えない。
 * 時間は偽物で、`elapse`までに期限が来た`AbortSignal.timeout`だけが中止される。
 * 問い合わせの間をあける待ちも偽の時計で進める。
 */
function slowNdl(t) {
  const deadlines = [];
  const asked = [];
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  t.mock.method(AbortSignal, "timeout", (ms) => {
    const deadline = new AbortController();
    deadlines.push({ ms, deadline });
    return deadline.signal;
  });
  t.mock.method(https, "get", (url, options, callback) => {
    const request = new EventEmitter();
    options.signal.addEventListener("abort", () => request.emit("error", options.signal.reason), {
      once: true,
    });
    asked.push({
      url: new URL(url),
      agent: options.headers["User-Agent"],
      respond(statusCode = 200, body = answer) {
        if (options.signal.aborted) return;
        const response = Readable.from([body]);
        Object.assign(response, { statusCode, headers: {} });
        callback(response);
      },
    });
    return request;
  });
  syncBuiltinESMExports();
  t.after(() => {
    mock.restoreAll();
    syncBuiltinESMExports();
  });
  return {
    asked,
    elapse(ms) {
      for (const { ms: limit, deadline } of deadlines)
        if (limit <= ms) deadline.abort(new DOMException("timed out", "TimeoutError"));
    },
    tick(ms) {
      t.mock.timers.tick(ms);
    },
  };
}

void test("初めて調べるISBNに国立国会図書館サーチが45秒かかっても、画面からの検索は答えを待つ", async (t) => {
  const ndl = slowNdl(t);
  const found = bibliographySources(core).search("isbn", isbn, new AbortController().signal);
  await settle();
  assert.equal(ndl.asked.length, 1);
  assert.equal(ndl.asked[0].url.searchParams.get("isbn"), isbn);
  // 2026-11-29に測った、キャッシュにないISBNへの応答は2秒から45秒かかった。
  ndl.elapse(45_000);
  ndl.asked[0].respond();
  const outcome = await found;
  assert.equal(outcome.kind, "found");
  assert.deepEqual(
    outcome.candidates.map(({ title }) => title),
    ["夜廻三"],
  );
});

void test("待っている検索は、画面を閉じると答えを待たずにやめる", async (t) => {
  const ndl = slowNdl(t);
  const closing = new AbortController();
  const found = bibliographySources(core).search("isbn", isbn, closing.signal);
  await settle();
  closing.abort();
  await assert.rejects(found, { name: "AbortError" });
  ndl.asked[0].respond();
});

void test("画面からの検索は、登録後の照会に答えが届き、2秒あけてから送る", async (t) => {
  const ndl = slowNdl(t);
  const sources = bibliographySources(core);
  const signal = new AbortController().signal;
  const states = [];
  const looked = sources.record(isbn, signal);
  await settle();
  const found = sources.search("isbn", isbn, signal, (state) => states.push(state));
  await settle();
  // 照会に答えが届くまでは、画面からの検索は順番を待つ。
  assert.equal(ndl.asked.length, 1);
  assert.match(ndl.asked[0].agent, /after registration/);
  assert.deepEqual(states, []);
  ndl.asked[0].respond();
  assert.ok(await looked);
  ndl.tick(1999);
  await settle();
  assert.equal(ndl.asked.length, 1);
  ndl.tick(1);
  await settle();
  assert.equal(ndl.asked.length, 2);
  assert.match(ndl.asked[1].agent, /interactive/);
  assert.deepEqual(states, ["asking"]);
  ndl.asked[1].respond();
  assert.equal((await found).kind, "found");
});

void test("混み合っていると断られたら、画面からの検索は5秒待って一度だけ問い直し、それでも断られれば混み合っていると答える", async (t) => {
  const ndl = slowNdl(t);
  const states = [];
  const found = bibliographySources(core).search(
    "isbn",
    isbn,
    new AbortController().signal,
    (state) => states.push(state),
  );
  await settle();
  ndl.asked[0].respond(429, tooMany);
  await settle();
  assert.deepEqual(states, ["asking", "busy"]);
  ndl.tick(5000);
  await settle();
  assert.equal(ndl.asked.length, 2);
  // 国立国会図書館サーチは、同時アクセス数の上限を本文だけで知らせることもある。
  ndl.asked[1].respond(200, tooMany);
  assert.deepEqual(await found, { kind: "busy" });
  assert.deepEqual(states, ["asking", "busy", "asking"]);
  assert.equal(ndl.asked.length, 2);
});
