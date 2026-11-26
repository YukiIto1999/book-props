import { Notice, type App } from "obsidian";
import type { Request, Response } from "@book-props/vault-contract";
import type { Catalog, Product, Result } from "../catalog/catalog.ts";
import type { LocalAction } from "./registration-messages.ts";

type OpenRequest = Extract<Request, { action: "open" }>;
/** 拡張からの要求に応えるあいだの、プラグインの状態と画面。 */
export type ExtensionHost = Readonly<{
  app: App;
  /** 書籍フォルダ */
  folder: () => string;
  /** 要求を受けた目録が、まだ書籍フォルダの目録か。フォルダを変えた後の要求には応えない。 */
  current: (catalog: Catalog) => boolean;
  openRegistration: (catalog: Catalog, product?: Product, intent?: LocalAction) => void;
}>;

async function showInspection(
  host: ExtensionHost,
  inspection: Extract<Result, { kind: "unreadable" | "observed" }>,
  catalog: Catalog,
  product: OpenRequest["product"],
): Promise<Response> {
  const { path } = inspection;
  window.focus();
  if (!path) {
    host.openRegistration(catalog, product);
    return { kind: "opened" };
  }
  const { vault, workspace } = host.app;
  const file = vault.getFileByPath(path);
  if (!file || !file.path.startsWith(`${host.folder()}/`)) return { kind: "unavailable" };
  if (inspection.kind === "unreadable") {
    await workspace.getLeaf(false).openFile(file, {
      state: { mode: "source", source: true },
    });
    new Notice(
      `「${file.path}」を読み取れません。${inspection.reason} 記録を修正してから、Chromeで照合し直してください。`,
      12_000,
    );
  } else await workspace.getLeaf(false).openFile(file);
  return { kind: "opened" };
}

/** Brings Obsidian forward on the book page the extension asked for, or on registration when no book matches. */
async function openFromExtension(
  host: ExtensionHost,
  request: OpenRequest,
  catalog: Catalog,
  signal: AbortSignal,
): Promise<Response> {
  if (request.intent) {
    window.focus();
    host.openRegistration(catalog, request.product, request.intent);
    return { kind: "opened" };
  }
  const inspection = await catalog.execute({ action: "inspect", product: request.product }, signal);
  if (signal.aborted || !host.current(catalog)) return { kind: "unavailable" };
  if (inspection.kind !== "unreadable" && inspection.kind !== "observed")
    return { kind: inspection.kind === "conflict" ? "conflict" : "unavailable" };
  return showInspection(host, inspection, catalog, request.product);
}

/** 拡張からの要求を目録で処理し、拡張に返す答えにする。 */
export async function answerExtension(
  host: ExtensionHost,
  catalog: Catalog,
  request: Exclude<Request, { action: "pair" | "status" }>,
  signal: AbortSignal,
): Promise<Response> {
  if (!host.current(catalog) || signal.aborted) return { kind: "unavailable" };
  if (request.action === "open") return openFromExtension(host, request, catalog, signal);
  const execution =
    request.action === "reconcile"
      ? await catalog.reconcile({ ...request, action: "purchase" }, signal)
      : await catalog.execute(request, signal);
  if (execution.kind === "observed")
    return {
      kind: "observed",
      ownership: execution.outcome.ownership,
      wanted: execution.outcome.wanted,
    };
  return { kind: execution.kind };
}
