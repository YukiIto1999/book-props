import "reflect-metadata";
import { createPrivateKey, randomBytes } from "node:crypto";
import { createSecureContext, type SecureContext } from "node:tls";
import {
  BasicConstraintsExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
} from "@peculiar/x509";

const algorithm = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
const localName = /^bp-[0-9a-f]{32}\.localhost$/;

export function decodeHost(value: unknown): string | undefined {
  return typeof value === "string" && localName.test(value) ? value : undefined;
}

export function createHost(): string {
  return `bp-${randomBytes(16).toString("hex")}.localhost`;
}

export async function startTls(host: string): Promise<{ anchor: string; context: SecureContext }> {
  if (!decodeHost(host)) throw new Error("接続先のホスト名が不正です。");
  const makeKey = () => crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const [authority, server] = await Promise.all([makeKey(), makeKey()]);
  const now = Date.now();
  const dates = {
    notBefore: new Date(now - 60_000),
    notAfter: new Date(now + 365 * 86_400_000),
  };
  const issuer = `CN=Book Props ${host}`;
  const anchor = await X509CertificateGenerator.createSelfSigned(
    {
      keys: authority,
      name: issuer,
      signingAlgorithm: algorithm,
      ...dates,
      extensions: [
        new BasicConstraintsExtension(true, 0, true),
        new KeyUsagesExtension(KeyUsageFlags.keyCertSign, true),
      ],
    },
    crypto,
  );
  const leaf = await X509CertificateGenerator.create(
    {
      publicKey: server.publicKey,
      signingKey: authority.privateKey,
      issuer,
      subject: `CN=${host}`,
      signingAlgorithm: algorithm,
      ...dates,
      extensions: [
        new BasicConstraintsExtension(false, undefined, true),
        new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
        new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth]),
        new SubjectAlternativeNameExtension([{ type: "dns", value: host }]),
      ],
    },
    crypto,
  );
  const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", server.privateKey));
  try {
    const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    return {
      anchor: Buffer.from(anchor.rawData).toString("base64"),
      context: createSecureContext({
        key: key.export({ type: "pkcs8", format: "pem" }),
        cert: leaf.toString("pem"),
        minVersion: "TLSv1.3",
        maxVersion: "TLSv1.3",
      }),
    };
  } finally {
    der.fill(0);
  }
}
