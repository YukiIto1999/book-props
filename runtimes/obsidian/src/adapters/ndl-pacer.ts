/** 国立国会図書館サーチが混み合って、要求を受け付けなかった(429)。`retryAfter`は待つべきミリ秒。 */
export class Busy extends Error {
  readonly retryAfter: number | undefined;

  constructor(retryAfter?: number) {
    super("国立国会図書館サーチが混み合っています。");
    this.retryAfter = retryAfter;
  }
}

/** 時計と、中止できる待ち。試験では偽の時計に差し替える。 */
export type Clock = Readonly<{
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}>;

const systemClock: Clock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    signal.throwIfAborted();
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal.addEventListener("abort", stop, { once: true });
    return promise;
  },
};

/** `Retry-After`の秒数か日時を、いまから待つミリ秒にする。読めなければ`undefined`。 */
export function retryAfter(header: string | undefined, now: number): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

/** 混み合ったときに待つ時間。`Retry-After`が長ければそちらに従うが、この上限より長くは待たない。 */
const backoff = [5000, 15_000, 30_000] as const;
const longestWait = 120_000;

/**
 * 問い合わせの目的。画面からの検索は、送っている問い合わせの次に送り、利用者が待っているので
 * 混み合っていると断られても一度だけ問い直す。登録後の照会は来た順に送り、三回まで問い直す。
 */
export type Priority = "interactive" | "background";
const retries: Readonly<Record<Priority, number>> = { interactive: 1, background: backoff.length };

/** 問い合わせの目的と、混み合っていて問い直す前に待ち始めたことの知らせ。 */
export type AskOptions = Readonly<{ priority?: Priority; onBusy?: () => void }>;

type Job = {
  /** 問い合わせを一度送り、答えが届けば`ask`の結果にする。断られたときは投げる。 */
  readonly send: () => Promise<void>;
  readonly signal: AbortSignal;
  readonly priority: Priority;
  readonly onBusy: (() => void) | undefined;
  readonly reject: (reason: unknown) => void;
  attempts: number;
};

/**
 * 国立国会図書館サーチへの問い合わせを一つずつ順に行い、前の問い合わせが終わってから次を
 * 始めるまで`gap`ミリ秒あける。画面からの検索は、待っている照会より先に送る。混み合っていると
 * 答えたら、どの問い合わせも待つ時間を延ばしながら間をあけ、断られた問い合わせを決まった回数だけ
 * 問い直し、それでも混み合っていれば`Busy`を投げる。順番を待つ間に中止した問い合わせは送らない。
 */
export class Pacer {
  private readonly queue: Job[] = [];
  private running = false;
  /** 順番を待つ問い合わせが減ったときに、次の問い合わせまでの待ちを測り直させる。 */
  private nap = new AbortController();
  private finished = Number.NEGATIVE_INFINITY;
  private busyUntil = Number.NEGATIVE_INFINITY;
  private readonly clock: Clock;
  private readonly gap: number;

  constructor(clock: Clock = systemClock, gap = 2000) {
    this.clock = clock;
    this.gap = gap;
  }

  async ask<T>(
    request: () => Promise<T>,
    signal: AbortSignal,
    options: AskOptions = {},
  ): Promise<T> {
    signal.throwIfAborted();
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const stop = () => {
      const index = this.queue.indexOf(job);
      if (index < 0) return;
      this.queue.splice(index, 1);
      this.nap.abort();
      reject(signal.reason);
    };
    const job: Job = {
      send: async () => resolve(await request()),
      signal,
      priority: options.priority ?? "background",
      onBusy: options.onBusy,
      reject,
      attempts: 0,
    };
    signal.addEventListener("abort", stop, { once: true });
    this.enqueue(job);
    void this.drain();
    try {
      return await promise;
    } finally {
      signal.removeEventListener("abort", stop);
    }
  }

  /**
   * 画面からの検索は待っている照会より前に、同じ目的の中では来た順に並べる。問い直す問い合わせは、
   * 同じ目的の中で先頭に戻す。
   */
  private enqueue(job: Job, retried = false): void {
    const index = this.queue.findIndex(
      (other) =>
        (job.priority === "interactive" && other.priority === "background") ||
        (retried && other.priority === job.priority),
    );
    this.queue.splice(index < 0 ? this.queue.length : index, 0, job);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const rest = Math.max(this.finished + this.gap, this.busyUntil) - this.clock.now();
        if (rest > 0) {
          this.nap = new AbortController();
          await this.clock.sleep(rest, this.nap.signal).catch(() => undefined);
          continue;
        }
        const job = this.queue.shift();
        if (job) await this.attempt(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async attempt(job: Job): Promise<void> {
    try {
      await job.send();
    } catch (error: unknown) {
      if (!(error instanceof Busy) || job.signal.aborted) {
        job.reject(error);
        return;
      }
      const step = backoff[job.attempts] ?? backoff[2];
      const wait = Math.min(longestWait, Math.max(step, error.retryAfter ?? 0));
      this.busyUntil = this.clock.now() + wait;
      if (job.attempts >= retries[job.priority]) {
        job.reject(error);
        return;
      }
      job.attempts += 1;
      job.onBusy?.();
      this.enqueue(job, true);
    } finally {
      this.finished = this.clock.now();
    }
  }
}
