import { Notice, type Plugin } from "obsidian";
import type { NoteFormat } from "../adapters/note-format/note-format.ts";

const templates = {
  impression: { name: "感想のひな型を挿入", body: "## 印象に残った場面\n\n## 感想\n" },
  reference: {
    name: "実用書メモのひな型を挿入",
    body: "## 要点\n\n## 試してみること\n\n## 関連するメモ\n",
  },
} as const;

export function addNoteTemplates(
  plugin: Plugin,
  bookFolder: () => string,
  notes: NoteFormat,
): void {
  for (const [id, template] of Object.entries(templates)) {
    plugin.addCommand({
      id: `insert-${id}-template`,
      name: template.name,
      editorCallback: (editor, view) => {
        try {
          const folder = bookFolder();
          if (
            !folder ||
            !view.file?.path.startsWith(`${folder}/`) ||
            !notes.readScoped(editor.getValue())
          ) {
            new Notice("書籍フォルダにある本ページを編集しているときに使えます。");
            return;
          }
          const line = editor.lastLine();
          editor.replaceRange(`\n\n${template.body}`, { line, ch: editor.getLine(line).length });
        } catch {
          new Notice("本ページを確認できません。");
        }
      },
    });
  }
}
