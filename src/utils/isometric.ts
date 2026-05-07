// Isometric coordinate utilities.
// We use a dimetric (2:1) projection — same as AoE2.
// Tile is TILE_W wide, TILE_H tall (TILE_H = TILE_W / 2).

export const TILE_W = 64;
export const TILE_H = 32;

/** Convert grid coordinates (col, row) to screen pixel coordinates (x, y). */
export function gridToScreen(col: number, row: number): { x: number; y: number } {
  return {
    x: (col - row) * (TILE_W / 2),
    y: (col + row) * (TILE_H / 2)
  };
}

/** Convert screen pixel coordinates back to grid coordinates. May be fractional. */
export function screenToGrid(x: number, y: number): { col: number; row: number } {
  const col = (x / (TILE_W / 2) + y / (TILE_H / 2)) / 2;
  const row = (y / (TILE_H / 2) - x / (TILE_W / 2)) / 2;
  return { col, row };
}

/**
 * Sort key for proper depth ordering of isometric sprites.
 * Things further "back" (lower col + row) draw first; things in front draw on top.
 */
export function isoDepth(col: number, row: number): number {
  return col + row;
}
