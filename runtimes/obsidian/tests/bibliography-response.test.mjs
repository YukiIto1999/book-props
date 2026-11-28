import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, get } from "node:http";
import test from "node:test";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { responseText } from "../src/adapters/bibliography-sources.ts";

/** 一つの応答を返す手元のHTTPサーバーに問い合わせ、その応答本文を`responseText`で読む。 */
async function readServed(encoding, body) {
  const server = createServer((_, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      ...(encoding ? { "Content-Encoding": encoding } : {}),
    });
    response.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { port } = server.address();
    const { promise, resolve, reject } = Promise.withResolvers();
    get(`http://127.0.0.1:${port}/`, (response) =>
      responseText(response).then(resolve, reject),
    ).once("error", reject);
    return await promise;
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

void test("書誌の応答は圧縮の方式に従って展開して読み、大きさの上限は展開した後で数える", async () => {
  const page =
    '<!doctype html><span id="productTitle">ポケットモンスター ビジュアルアートブック</span>';
  const html = Buffer.from(page);
  // Amazonは`Accept-Encoding`のない問い合わせにもgzipで応える。
  assert.equal(await readServed("gzip", gzipSync(html)), page);
  assert.equal(await readServed("br", brotliCompressSync(html)), page);
  assert.equal(await readServed("deflate", deflateSync(html)), page);
  assert.equal(await readServed(undefined, html), page);
  await assert.rejects(readServed("zstd", html), /読めませんでした/);
  const inflated = gzipSync(Buffer.alloc(5 * 1024 * 1024 + 1, 0x20));
  assert.ok(inflated.length < 64 * 1024);
  await assert.rejects(readServed("gzip", inflated), /大きすぎます/);
});
