import { execFile } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import {
  connectionFile,
  decodeConnectionCard,
  pairingProofFile,
  type ConnectionCard,
} from "@book-props/vault-contract";

const grantIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const rootName = "Book Props";
const fallbackName = "Vault";
const maxNameLength = 100;
// Windows で別の階層、代替データストリーム、末尾の切り詰めになる文字の拒否
const unsafeName = /[\\/:*?"<>|\p{Cc}]|[. ]$/u;
const run = promisify(execFile);
const guardWindows = String.raw`
$ErrorActionPreference = 'Stop'
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User
$allowed = @($user.Value, 'S-1-5-18', 'S-1-5-32-544')
function Rights([string]$Names) {
  [int][Security.AccessControl.FileSystemRights]$Names
}
$writeDirectory = Rights 'Write, DeleteSubdirectoriesAndFiles, ChangePermissions, TakeOwnership'
function Assert-NoOtherWriter([string]$Path, [string]$Label) {
  $acl = [IO.DirectoryInfo]::new($Path).GetAccessControl()
  foreach ($ace in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) { continue }
    if ($ace.AccessControlType -ne 'Allow' -or $ace.IdentityReference.Value -in $allowed) { continue }
    $blocked = $writeDirectory -band [int]$ace.FileSystemRights
    if ($blocked) {
      "$Label-writer:$blocked"
      exit 1
    }
  }
}
$stage = 'parent-read'
try {
Assert-NoOtherWriter $env:BOOK_PROPS_HOME 'parent'
$stage = 'root-read'
Assert-NoOtherWriter $env:BOOK_PROPS_ROOT 'root'
'parent-accepted'
$directory = [IO.DirectoryInfo]::new($env:BOOK_PROPS_GRANT)
if ($env:BOOK_PROPS_NEW -eq 'yes') {
  $stage = 'grant-protect'
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner($user)
  $acl.SetAccessRuleProtection($true, $false)
  $inherit = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user, 'FullControl', $inherit, 'None', 'Allow'))
  $directory.SetAccessControl($acl)
}
$stage = 'grant-read'
$acl = $directory.GetAccessControl()
if (!$acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]) -ne $user) { throw 'grant owner or inheritance' }
foreach ($ace in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
  if ($ace.AccessControlType -eq 'Allow' -and $ace.IdentityReference.Value -notin $allowed) { throw 'grant writer' }
}
} catch {
  $stage + ':' + $_.Exception.GetType().Name
  exit 1
}
`;

/** 保存済みの接続の識別子と接続用フォルダ名の組 */
export type GrantLocation = Readonly<{ id: string; name: string }>;

function folderName(name: string): boolean {
  return name.length > 0 && name.length <= maxNameLength && !unsafeName.test(name);
}

async function homeOf(profile: string): Promise<string> {
  const home = await realpath(profile);
  if (!isAbsolute(home)) throw new Error("接続フォルダの場所を確定できません。");
  return home;
}

/**
 * Vault の外にある接続用フォルダの取得
 * @param vaultPath - Vault の絶対パス
 * @param saved - 再利用する保存済みの接続用フォルダ、新規作成ならなし
 * @param profile - 接続用フォルダの親の `Book Props` を置くホーム
 * @returns 保存済みならその接続情報を持つフォルダ、新規作成なら Vault 名のフォルダ
 * @throws 接続用フォルダが Vault の中にある場合、または {@link ConnectionGrant.open} が拒否した場合
 */
export async function vaultGrant(
  vaultPath: string,
  saved?: GrantLocation,
  profile = homedir(),
): Promise<ConnectionGrant> {
  const vault = await realpath(vaultPath);
  const grant = saved
    ? await ConnectionGrant.open(saved.id, saved.name, profile)
    : await ConnectionGrant.create(basename(vault), profile);
  const path = relative(vault, grant.directory);
  if (path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))) {
    if (!saved) await grant.clear();
    throw new Error("接続用フォルダはVaultの外に置く必要があります。");
  }
  return grant;
}

/**
 * v0.3.0 までのホーム直下の接続用フォルダの削除
 * @param id - 旧形式で保存した接続の識別子
 * @param profile - 旧形式の接続用フォルダがあるホーム
 */
export async function removeLegacyGrant(id: string, profile = homedir()): Promise<void> {
  if (!grantIdPattern.test(id)) return;
  const directory = join(await homeOf(profile), `${rootName} ${id}`);
  for (const name of [connectionFile, pairingProofFile])
    await rm(join(directory, name), { force: true });
  await rmdir(directory).catch(() => undefined);
}

/** ホームの `Book Props` の下で一つの Vault の接続を受け付けるフォルダ */
export class ConnectionGrant {
  private constructor(
    readonly id: string,
    readonly name: string,
    readonly directory: string,
  ) {}

  /**
   * Vault 名の接続用フォルダの新規作成
   * @param label - フォルダ名の元にする Vault 名
   * @param profile - 接続用フォルダの親の `Book Props` を置くホーム
   * @returns 新しい識別子を持つ接続情報の未公開のフォルダ
   * @throws 同じ名前のフォルダが埋まっている場合、またはアクセス権を保護できない場合
   */
  static async create(label: string, profile = homedir()): Promise<ConnectionGrant> {
    const home = await homeOf(profile);
    const root = join(home, rootName);
    await mkdir(root, { mode: 0o700 }).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    });
    const base = folderName(label) ? label : fallbackName;
    for (let copy = 1; copy < 100; copy++) {
      const name = copy === 1 ? base : `${base} (${copy})`;
      if (!folderName(name)) break;
      const made = await mkdir(join(root, name), { mode: 0o700 }).then(
        () => true,
        (error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
          throw error;
        },
      );
      if (made) return ConnectionGrant.check(home, randomUUID(), name, true);
    }
    throw new Error("接続用フォルダの名前を決められません。");
  }

  /**
   * 保存済みの接続用フォルダの再利用
   * @param id - 保存済みの接続の識別子
   * @param name - 保存済みの接続用フォルダ名
   * @param profile - 接続用フォルダの親の `Book Props` を置くホーム
   * @returns 同じ識別子の接続情報を持つフォルダ
   * @throws 名前が `Book Props` 直下の一階層でない場合、または接続情報が別の接続のものか読めない場合
   */
  static async open(id: string, name: string, profile = homedir()): Promise<ConnectionGrant> {
    if (!grantIdPattern.test(id) || !folderName(name))
      throw new Error("接続用フォルダの記録が不正です。");
    const grant = await ConnectionGrant.check(await homeOf(profile), id, name, false);
    const card = await readFile(join(grant.directory, connectionFile), "utf8").then(
      decodeConnectionCard,
      () => undefined,
    );
    if (card?.grantId !== id) throw new Error("接続用フォルダは別の接続に使われています。");
    return grant;
  }

  private static async check(
    home: string,
    id: string,
    name: string,
    created: boolean,
  ): Promise<ConnectionGrant> {
    const root = join(home, rootName);
    const directory = join(root, name);
    try {
      if (
        dirname(directory) !== root ||
        !(await lstat(root)).isDirectory() ||
        (await realpath(root)) !== root ||
        !(await lstat(directory)).isDirectory() ||
        (await realpath(directory)) !== directory
      )
        throw new Error("接続フォルダを確認できません。");
      if (process.platform === "win32") {
        const system = process.env.SystemRoot;
        if (!system || !/^[A-Za-z]:\\/.test(home) || !/^[A-Za-z]:\\/.test(system))
          throw new Error("端末内の接続フォルダを確認できません。");
        await run(
          join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", guardWindows],
          {
            env: {
              ...process.env,
              BOOK_PROPS_HOME: home,
              BOOK_PROPS_ROOT: root,
              BOOK_PROPS_GRANT: directory,
              BOOK_PROPS_NEW: created ? "yes" : "no",
            },
            timeout: 5_000,
            windowsHide: true,
          },
        ).catch((error: unknown) => {
          const output: unknown =
            error && typeof error === "object" ? Reflect.get(error, "stdout") : undefined;
          const observed =
            typeof output === "string" ? output.trim().split(/\r?\n/).pop() : undefined;
          const reason =
            observed &&
            /^(?:(?:parent|root)-writer:\d+|(?:parent-read|root-read|grant-protect|grant-read):[A-Za-z]+Exception|parent-accepted)$/.test(
              observed,
            )
              ? observed
              : "powershell";
          throw new Error(`connection-folder:${reason}`);
        });
      } else {
        const parent = await lstat(home);
        const top = await lstat(root);
        const child = await lstat(directory);
        if (
          parent.uid !== process.getuid?.() ||
          parent.mode & 0o022 ||
          top.uid !== parent.uid ||
          top.mode & 0o022 ||
          child.uid !== parent.uid ||
          child.mode & 0o077
        )
          throw new Error("接続フォルダのアクセス権を確認できません。");
      }
      return new ConnectionGrant(id, name, directory);
    } catch (error) {
      if (created) await rmdir(directory).catch(() => undefined);
      throw error;
    }
  }

  /**
   * 同じフォルダで識別子だけを新しくした接続
   * @returns 旧識別子を照合に使うブラウザが自動では接続しない、接続情報の未公開の接続
   */
  renew(): ConnectionGrant {
    return new ConnectionGrant(randomUUID(), this.name, this.directory);
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

  /** 接続用フォルダと、空になった `Book Props` の削除 */
  async clear(): Promise<void> {
    for (const name of [connectionFile, pairingProofFile])
      await rm(join(this.directory, name), { force: true });
    await rmdir(this.directory).catch(() => undefined);
    await rmdir(dirname(this.directory)).catch(() => undefined);
  }
}
