import { setTimeout as delay } from "node:timers/promises";

export const timeout = 20_000;

export async function until(name, read, limit = timeout) {
  const deadline = Date.now() + limit;
  do {
    const value = await read();
    if (value) return value;
    await delay(100);
  } while (Date.now() < deadline);
  throw Error(`Timed out: ${name}`);
}
