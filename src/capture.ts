import type { Bounds, CaptureOptions, CaptureResponse, Point } from "./types";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export function planTiles(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): Bounds[] {
  if (
    ![width, height, viewportWidth, viewportHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error("ページの大きさを取得できません。");
  const tiles = [];
  for (let y = 0; y < height; y += viewportHeight) {
    for (let x = 0; x < width; x += viewportWidth)
      tiles.push({
        x,
        y,
        width: Math.min(viewportWidth, width - x),
        height: Math.min(viewportHeight, height - y),
      });
  }
  return tiles;
}
export function cropTile(
  tile: Bounds,
  actual: Point,
  scaleX: number,
  scaleY: number,
): [number, number, number, number, number, number, number, number] {
  return [
    (tile.x - actual.x) * scaleX,
    (tile.y - actual.y) * scaleY,
    tile.width * scaleX,
    tile.height * scaleY,
    tile.x * scaleX,
    tile.y * scaleY,
    tile.width * scaleX,
    tile.height * scaleY,
  ];
}
async function decode(data: string) {
  const image = new Image();
  image.src = data;
  await image.decode();
  return image;
}
export async function capture({
  host,
  mode,
  cancelled = () => false,
  progress = () => {},
}: CaptureOptions): Promise<string> {
  const original = {
    x: scrollX,
    y: scrollY,
    visibility: host.style.visibility,
  };
  const restored: [HTMLElement, string, string, string][] = [];
  const setStyle = (el: HTMLElement, property: string, value: string) => {
    restored.push([
      el,
      property,
      el.style.getPropertyValue(property),
      el.style.getPropertyPriority(property),
    ]);
    el.style.setProperty(property, value, "important");
  };
  const check = () => {
    if (cancelled()) throw new Error("撮影をキャンセルしました。");
    if (document.hidden)
      throw new Error("撮影中は対象タブを開いたままにしてください。");
  };
  let lastCapture = 0;
  async function shot() {
    check();
    await delay(Math.max(0, 650 - (Date.now() - lastCapture)));
    check();
    host.style.visibility = "hidden";
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    lastCapture = Date.now();
    const result: CaptureResponse = await chrome.runtime.sendMessage({
      type: "feedback-capture",
    });
    check();
    if (!result?.data)
      throw new Error(result?.error || "画面の取得に失敗しました。");
    return result.data;
  }
  try {
    if (mode !== "full") return await shot();
    for (const el of [document.documentElement, document.body].filter(
      Boolean,
    )) {
      setStyle(el, "scroll-behavior", "auto");
      setStyle(el, "scroll-snap-type", "none");
      setStyle(el, "overflow-anchor", "none");
    }
    const scrolling = document.scrollingElement || document.documentElement;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = innerHeight;
    const width = Math.max(viewportWidth, scrolling.scrollWidth);
    const height = Math.max(viewportHeight, scrolling.scrollHeight);
    if (
      Math.ceil(width / viewportWidth) * Math.ceil(height / viewportHeight) >
      100
    )
      throw new Error(
        "このページは長すぎます。表示範囲で撮影するか、ページを短くして再試行してください。",
      );
    const tiles = planTiles(width, height, viewportWidth, viewportHeight);
    const floating = [...document.querySelectorAll<HTMLElement>("*")].filter(
      (el) =>
        el !== host &&
        !host.contains(el) &&
        ["fixed", "sticky"].includes(getComputedStyle(el).position),
    );
    let output: HTMLCanvasElement | undefined;
    let context: CanvasRenderingContext2D | null = null;
    let scaleX = 1,
      scaleY = 1;
    for (let i = 0; i < tiles.length; i++) {
      check();
      if (i === 1)
        for (const el of floating) setStyle(el, "visibility", "hidden");
      const tile = tiles[i];
      window.scrollTo({ left: tile.x, top: tile.y, behavior: "instant" });
      await delay(200);
      check();
      if (
        innerHeight !== viewportHeight ||
        document.documentElement.clientWidth !== viewportWidth
      )
        throw new Error("画面の大きさが変わりました。再度撮影してください。");
      if (
        Math.abs(scrolling.scrollHeight - height) > 2 ||
        Math.abs(scrolling.scrollWidth - width) > 2
      )
        throw new Error(
          "読み込み中にページの大きさが変わりました。読み込み完了後に再度撮影してください。",
        );
      const actual = { x: scrollX, y: scrollY };
      if (
        tile.x - actual.x < -1 ||
        tile.y - actual.y < -1 ||
        tile.x - actual.x + tile.width > viewportWidth + 1 ||
        tile.y - actual.y + tile.height > viewportHeight + 1
      )
        throw new Error(
          "ページを自動スクロールできません。表示範囲で撮影してください。",
        );
      const image = await decode(await shot());
      if (!output) {
        scaleX = image.width / innerWidth;
        scaleY = image.height / innerHeight;
        const pixelWidth = Math.round(width * scaleX),
          pixelHeight = Math.round(height * scaleY);
        if (
          pixelWidth > 32760 ||
          pixelHeight > 32760 ||
          pixelWidth * pixelHeight > 64000000
        )
          throw new Error("画像が大きすぎます。表示範囲で撮影してください。");
        output = document.createElement("canvas");
        output.width = pixelWidth;
        output.height = pixelHeight;
        context = output.getContext("2d");
        if (!context) throw new Error("画像を作成できません。");
      } else if (
        Math.abs(image.width / innerWidth - scaleX) > 0.01 ||
        Math.abs(image.height / innerHeight - scaleY) > 0.01
      )
        throw new Error(
          "撮影中に表示倍率が変わりました。再度撮影してください。",
        );
      if (!context) throw new Error("画像を作成できません。");
      context.drawImage(image, ...cropTile(tile, actual, scaleX, scaleY));
      progress(i + 1, tiles.length);
    }
    if (!output) throw new Error("画像を作成できません。");
    const data = output.toDataURL("image/png");
    if (!data.startsWith("data:image/png"))
      throw new Error("画像を作成できません。");
    return data;
  } finally {
    // Restore position while scroll-behavior is still forced to instant.
    if (mode === "full")
      window.scrollTo({
        left: original.x,
        top: original.y,
        behavior: "instant",
      });
    for (const [el, property, value, priority] of restored.reverse()) {
      if (value) el.style.setProperty(property, value, priority);
      else el.style.removeProperty(property);
    }
    host.style.visibility = original.visibility;
  }
}

/** Capture the live border box, including portions outside the viewport. */
export async function captureElement(
  element: Element,
  options: CaptureOptions,
): Promise<string> {
  const original = { x: scrollX, y: scrollY };
  const restored: [HTMLElement, string, string, string][] = [];
  const setStyle = (el: HTMLElement, property: string, value: string) => {
    restored.push([
      el,
      property,
      el.style.getPropertyValue(property),
      el.style.getPropertyPriority(property),
    ]);
    el.style.setProperty(property, value, "important");
  };
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = innerHeight;
  const rect = element.getBoundingClientRect();
  if (!element.isConnected || rect.width <= 0 || rect.height <= 0)
    throw new Error("対象要素が表示されていません。");
  const bounds = {
    x: rect.left + scrollX,
    y: rect.top + scrollY,
    width: rect.width,
    height: rect.height,
  };
  let floatingTarget = false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (["fixed", "sticky"].includes(getComputedStyle(node).position))
      floatingTarget = true;
  }
  if (
    floatingTarget &&
    (rect.left < 0 ||
      rect.top < 0 ||
      rect.right > viewportWidth ||
      rect.bottom > viewportHeight)
  )
    throw new Error("固定された要素を画面内に表示してから保存してください。");
  const tiles = planTiles(
    bounds.width,
    bounds.height,
    viewportWidth,
    viewportHeight,
  );
  if (tiles.length > 100) throw new Error("対象要素が大きすぎます。");
  try {
    for (const node of [document.documentElement, document.body]) {
      setStyle(node, "scroll-behavior", "auto");
      setStyle(node, "scroll-snap-type", "none");
      setStyle(node, "overflow-anchor", "none");
    }
    for (const node of document.querySelectorAll<HTMLElement>("*")) {
      if (
        node !== options.host &&
        !node.contains(element) &&
        !element.contains(node) &&
        ["fixed", "sticky"].includes(getComputedStyle(node).position)
      )
        setStyle(node, "visibility", "hidden");
    }
    let canvas: HTMLCanvasElement | undefined;
    let ctx: CanvasRenderingContext2D | null = null;
    let scaleX = 1,
      scaleY = 1;
    for (let i = 0; i < tiles.length; i++) {
      if (options.cancelled?.()) throw new Error("撮影をキャンセルしました。");
      const tile = tiles[i];
      if (!floatingTarget)
        window.scrollTo({
          left: bounds.x + tile.x,
          top: bounds.y + tile.y,
          behavior: "instant",
        });
      // Respect captureVisibleTab's rate limit across separate visible captures.
      await delay(i === 0 ? 200 : 650);
      const current = element.getBoundingClientRect();
      if (
        !element.isConnected ||
        innerHeight !== viewportHeight ||
        document.documentElement.clientWidth !== viewportWidth ||
        Math.abs(current.width - bounds.width) > 1 ||
        Math.abs(current.height - bounds.height) > 1 ||
        (!floatingTarget &&
          (Math.abs(current.left + scrollX - bounds.x) > 1 ||
            Math.abs(current.top + scrollY - bounds.y) > 1))
      )
        throw new Error(
          "撮影中に対象要素が変わりました。再度保存してください。",
        );
      const x = current.left + tile.x,
        y = current.top + tile.y;
      if (
        x < -1 ||
        y < -1 ||
        x + tile.width > viewportWidth + 1 ||
        y + tile.height > viewportHeight + 1
      )
        throw new Error(
          "対象要素全体を撮影できません。画面内に表示してから保存してください。",
        );
      // Nested scroll containers clip their children; don't silently export hidden pixels.
      for (
        let parent = element.parentElement;
        parent &&
        parent !== document.body &&
        parent !== document.documentElement;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent),
          box = parent.getBoundingClientRect();
        if (
          (style.overflowX !== "visible" &&
            (x < box.left || x + tile.width > box.right)) ||
          (style.overflowY !== "visible" &&
            (y < box.top || y + tile.height > box.bottom))
        )
          throw new Error(
            "スクロール領域内の要素は全体を表示してから保存してください。",
          );
      }
      const image = await decode(
        await capture({ ...options, mode: "visible" }),
      );
      if (!canvas) {
        scaleX = image.width / innerWidth;
        scaleY = image.height / innerHeight;
        const width = Math.round(bounds.width * scaleX),
          height = Math.round(bounds.height * scaleY);
        if (width > 32760 || height > 32760 || width * height > 64000000)
          throw new Error("対象要素の画像が大きすぎます。");
        canvas = document.createElement("canvas");
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        ctx = canvas.getContext("2d");
      } else if (
        Math.abs(image.width / innerWidth - scaleX) > 0.01 ||
        Math.abs(image.height / innerHeight - scaleY) > 0.01
      )
        throw new Error("撮影中に表示倍率が変わりました。");
      if (!ctx) throw new Error("画像を作成できません。");
      ctx.drawImage(
        image,
        x * scaleX,
        y * scaleY,
        tile.width * scaleX,
        tile.height * scaleY,
        tile.x * scaleX,
        tile.y * scaleY,
        tile.width * scaleX,
        tile.height * scaleY,
      );
      options.progress?.(i + 1, tiles.length);
    }
    if (!canvas) throw new Error("画像を作成できません。");
    const data = canvas.toDataURL("image/png");
    if (!data.startsWith("data:image/png"))
      throw new Error("画像を作成できません。");
    return data;
  } finally {
    window.scrollTo({ left: original.x, top: original.y, behavior: "instant" });
    for (const [node, property, value, priority] of restored.reverse()) {
      if (value) node.style.setProperty(property, value, priority);
      else node.style.removeProperty(property);
    }
  }
}
