import type { Bounds } from "./types";
export function placeComment(
  rect: Bounds,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const margin = 12,
    gap = 10;
  const above = Math.max(0, rect.y - gap - margin);
  const below = Math.max(
    0,
    viewportHeight - rect.y - rect.height - gap - margin,
  );
  const side = below >= height || below >= above ? "below" : "above";
  const available = side === "below" ? below : above;
  const maxHeight = Math.max(
    1,
    Math.min(
      viewportHeight - margin * 2,
      available >= 160 ? available : viewportHeight - margin * 2,
    ),
  );
  const actualHeight = Math.min(height, maxHeight);
  const top =
    side === "below" ? rect.y + rect.height + gap : rect.y - gap - actualHeight;
  return {
    left: Math.max(margin, Math.min(rect.x, viewportWidth - width - margin)),
    top: Math.max(
      margin,
      Math.min(top, viewportHeight - actualHeight - margin),
    ),
    maxHeight,
    side,
    visible:
      rect.x + rect.width > 0 &&
      rect.y + rect.height > 0 &&
      rect.x < viewportWidth &&
      rect.y < viewportHeight,
  };
}
