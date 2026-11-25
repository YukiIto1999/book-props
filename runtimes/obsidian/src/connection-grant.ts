import { execFile } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { connectionFile, pairingProofFile, type ConnectionCard } from "@book-props/vault-contract";

const grantIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const run = promisify(execFile);
const guardWindows = String.raw`
$ErrorActionPreference = 'Stop'
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User
$allowed = @($user.Value, 'S-1-5-18', 'S-1-5-32-544')
function Rights([string]$Names) {
  [int][Security.AccessControl.FileSystemRights]$Names
}
$parent = Get-Acl -LiteralPath $env:BOOK_PROPS_HOME
$writeDirectory = Rights 'Write, DeleteSubdirectoriesAndFiles, ChangePermissions, TakeOwnership'
foreach ($ace in $parent.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
  if ($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) { continue }
  if ($ace.AccessControlType -eq 'Allow' -and $ace.IdentityReference.Value -notin $allowed -and ($writeDirectory -band [int]$ace.FileSystemRights)) { exit 1 }
}
$path = $env:BOOK_PROPS_GRANT
if ($env:BOOK_PROPS_NEW -eq 'yes') {
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner($user)
  $acl.SetAccessRuleProtection($true, $false)
  $inherit = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user, 'FullControl', $inherit, 'None', 'Allow'))
  Set-Acl -LiteralPath $path -AclObject $acl
}
$acl = Get-Acl -LiteralPath $path
if (!$acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]) -ne $user) { exit 1 }
foreach ($ace in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
  if ($ace.AccessControlType -eq 'Allow' -and $ace.IdentityReference.Value -notin $allowed) { exit 1 }
}
`;

export async function openVaultGrant(vaultPath: string, id?: string): Promise<ConnectionGrant> {
  const vault = await realpath(vaultPath);
  const grant = await ConnectionGrant.open(id);
  const path = relative(vault, grant.directory);
  if (path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))) {
    if (!id) await grant.clear();
    throw new Error("接続用フォルダはVaultの外に置く必要があります。");
  }
  return grant;
}

export class ConnectionGrant {
  private constructor(
    readonly id: string,
    readonly directory: string,
  ) {}
  static async open(grantId?: string, profile = homedir()): Promise<ConnectionGrant> {
    const id = grantId ?? randomUUID();
    if (!grantIdPattern.test(id)) throw new Error("接続フォルダの識別子が不正です。");
    const home = await realpath(profile);
    if (!isAbsolute(home)) throw new Error("接続フォルダの場所を確定できません。");
    const directory = join(home, `Book Props ${id}`);
    const existing = grantId !== undefined;
    if (!existing) await mkdir(directory, { mode: 0o700 });
    try {
      if (!(await lstat(directory)).isDirectory() || (await realpath(directory)) !== directory)
        throw new Error("接続フォルダを確認できません。");
      if (process.platform === "win32") {
        const root = process.env.SystemRoot;
        if (!root || !/^[A-Za-z]:\\/.test(home) || !/^[A-Za-z]:\\/.test(root))
          throw new Error("端末内の接続フォルダを確認できません。");
        await run(
          join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", guardWindows],
          {
            env: {
              ...process.env,
              BOOK_PROPS_HOME: home,
              BOOK_PROPS_GRANT: directory,
              BOOK_PROPS_NEW: existing ? "no" : "yes",
            },
            timeout: 5_000,
            windowsHide: true,
          },
        );
      } else {
        const parent = await lstat(home);
        const child = await lstat(directory);
        if (
          parent.uid !== process.getuid?.() ||
          parent.mode & 0o022 ||
          child.mode & 0o077 ||
          child.uid !== parent.uid
        )
          throw new Error("接続フォルダのアクセス権を確認できません。");
      }
      return new ConnectionGrant(id, directory);
    } catch (error) {
      if (!existing) await rmdir(directory).catch(() => undefined);
      throw error;
    }
  }

  async publish(card: Omit<ConnectionCard, "version" | "grantId">): Promise<void> {
    const staged = join(this.directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(staged, JSON.stringify({ version: 1, grantId: this.id, ...card }), {
        flag: "wx",
        mode: 0o600,
      });
      await rename(staged, join(this.directory, connectionFile));
    } finally {
      await rm(staged, { force: true });
    }
  }

  async consume(proof: string): Promise<boolean> {
    const path = join(this.directory, pairingProofFile);
    if (!(await lstat(path).catch(() => undefined))?.isFile()) return false;
    const file = await open(path, "r");
    try {
      const bytes = Buffer.alloc(65);
      const { bytesRead } = await file.read(bytes);
      if (bytesRead !== 64 || !timingSafeEqual(bytes.subarray(0, 64), Buffer.from(proof)))
        return false;
    } finally {
      await file.close();
    }
    await rm(path);
    return true;
  }

  async clear(): Promise<void> {
    await Promise.all(
      [connectionFile, pairingProofFile].map((name) =>
        rm(join(this.directory, name), { force: true }),
      ),
    );
    await rmdir(this.directory).catch(() => undefined);
  }
}
