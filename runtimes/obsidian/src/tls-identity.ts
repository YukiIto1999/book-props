import "reflect-metadata";
import { spawn } from "node:child_process";
import { createPrivateKey, randomBytes, X509Certificate } from "node:crypto";
import {
  BasicConstraintsExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
} from "@peculiar/x509";

export type Identity = Readonly<{ name: string; keyId: string; certificate: string }>;
const keyIdPattern = /^[0-9a-f]{48}$/;
const hostPattern = /^bp-[0-9a-f]{32}\.localhost$/;
const windowsVault = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$id = $env:BOOK_PROPS_KEY_ID
if ($id -notmatch '^[0-9a-f]{48}$') { exit 2 }
$folder = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'BookProps'
$path = Join-Path $folder ($id + '.dpapi')
$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
switch ($env:BOOK_PROPS_KEY_OP) {
  'write' {
    $key = [Convert]::FromBase64String([Console]::In.ReadToEnd())
    $protected = [Security.Cryptography.ProtectedData]::Protect($key, $null, $scope)
    [IO.Directory]::CreateDirectory($folder) | Out-Null
    $file = [IO.File]::Open($path, [IO.FileMode]::CreateNew)
    try { $file.Write($protected, 0, $protected.Length) } finally { $file.Dispose() }
  }
  'read' {
    $protected = [IO.File]::ReadAllBytes($path)
    $key = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, $scope)
    [Console]::Write([Convert]::ToBase64String($key))
  }
  'delete' { [IO.File]::Delete($path) }
  default { exit 2 }
}`;

async function protectedKey(
  action: "write" | "read" | "delete",
  id: string,
  input?: Buffer,
): Promise<Buffer> {
  if (!keyIdPattern.test(id)) throw new Error("鍵の識別子が不正です。");
  let command: string;
  let args: string[];
  let options: NodeJS.ProcessEnv = process.env;
  if (process.platform === "linux") {
    command = "secret-tool";
    const operation = {
      write: ["store", "--label=Book Props TLS"],
      read: ["lookup"],
      delete: ["clear"],
    }[action];
    args = [...operation, "application", "book-props-tls", "key-id", id];
  } else if (process.platform === "win32") {
    command = "powershell.exe";
    args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsVault];
    options = { ...process.env, BOOK_PROPS_KEY_ID: id, BOOK_PROPS_KEY_OP: action };
  } else {
    throw new Error("このOSで保護された鍵保管を利用できません。");
  }
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const child = spawn(command, args, {
    env: options,
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
    signal: AbortSignal.timeout(8_000),
  });
  let answer = "";
  child.stdout.setEncoding("ascii");
  child.stdout.on("data", (chunk: string) => {
    answer += chunk;
    if (answer.length > 4096) child.kill();
  });
  const failed = () => reject(new Error("OSの保護された鍵保管を利用できません。"));
  child.once("error", failed);
  child.stdin.once("error", failed);
  child.once("close", (code) => {
    if (code === 0 && answer.length <= 4096) resolve(answer.trim());
    else failed();
  });
  child.stdin.end(input?.toString("base64"));
  return Buffer.from(await promise, "base64");
}

export async function provisionIdentity(previous?: Identity): Promise<Identity> {
  const name =
    previous && hostPattern.test(previous.name)
      ? previous.name
      : `bp-${randomBytes(16).toString("hex")}.localhost`;
  const keyId = randomBytes(24).toString("hex");
  const algorithm = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
  const keys = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const certificate = await X509CertificateGenerator.createSelfSigned(
    {
      name: `CN=${name}`,
      keys,
      signingAlgorithm: algorithm,
      serialNumber: `01${randomBytes(16).toString("hex")}`,
      notBefore: new Date(Date.now() - 60_000),
      notAfter: new Date(Date.now() + 180 * 86_400_000),
      extensions: [
        new BasicConstraintsExtension(false, undefined, true),
        new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
        new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth]),
        new SubjectAlternativeNameExtension([{ type: "dns", value: name }]),
      ],
    },
    crypto,
  );
  const privateBytes = Buffer.from(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
  try {
    await protectedKey("write", keyId, privateBytes);
    const identity = { name, keyId, certificate: certificate.toString("pem") };
    const confirmed = await openIdentity(identity);
    confirmed.key.fill(0);
    return identity;
  } catch (error: unknown) {
    await protectedKey("delete", keyId).catch(() => undefined);
    throw error;
  } finally {
    privateBytes.fill(0);
  }
}

export async function openIdentity(
  identity: Identity,
): Promise<{ key: Buffer; cert: string; fingerprint: string }> {
  if (!hostPattern.test(identity.name)) throw new Error("接続先のホスト名が不正です。");
  const cert = new X509Certificate(identity.certificate);
  if (
    cert.checkHost(identity.name, { wildcards: false, subject: "never" }) !== identity.name ||
    cert.ca ||
    Date.parse(cert.validFrom) > Date.now() ||
    Date.parse(cert.validTo) <= Date.now()
  )
    throw new Error("現在の接続先証明書を使用できません。");
  const privateBytes = await protectedKey("read", identity.keyId);
  try {
    const key = createPrivateKey({ key: privateBytes, format: "der", type: "pkcs8" });
    if (!cert.checkPrivateKey(key)) throw new Error("証明書とOSが保持する鍵が一致しません。");
    return {
      key: Buffer.from(key.export({ format: "pem", type: "pkcs8" })),
      cert: identity.certificate,
      fingerprint: cert.fingerprint256,
    };
  } finally {
    privateBytes.fill(0);
  }
}

export async function dropIdentity(identity: Identity): Promise<void> {
  await protectedKey("delete", identity.keyId);
}

/** Reads a saved identity, or nothing when its stored shape is no longer readable. */
export function decodeIdentity(saved: unknown): Identity | undefined {
  if (typeof saved !== "object" || saved === null) return undefined;
  const name: unknown = Reflect.get(saved, "name");
  const keyId: unknown = Reflect.get(saved, "keyId");
  const certificate: unknown = Reflect.get(saved, "certificate");
  return typeof name === "string" && typeof keyId === "string" && typeof certificate === "string"
    ? { name, keyId, certificate }
    : undefined;
}
