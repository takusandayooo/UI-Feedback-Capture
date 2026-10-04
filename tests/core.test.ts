import { describe, expect, test } from "bun:test";
import { cropTile, planTiles } from "../src/capture";
import { placeComment } from "../src/comment-position";
import { bindIMEInput } from "../src/editing";
import { buildPrompt } from "../src/prompt";
import type { FeedbackSession, TextInput } from "../src/types";

describe("日本語入力とキャプチャ", () => {
  test("IMEの変換中は保存せず、確定時に一度だけ保存する", async () => {
    const target = Object.assign(new EventTarget(), {
      value: "",
    }) as unknown as TextInput;
    const saved: string[] = [];
    bindIMEInput(target, (value) => saved.push(value));
    target.dispatchEvent(new Event("compositionstart"));
    target.value = "nihon";
    target.dispatchEvent(
      Object.assign(new Event("input"), { isComposing: true }),
    );
    expect(saved).toEqual([]);
    target.value = "日本語";
    target.dispatchEvent(new Event("compositionend"));
    target.dispatchEvent(new Event("input"));
    await Promise.resolve();
    expect(saved).toEqual(["日本語"]);
  });
  test("末尾のタイルを実際のスクロール位置に合わせて切り抜く", () => {
    const tiles = planTiles(800, 1800, 800, 700);
    expect(tiles.at(-1)).toEqual({ x: 0, y: 1400, width: 800, height: 400 });
    expect(cropTile(tiles[2], { x: 0, y: 1100 }, 2, 2)).toEqual([
      0, 600, 1600, 800, 0, 2800, 1600, 800,
    ]);
    expect(() => planTiles(0, 1, 800, 700)).toThrow();
  });
  test("複数の修正コメントと画像コメントをプロンプトに含める", () => {
    const session: FeedbackSession = {
      url: "https://example.test",
      title: "例",
      items: [],
      hasImage: true,
      imageNote: "囲んだ場所を修正",
    };
    for (const instruction of ["余白を半分に", "文字を大きく"])
      session.items.push({
        tag: "div",
        selector: "#target",
        path: "body > div",
        text: "対象",
        html: "<div>対象</div>",
        styles: { color: "red" },
        bounds: { x: 0, y: 0, width: 100, height: 30 },
        viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0 },
        instruction,
      });
    const prompt = buildPrompt(session);
    expect(prompt).toContain("## 2. div");
    expect(prompt).toContain("余白を半分に");
    expect(prompt).toContain("文字を大きく");
    expect(prompt).toContain("囲んだ場所を修正");
  });
});

test("コメント欄は上下の空きに応じて配置し、画面の右端を越えない", () => {
  const below = placeComment(
    { x: 100, y: 100, width: 160, height: 50 },
    330,
    250,
    1200,
    800,
  );
  expect(below.side).toBe("below");
  expect(below.top).toBe(160);
  const above = placeComment(
    { x: 1100, y: 720, width: 80, height: 40 },
    330,
    250,
    1200,
    800,
  );
  expect(above.side).toBe("above");
  expect(above.top).toBe(460);
  expect(above.left).toBe(858);
  expect(
    placeComment({ x: 0, y: -300, width: 100, height: 50 }, 330, 250, 1200, 800)
      .visible,
  ).toBe(false);
});

test("同期したコメントから元の値へ戻す入力も保存し、IME変換は上書きしない", () => {
  const target = Object.assign(new EventTarget(), {
    value: "元の値",
  }) as unknown as TextInput;
  const saved: string[] = [];
  const binding = bindIMEInput(target, (value) => {
    saved.push(value);
  });
  expect(binding.setValue("変更後")).toBe(true);
  target.value = "元の値";
  target.dispatchEvent(new Event("input"));
  expect(saved).toEqual(["元の値"]);
  target.dispatchEvent(new Event("compositionstart"));
  expect(binding.setValue("上書きしない")).toBe(false);
  expect(target.value).toBe("元の値");
});
