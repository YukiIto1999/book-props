import assert from "node:assert/strict";
import test from "node:test";
import { Busy, Pacer, retryAfter } from "../src/adapters/ndl-pacer.ts";

/** A clock whose sleeps pass at once and are recorded; `hold` makes the next sleep wait for an abort. */
function fakeClock() {
  const clock = {
    time: 0,
    sleeps: [],
    hold: false,
    now: () => clock.time,
    sleep(ms, signal) {
      signal.throwIfAborted();
      clock.sleeps.push(ms);
      if (!clock.hold) {
        clock.time += ms;
        return Promise.resolve();
      }
      const { promise, reject } = Promise.withResolvers();
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      return promise;
    },
  };
  return clock;
}

/** Answers in turn, taking `took` ms of fake time each. */
function replies(clock, took, ...results) {
  const calls = [];
  const ask = async () => {
    calls.push(clock.time);
    clock.time += took;
    const next = results[calls.length - 1];
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, ask };
}

void test("NDLへの問い合わせは一つずつ、前の問い合わせが終わってから2秒あけて始める", async () => {
  const clock = fakeClock();
  const pacer = new Pacer(clock, 2000);
  const signal = new AbortController().signal;
  const first = replies(clock, 700, "a");
  const second = replies(clock, 300, "b");
  const answers = await Promise.all([pacer.ask(first.ask, signal), pacer.ask(second.ask, signal)]);
  assert.deepEqual(answers, ["a", "b"]);
  assert.deepEqual(first.calls, [0]);
  assert.deepEqual(second.calls, [2700]);
  assert.deepEqual(clock.sleeps, [2000]);
});

void test("混み合っていれば5秒、15秒、30秒と延ばして問い直し、それでも混み合っていれば諦める", async () => {
  const clock = fakeClock();
  const pacer = new Pacer(clock, 2000);
  const signal = new AbortController().signal;
  const recovered = replies(clock, 0, new Busy(), new Busy(), "record");
  assert.equal(await pacer.ask(recovered.ask, signal), "record");
  assert.deepEqual(clock.sleeps, [5000, 15_000]);

  clock.sleeps.length = 0;
  const busy = replies(clock, 0, new Busy(), new Busy(), new Busy(), new Busy(), "never");
  await assert.rejects(pacer.ask(busy.ask, signal), Busy);
  assert.equal(busy.calls.length, 4);
  assert.deepEqual(clock.sleeps, [2000, 5000, 15_000, 30_000]);

  const failed = replies(clock, 0, new Error("timeout"), "never");
  await assert.rejects(pacer.ask(failed.ask, signal), /timeout/);
  assert.equal(failed.calls.length, 1);
});

void test("Retry-Afterが示す待ち時間が長ければそれに従い、上限の2分より長くは待たない", async () => {
  assert.equal(retryAfter("40", 0), 40_000);
  assert.equal(retryAfter("Thu, 01 Jan 1970 00:01:00 GMT", 30_000), 30_000);
  assert.equal(retryAfter("soon", 0), undefined);
  assert.equal(retryAfter(undefined, 0), undefined);
  const clock = fakeClock();
  const pacer = new Pacer(clock, 2000);
  const signal = new AbortController().signal;
  const told = replies(clock, 0, new Busy(40_000), new Busy(1000), new Busy(600_000), "record");
  assert.equal(await pacer.ask(told.ask, signal), "record");
  assert.deepEqual(clock.sleeps, [40_000, 15_000, 120_000]);
});

void test("待っている間に中止すると、問い直さずに中止の理由で終わり、次の問い合わせは受け付ける", async () => {
  const clock = fakeClock();
  const pacer = new Pacer(clock, 2000);
  const stopped = new AbortController();
  const busy = replies(clock, 0, new Busy(), "never");
  clock.hold = true;
  const pending = pacer.ask(busy.ask, stopped.signal);
  await new Promise((resolve) => setImmediate(resolve));
  stopped.abort(new Error("stopped"));
  await assert.rejects(pending, /stopped/);
  assert.equal(busy.calls.length, 1);
  clock.hold = false;
  const next = replies(clock, 0, "later");
  assert.equal(await pacer.ask(next.ask, new AbortController().signal), "later");
});
