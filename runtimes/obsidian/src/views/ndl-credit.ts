const ndlCatalogue = "https://ndlsearch.ndl.go.jp/help/api/provider#opac";
const license = "https://creativecommons.org/licenses/by/4.0/deed.ja";

/** 国立国会図書館サーチから得た書誌を見せる画面に、出典とCC BY 4.0のライセンスを示す。 */
export function mountNdlCredit(parent: HTMLElement): void {
  const credit = parent.createEl("p");
  credit.createSpan({ text: "書誌検索: " });
  credit.createEl("a", {
    text: "国立国会図書館サーチAPI／国立国会図書館蔵書",
    attr: { href: ndlCatalogue, target: "_blank", rel: "noopener noreferrer" },
  });
  credit.createSpan({ text: "（" });
  credit.createEl("a", {
    text: "CC BY 4.0",
    attr: { href: license, target: "_blank", rel: "noopener noreferrer" },
  });
  credit.createSpan({ text: "）" });
}
