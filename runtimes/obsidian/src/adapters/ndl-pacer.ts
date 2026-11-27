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
 * 国立国会図書館サーチへの問い合わせを一つずつ順に行い、前の問い合わせが終わってから次を
 * 始めるまで`gap`ミリ秒あける。混み合っていると答えたら、待つ時間を延ばしながら決まった回数だけ
 * 問い直し、それでも混み合っていれば`Busy`を投げる。待っている間に中止できる。
 */
export class Pacer {
  private tail: Promise<unknown> = Promise.resolve();
  private finished = Number.NEGATIVE_INFINITY;
  private readonly clock: Clock;
  private readonly gap: number;

  constructor(clock: Clock = systemClock, gap = 2000) {
    this.clock = clock;
    this.gap = gap;
  }

  ask<T>(request: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const turn = this.tail.then(() => this.attempts(request, signal));
    this.tail = turn.catch(() => undefined);
    return turn;
  }

  private async attempts<T>(request: () => Promise<T>, signal: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once(request, signal);
      } catch (error: unknown) {
        const wait = backoff[attempt];
        if (!(error instanceof Busy) || wait === undefined) throw error;
        await this.clock.sleep(
          Math.min(longestWait, Math.max(wait, error.retryAfter ?? 0)),
          signal,
        );
      }
    }
  }

  private async once<T>(request: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const rest = this.finished + this.gap - this.clock.now();
    if (rest > 0) await this.clock.sleep(rest, signal);
    signal.throwIfAborted();
    try {
      return await request();
    } finally {
      this.finished = this.clock.now();
    }
  }
}
