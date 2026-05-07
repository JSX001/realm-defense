// A* pathfinder on a grid.
//
// Designed to support both the current "fixed corridor" maps (where the
// walkable mask is exactly the path tiles) and future freeform maps (where
// walkable is "everything not blocked by a tower or terrain").
//
// 8-directional movement with sqrt(2) diagonal cost.

export interface GridPos {
  col: number;
  row: number;
}

/** A walkable mask: walkable[row][col] === true means traversable. */
export type WalkableMask = boolean[][];

const SQRT2 = Math.SQRT2;

const DIRS: { dc: number; dr: number; cost: number }[] = [
  { dc: 1,  dr: 0,  cost: 1 },
  { dc: -1, dr: 0,  cost: 1 },
  { dc: 0,  dr: 1,  cost: 1 },
  { dc: 0,  dr: -1, cost: 1 },
  { dc: 1,  dr: 1,  cost: SQRT2 },
  { dc: 1,  dr: -1, cost: SQRT2 },
  { dc: -1, dr: 1,  cost: SQRT2 },
  { dc: -1, dr: -1, cost: SQRT2 }
];

/** Octile heuristic — admissible & consistent for 8-directional movement. */
function heuristic(a: GridPos, b: GridPos): number {
  const dc = Math.abs(a.col - b.col);
  const dr = Math.abs(a.row - b.row);
  // sqrt(2) for diagonal portion, 1 for the rest.
  return Math.max(dc, dr) + (SQRT2 - 1) * Math.min(dc, dr);
}

function key(c: number, r: number): number {
  // Pack into a single number for use as Map key. Assumes col/row < 65536.
  return (r << 16) | (c & 0xffff);
}

/**
 * Find a shortest path from start to goal over walkable cells.
 * Returns the path including start and goal, or null if unreachable.
 *
 * For diagonal moves we require BOTH adjacent orthogonal cells to be walkable,
 * preventing enemies from clipping diagonally through tight corners.
 */
export function findPath(start: GridPos, goal: GridPos, walkable: WalkableMask): GridPos[] | null {
  const rows = walkable.length;
  if (rows === 0) return null;
  const cols = walkable[0].length;

  if (!inBounds(start, cols, rows) || !inBounds(goal, cols, rows)) return null;
  if (!walkable[start.row][start.col] || !walkable[goal.row][goal.col]) return null;

  // Open set: a simple priority queue via sorted array. Fine for small grids.
  type Node = { col: number; row: number; g: number; f: number };
  const open: Node[] = [];
  const cameFrom = new Map<number, number>(); // childKey → parentKey
  const gScore = new Map<number, number>();   // key → best known g

  const startKey = key(start.col, start.row);
  gScore.set(startKey, 0);
  open.push({ col: start.col, row: start.row, g: 0, f: heuristic(start, goal) });

  while (open.length > 0) {
    // Pop min-f. Linear scan; cheap on grids of this size.
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIdx].f) bestIdx = i;
    const cur = open.splice(bestIdx, 1)[0];

    if (cur.col === goal.col && cur.row === goal.row) {
      return reconstruct(cameFrom, cur.col, cur.row);
    }

    const curKey = key(cur.col, cur.row);
    // If we've already found a better g for this node since enqueuing, skip.
    const bestG = gScore.get(curKey);
    if (bestG !== undefined && cur.g > bestG) continue;

    for (const d of DIRS) {
      const nc = cur.col + d.dc;
      const nr = cur.row + d.dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      if (!walkable[nr][nc]) continue;

      // No diagonal squeeze through corners.
      if (d.dc !== 0 && d.dr !== 0) {
        if (!walkable[cur.row][cur.col + d.dc]) continue;
        if (!walkable[cur.row + d.dr][cur.col]) continue;
      }

      const nKey = key(nc, nr);
      const tentativeG = cur.g + d.cost;
      const known = gScore.get(nKey);
      if (known === undefined || tentativeG < known) {
        gScore.set(nKey, tentativeG);
        cameFrom.set(nKey, curKey);
        open.push({ col: nc, row: nr, g: tentativeG, f: tentativeG + heuristic({ col: nc, row: nr }, goal) });
      }
    }
  }

  return null;
}

function inBounds(p: GridPos, cols: number, rows: number): boolean {
  return p.col >= 0 && p.col < cols && p.row >= 0 && p.row < rows;
}

function reconstruct(cameFrom: Map<number, number>, endCol: number, endRow: number): GridPos[] {
  const path: GridPos[] = [{ col: endCol, row: endRow }];
  let curKey = key(endCol, endRow);
  while (cameFrom.has(curKey)) {
    const parentKey = cameFrom.get(curKey)!;
    const c = parentKey & 0xffff;
    const r = (parentKey >> 16) & 0xffff;
    path.push({ col: c, row: r });
    curKey = parentKey;
  }
  path.reverse();
  return path;
}

/**
 * Build a walkability mask for a given map by walking each path's corridor.
 * For round 1 (preserving current behavior): each path gets its own mask
 * containing only that path's tiles.
 *
 * `pathTiles` is a list of {col,row} that should be walkable.
 */
export function maskFromTiles(cols: number, rows: number, pathTiles: GridPos[]): WalkableMask {
  const mask: boolean[][] = [];
  for (let r = 0; r < rows; r++) mask.push(new Array(cols).fill(false));
  for (const t of pathTiles) {
    if (t.row >= 0 && t.row < rows && t.col >= 0 && t.col < cols) {
      mask[t.row][t.col] = true;
    }
  }
  return mask;
}

/** Walk a series of waypoints connected by axis-aligned segments, return all tiles touched. */
export function tilesAlongWaypoints(waypoints: GridPos[]): GridPos[] {
  const out: GridPos[] = [];
  if (waypoints.length === 0) return out;
  if (waypoints.length === 1) { out.push({ ...waypoints[0] }); return out; }
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const dc = Math.sign(b.col - a.col);
    const dr = Math.sign(b.row - a.row);
    let c = a.col;
    let r = a.row;
    while (c !== b.col || r !== b.row) {
      out.push({ col: c, row: r });
      if (c !== b.col) c += dc;
      else if (r !== b.row) r += dr;
    }
  }
  // Include final waypoint.
  const last = waypoints[waypoints.length - 1];
  out.push({ ...last });
  return out;
}
