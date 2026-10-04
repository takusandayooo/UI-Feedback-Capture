import type { FeedbackSession } from "./types";
export function buildPrompt(session: FeedbackSession): string {
  const lines = [
    "# UI修正依頼",
    "",
    `URL: ${session.url}`,
    `ページ: ${session.title}`,
    "",
    "以下の要素を修正してください。セレクターと周辺情報から対象を確認してください。",
  ];
  session.items.forEach((item, index) => {
    lines.push(
      "",
      `## ${index + 1}. ${item.tag}${item.text ? `「${item.text.slice(0, 100)}」` : ""}`,
      `セレクター: ${item.selector}`,
      `DOMパス: ${item.path}`,
      `現在の文言: ${item.text || "なし"}`,
      `位置（ページ座標）: x=${item.bounds.x}, y=${item.bounds.y}, 幅=${item.bounds.width}, 高さ=${item.bounds.height}`,
      `表示領域: ${item.viewport.width}×${item.viewport.height} / スクロール: ${item.viewport.scrollX}, ${item.viewport.scrollY}`,
      `スタイル: ${JSON.stringify(item.styles)}`,
      `HTML（抜粋）: ${item.html}`,
      `修正指示: ${item.instruction}`,
    );
  });
  if (session.hasImage)
    lines.push(
      "",
      "## 画像への書き込み",
      "添付するPNGの矢印・囲み・手書きも修正指示の参考にしてください。画像はテキストには含まれません。別途添付してください。",
      session.imageNote || "",
    );
  return lines.filter((line) => line !== undefined).join("\n");
}
