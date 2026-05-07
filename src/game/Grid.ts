import { Container, Graphics } from 'pixi.js';
import { MapDef, TileType } from '../data/maps';
import { gridToScreen, screenToGrid, isoDepth, TILE_W, TILE_H } from '../utils/isometric';
import { Tower } from '../entities/Tower';
import { findPath, maskFromTiles, tilesAlongWaypoints, WalkableMask, GridPos } from './Pathfinding';

export interface TileClick {
  col: number;
  row: number;
  type: TileType;
  buildable: boolean;
}

export class Grid {
  public container: Container;
  public mapDef: MapDef;
  private towerMap: Map<string, Tower> = new Map();
  private tileLayer: Container;
  private hoverIndicator: Graphics;
  private pathPreviewLayer: Graphics;
  private lastHover: { col: number; row: number } | null = null;
  /** Whether path preview is currently being shown. Lets us avoid redundant redraws. */
  private previewVisible = false;
  /** Set by Game when player has a tower build selected. Drives hypothetical-path preview. */
  private buildPreviewActive = false;
  /** Set by Game alongside buildPreviewActive. False = selected tower is unaffordable. */
  private buildAffordable = true;
  /** Throttle: timestamp (ms) of the last refreshPathPreview call. */
  private lastPreviewRefresh = 0;
  /** Throttle: pending setTimeout ID for a deferred refresh, if any. */
  private pendingPreviewTimer: number | null = null;
  private onTileClick: ((tile: TileClick) => void) | null = null;
  private onTileHover: ((col: number, row: number) => void) | null = null;

  /** Per-path walkability mask. Index matches mapDef.paths. */
  private pathMasks: WalkableMask[] = [];
  /** Per-path start and goal tiles (derived from waypoints). */
  private pathEndpoints: { start: GridPos; goal: GridPos }[] = [];
  /** For freeform maps: base walkable mask (terrain only, no towers). */
  private freeformBaseMask: WalkableMask | null = null;

  constructor(mapDef: MapDef) {
    this.mapDef = mapDef;
    this.container = new Container();
    this.container.sortableChildren = true;

    this.tileLayer = new Container();
    this.tileLayer.sortableChildren = true;
    this.container.addChild(this.tileLayer);

    this.drawTiles();
    this.drawSpawnMarkers();

    this.hoverIndicator = new Graphics();
    this.hoverIndicator.visible = false;
    this.container.addChild(this.hoverIndicator);

    // Path preview overlay. Drawn above tiles, below hoverIndicator, towers,
    // and units. Shown only on freeform maps.
    this.pathPreviewLayer = new Graphics();
    this.pathPreviewLayer.visible = false;
    this.container.addChild(this.pathPreviewLayer);

    this.buildPathMasks();
    this.attachInput();

    // On freeform maps, show the initial paths from each spawn so the player
    // sees where enemies will go before they even start building.
    if (this.isFreeform()) this.refreshPathPreview();
  }

  private isFreeform(): boolean {
    return !!this.mapDef.freeform;
  }

  /** For each declared path, build a walkability mask covering only that path's corridor. */
  private buildPathMasks(): void {
    if (this.isFreeform()) {
      // For freeform, build the base mask once from terrain.
      this.freeformBaseMask = this.buildFreeformBaseMask();
      // Endpoints from spawn[0] of each path, goal = village (paths[0][last]).
      const goal = this.mapDef.paths[0][this.mapDef.paths[0].length - 1];
      for (const waypoints of this.mapDef.paths) {
        this.pathEndpoints.push({
          start: { ...waypoints[0] },
          goal: { ...goal }
        });
        // Empty per-path mask not used in freeform; pushed for index alignment.
        this.pathMasks.push([]);
      }
      return;
    }
    // Corridor mode: each path has its own mask of corridor tiles.
    for (const waypoints of this.mapDef.paths) {
      const tiles = tilesAlongWaypoints(waypoints);
      const mask = maskFromTiles(this.mapDef.cols, this.mapDef.rows, tiles);
      this.pathMasks.push(mask);
      this.pathEndpoints.push({
        start: { ...waypoints[0] },
        goal: { ...waypoints[waypoints.length - 1] }
      });
    }
  }

  /**
   * Freeform base mask: every grass tile is walkable. Spawns and the village
   * tile are also walkable (they may not be type 'grass'). Stone/water/forest
   * are NOT walkable.
   *
   * The live mask = this base AND NOT any tower-occupied tile, computed
   * on demand by `currentFreeformMask()`.
   */
  private buildFreeformBaseMask(): WalkableMask {
    const cols = this.mapDef.cols;
    const rows = this.mapDef.rows;
    const mask: boolean[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < cols; c++) {
        row.push(this.mapDef.tiles[r][c] === 'grass');
      }
      mask.push(row);
    }
    // Force spawn and goal tiles walkable, regardless of terrain type.
    for (const waypoints of this.mapDef.paths) {
      const spawn = waypoints[0];
      const goal = waypoints[waypoints.length - 1];
      if (mask[spawn.row]) mask[spawn.row][spawn.col] = true;
      if (mask[goal.row]) mask[goal.row][goal.col] = true;
    }
    return mask;
  }

  /**
   * Live freeform mask: base mask minus tiles currently occupied by towers.
   * The village tile and spawn tiles are never blocked even if a tower
   * exists there (it shouldn't — see canBuildAt — but defensive).
   */
  private currentFreeformMask(): WalkableMask {
    return this.freeformMaskFiltered(false);
  }

  /**
   * Build the live freeform mask. If `ignoreWalls` is true, wall-type towers
   * (palisade, wall) are treated as walkable. Sappers use this so they can
   * pathfind THROUGH walls, then chew them on arrival.
   */
  private freeformMaskFiltered(ignoreWalls: boolean): WalkableMask {
    if (!this.freeformBaseMask) return [];
    const rows = this.mapDef.rows;
    const mask: boolean[][] = [];
    for (let r = 0; r < rows; r++) mask.push(this.freeformBaseMask[r].slice());
    for (const t of this.towerMap.values()) {
      if (ignoreWalls && t.isWall()) continue;
      if (mask[t.row]) mask[t.row][t.col] = false;
    }
    return mask;
  }

  /** A* pathfind from the path's start to its goal. Tower-aware in freeform mode.
   *  When `ignoreWalls` is true, wall-type towers (palisade, wall) don't block. */
  findPathForRoute(pathIndex: number, ignoreWalls = false): GridPos[] | null {
    const endpoints = this.pathEndpoints[pathIndex];
    if (!endpoints) return null;
    const mask = this.isFreeform() ? this.freeformMaskFiltered(ignoreWalls) : this.pathMasks[pathIndex];
    if (!mask || mask.length === 0) return null;
    return findPath(endpoints.start, endpoints.goal, mask);
  }

  /**
   * Pathfind from an arbitrary tile to a goal. Used for replanning live enemies
   * after a tower is added/removed on a freeform map. The enemy's tile must be
   * walkable on the current mask (or we make it temporarily walkable to allow
   * starting from there).
   */
  findPathFromTile(start: GridPos, goal: GridPos, ignoreWalls = false): GridPos[] | null {
    if (!this.isFreeform()) return null;
    const mask = this.freeformMaskFiltered(ignoreWalls);
    if (!mask[start.row]) return null;
    // Force the start tile walkable in case the enemy is mid-tile on a tower
    // tile (shouldn't happen, but defensive).
    const wasWalkable = mask[start.row][start.col];
    mask[start.row][start.col] = true;
    const path = findPath(start, goal, mask);
    if (!wasWalkable) mask[start.row][start.col] = false;
    return path;
  }

  /** Get the spawn tile for a path index. */
  getSpawnTile(pathIndex: number): GridPos | null {
    return this.pathEndpoints[pathIndex] ? { ...this.pathEndpoints[pathIndex].start } : null;
  }

  /** Get the goal tile (the village) used by all paths in freeform mode. */
  getGoalTile(): GridPos | null {
    if (this.pathEndpoints.length === 0) return null;
    return { ...this.pathEndpoints[0].goal };
  }

  /**
   * Check if placing a tower at (col,row) would still leave a valid path
   * from EVERY spawn to the goal. Only relevant in freeform mode.
   */
  canBuildAt(col: number, row: number): boolean {
    if (!this.isFreeform()) {
      // Corridor mode: only grass tiles are buildable, no path-existence check needed.
      const type = this.mapDef.tiles[row]?.[col];
      return type === 'grass' && !this.hasTower(col, row);
    }
    const type = this.mapDef.tiles[row]?.[col];
    if (type !== 'grass') return false;
    if (this.hasTower(col, row)) return false;
    // Don't allow building on a spawn or the goal tile.
    for (const ep of this.pathEndpoints) {
      if (ep.start.col === col && ep.start.row === row) return false;
      if (ep.goal.col === col && ep.goal.row === row) return false;
    }
    // Build a hypothetical mask with this tile blocked, then check
    // every spawn can still reach the goal.
    const mask = this.currentFreeformMask();
    if (!mask[row]) return false;
    mask[row][col] = false;
    for (const ep of this.pathEndpoints) {
      const path = findPath(ep.start, ep.goal, mask);
      if (!path) return false;
    }
    return true;
  }

  /**
   * Called by Game when the player selects or deselects a tower to build, OR
   * when their resources change (which may flip affordability).
   * - active: true while a build is selected at all
   * - affordable: true while the selected build can currently be paid for
   */
  setBuildPreviewActive(active: boolean, affordable: boolean = true): void {
    this.buildPreviewActive = active;
    this.buildAffordable = affordable;
    if (this.isFreeform()) {
      // Force a redraw on the last hovered tile so the preview reflects
      // the new active state immediately.
      this.refreshPathPreview();
    } else {
      this.pathPreviewLayer.visible = false;
      this.previewVisible = false;
    }
    // The hover indicator color depends on affordability; refresh it too.
    if (this.lastHover) {
      const { col, row } = this.lastHover;
      const buildable = this.canBuildAt(col, row);
      this.showHover(col, row, buildable);
    }
  }

  /**
   * Public, throttled entry point. Coalesces calls so we run A* at most once
   * per ~50ms regardless of how fast the cursor moves. If a redraw is
   * suppressed, a trailing call is scheduled so the final state is correct.
   * Public so Game can call it after towers are placed/sold.
   */
  refreshPathPreview(): void {
    const PREVIEW_THROTTLE_MS = 50;
    const now = performance.now();
    const elapsed = now - this.lastPreviewRefresh;

    if (elapsed >= PREVIEW_THROTTLE_MS) {
      // Far enough since last redraw — run now.
      if (this.pendingPreviewTimer !== null) {
        clearTimeout(this.pendingPreviewTimer);
        this.pendingPreviewTimer = null;
      }
      this.lastPreviewRefresh = now;
      this.doRefreshPathPreview();
      return;
    }

    // Too soon — defer to the trailing edge of the throttle window. Replace
    // any earlier pending call so we always reflect the LATEST hover state.
    if (this.pendingPreviewTimer !== null) clearTimeout(this.pendingPreviewTimer);
    this.pendingPreviewTimer = window.setTimeout(() => {
      this.pendingPreviewTimer = null;
      this.lastPreviewRefresh = performance.now();
      this.doRefreshPathPreview();
    }, PREVIEW_THROTTLE_MS - elapsed);
  }

  /**
   * Recompute and redraw the path preview overlay based on the current hover
   * tile and buildPreviewActive flag. Cheap A* (≤ a few hundred nodes per spawn).
   */
  private doRefreshPathPreview(): void {
    if (!this.isFreeform()) {
      this.pathPreviewLayer.visible = false;
      this.previewVisible = false;
      return;
    }

    const g = this.pathPreviewLayer;
    g.clear();

    // Decide which mask to pathfind on:
    // - If build is active AND hover is on a tile where canBuildAt passes,
    //   show the hypothetical mask (with that tile blocked). This is the
    //   "what would happen if I place a tower here" preview.
    // - Otherwise, show the current paths from each spawn to the goal.
    let mask = this.currentFreeformMask();
    let hypothetical = false;
    if (this.buildPreviewActive && this.buildAffordable && this.lastHover) {
      const { col, row } = this.lastHover;
      // Only treat as hypothetical if this tile is buildable (passes path-still-exists check)
      // AND the player can actually pay for the tower right now.
      if (this.canBuildAt(col, row)) {
        if (mask[row]) mask[row][col] = false;
        hypothetical = true;
      }
    }

    // Draw a path from each spawn to the goal. Different colors per spawn so
    // overlapping segments are visually distinct.
    const colors = [0xf4d27a, 0x7adcf4, 0xf47ad8, 0xa8f47a]; // amber, cyan, magenta, lime
    let drewAny = false;
    for (let i = 0; i < this.pathEndpoints.length; i++) {
      const ep = this.pathEndpoints[i];
      const path = findPath(ep.start, ep.goal, mask);
      if (!path || path.length === 0) continue;
      const color = colors[i % colors.length];
      // Skip the spawn tile itself (gate already drawn there) and the goal
      // tile (village already drawn there). Highlight the in-between path.
      for (let k = 1; k < path.length - 1; k++) {
        const { col, row } = path[k];
        const { x, y } = gridToScreen(col, row);
        // Diamond corners in world coords (gridToScreen returns the TOP corner):
        //   top    = (x, y)
        //   right  = (x + TILE_W/2, y + TILE_H/2)
        //   bottom = (x, y + TILE_H)
        //   left   = (x - TILE_W/2, y + TILE_H/2)
        const alpha = hypothetical ? 0.40 : 0.22;
        g.moveTo(x, y)
         .lineTo(x + TILE_W / 2, y + TILE_H / 2)
         .lineTo(x, y + TILE_H)
         .lineTo(x - TILE_W / 2, y + TILE_H / 2)
         .closePath()
         .fill({ color, alpha });
      }
      drewAny = true;
    }

    g.visible = drewAny;
    this.previewVisible = drewAny;
  }

  private drawTiles(): void {
    for (let r = 0; r < this.mapDef.rows; r++) {
      for (let c = 0; c < this.mapDef.cols; c++) {
        const type = this.mapDef.tiles[r][c];
        const tile = new Graphics();
        const { x, y } = gridToScreen(c, r);

        // Per-tile deterministic pseudo-random in [0, 1). We hash (c, r) to a
        // single number, then derive a sequence by Math.sin-based scrambling.
        // This keeps each tile's appearance stable across loads/redraws.
        const seed = (c * 73856093) ^ (r * 19349663);
        const rng = makeRng(seed);

        // Draw a textured tile based on type. The diamond outline goes last so
        // it sits cleanly on top of all the decoration layers.
        if (type === 'grass') drawGrass(tile, rng);
        else if (type === 'forest') drawForest(tile, rng);
        else if (type === 'water') drawWater(tile, rng);
        else if (type === 'stone') drawStone(tile, rng);
        else drawGrass(tile, rng); // path or unknown — fall back to grass

        // Diamond outline overlay: faint dark edge for tile separation.
        tile
          .moveTo(0, 0)
          .lineTo(TILE_W / 2, TILE_H / 2)
          .lineTo(0, TILE_H)
          .lineTo(-TILE_W / 2, TILE_H / 2)
          .closePath()
          .stroke({ color: 0x000000, width: 0.5, alpha: 0.30 });

        tile.x = x;
        tile.y = y;
        tile.zIndex = isoDepth(c, r) - 1;
        this.tileLayer.addChild(tile);
      }
    }
  }

  /**
   * Render a visible "invasion gate" marker on each spawn tile. Helps the
   * player plan a maze around known landing zones (Tower Madness style).
   * Drawn for ALL maps, not just freeform — corridor maps also benefit
   * from a clear "enemies come from here" landmark.
   */
  private drawSpawnMarkers(): void {
    // Deduplicate: multiple paths may share a spawn tile; only draw once.
    const seen = new Set<string>();
    for (const waypoints of this.mapDef.paths) {
      const spawn = waypoints[0];
      const key = `${spawn.col},${spawn.row}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const marker = new Graphics();
      const { x, y } = gridToScreen(spawn.col, spawn.row);

      // Two stone pillars flanking the tile center, with a wooden lintel and
      // a red pennant flying from the right pillar. Drawn in tile-local coords
      // (origin is the top-left corner of the diamond).
      const cx = 0;
      const cy = TILE_H / 2; // tile center

      // Left pillar
      marker
        .rect(cx - 12, cy - 22, 5, 22)
        .fill(0x807060)
        .stroke({ color: 0x000000, width: 0.5 });
      // Right pillar
      marker
        .rect(cx + 7, cy - 22, 5, 22)
        .fill(0x807060)
        .stroke({ color: 0x000000, width: 0.5 });
      // Wooden lintel across the top
      marker
        .rect(cx - 14, cy - 26, 28, 5)
        .fill(0x6a4828)
        .stroke({ color: 0x000000, width: 0.5 });
      // Pennant pole rising from the right pillar
      marker
        .rect(cx + 9, cy - 38, 1.5, 16)
        .fill(0x3a2a18);
      // Red triangular flag
      marker
        .moveTo(cx + 10, cy - 38)
        .lineTo(cx + 19, cy - 35)
        .lineTo(cx + 10, cy - 32)
        .closePath()
        .fill(0xc02020)
        .stroke({ color: 0x000000, width: 0.5 });
      // Faint reddish ground tint inside the gate footprint
      marker
        .moveTo(0, 0)
        .lineTo(TILE_W / 2, TILE_H / 2)
        .lineTo(0, TILE_H)
        .lineTo(-TILE_W / 2, TILE_H / 2)
        .closePath()
        .fill({ color: 0xc02020, alpha: 0.12 });

      marker.x = x;
      marker.y = y;
      // Sit just above the tile but below towers/enemies. Tile is depth-1, towers
      // are at depth 0+, so use depth -0.5 to get above tiles but below units.
      marker.zIndex = isoDepth(spawn.col, spawn.row) - 0.5;
      this.tileLayer.addChild(marker);
    }
  }

  private attachInput(): void {
    this.container.eventMode = 'static';
    this.container.on('pointermove', (e) => {
      const local = this.container.toLocal(e.global);
      const tile = this.pickTile(local.x, local.y);
      if (tile) {
        this.showHover(tile.col, tile.row, tile.buildable);
        if (this.onTileHover) this.onTileHover(tile.col, tile.row);
        // Update preview only when the hovered tile actually changed (col,row).
        // pointermove fires per pixel; A* per pixel would be wasteful.
        if (this.isFreeform()) {
          if (!this.lastHover || this.lastHover.col !== tile.col || this.lastHover.row !== tile.row) {
            this.lastHover = { col: tile.col, row: tile.row };
            this.refreshPathPreview();
          }
        }
      } else {
        this.hoverIndicator.visible = false;
      }
    });
    this.container.on('pointerdown', (e) => {
      const local = this.container.toLocal(e.global);
      const tile = this.pickTile(local.x, local.y);
      if (tile && this.onTileClick) this.onTileClick(tile);
    });
    this.container.on('pointerleave', () => {
      this.hoverIndicator.visible = false;
      // Clear hypothetical preview when the cursor leaves the grid; show
      // current paths only on freeform.
      this.lastHover = null;
      if (this.isFreeform()) this.refreshPathPreview();
    });
  }

  /** Find which tile is under a given point in grid local space. */
  private pickTile(x: number, y: number): TileClick | null {
    // gridToScreen returns the TOP corner of the tile diamond. The diamond
    // extends from y to y+TILE_H. Its center is at y+TILE_H/2.
    // To find which tile contains point (x,y), shift our reference up by
    // TILE_H/2 so we're effectively measuring from tile centers, then
    // round to the nearest integer grid coordinate.
    const fractional = screenToGrid(x, y - TILE_H / 2);
    const col = Math.round(fractional.col);
    const row = Math.round(fractional.row);
    if (col < 0 || col >= this.mapDef.cols || row < 0 || row >= this.mapDef.rows) return null;
    const type = this.mapDef.tiles[row][col];
    const buildable = this.canBuildAt(col, row);
    return { col, row, type, buildable };
  }

  private showHover(col: number, row: number, buildable: boolean): void {
    const { x, y } = gridToScreen(col, row);
    // If a tower is selected for build but the player can't afford it, the
    // tile should look "blocked" even if it's structurally buildable.
    const placeable = buildable && (!this.buildPreviewActive || this.buildAffordable);
    this.hoverIndicator.clear();
    this.hoverIndicator
      .moveTo(0, 0)
      .lineTo(TILE_W / 2, TILE_H / 2)
      .lineTo(0, TILE_H)
      .lineTo(-TILE_W / 2, TILE_H / 2)
      .closePath()
      .stroke({ color: placeable ? 0xf4d27a : 0xdd4444, width: 2 })
      .fill({ color: placeable ? 0xf4d27a : 0xdd4444, alpha: 0.25 });
    this.hoverIndicator.x = x;
    this.hoverIndicator.y = y;
    this.hoverIndicator.zIndex = 9999;
    this.hoverIndicator.visible = true;
  }

  hasTower(col: number, row: number): boolean {
    return this.towerMap.has(`${col},${row}`);
  }

  /** Returns the tower at this tile, if any. */
  getTowerAt(col: number, row: number): Tower | null {
    return this.towerMap.get(`${col},${row}`) ?? null;
  }

  addTower(tower: Tower): void {
    this.towerMap.set(`${tower.col},${tower.row}`, tower);
    this.container.addChild(tower.container);
  }

  removeTower(tower: Tower): void {
    this.towerMap.delete(`${tower.col},${tower.row}`);
    tower.destroy();
  }

  getTowers(): Tower[] {
    return Array.from(this.towerMap.values());
  }

  setOnTileClick(cb: (tile: TileClick) => void): void {
    this.onTileClick = cb;
  }

  setOnTileHover(cb: (col: number, row: number) => void): void {
    this.onTileHover = cb;
  }
}

function clampColor(c: number): number {
  const r = Math.max(0, Math.min(255, (c >> 16) & 0xff));
  const g = Math.max(0, Math.min(255, (c >> 8) & 0xff));
  const b = Math.max(0, Math.min(255, c & 0xff));
  return (r << 16) | (g << 8) | b;
}

// ─── Tile rendering helpers ─────────────────────────────────────────────────
// Each tile-draw helper paints inside a diamond bounded by these corners
// relative to the tile's local origin (0, 0):
//   top:    (0, 0)
//   right:  (TILE_W/2, TILE_H/2)
//   bottom: (0, TILE_H)
//   left:   (-TILE_W/2, TILE_H/2)
// We stay roughly inside that diamond when scattering decorations so we don't
// bleed onto neighbors. (We could clip with a mask, but it's expensive and the
// tile-edge overlay hides minor overruns.)

/**
 * Mulberry32-style deterministic RNG. Same seed always yields the same
 * sequence — that's what gives each tile a stable, repeatable look.
 */
type Rng = () => number;
function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random in [min, max). */
function rngRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/**
 * Returns true if a point is inside the tile diamond — used to decide whether
 * a scatter decoration is in-bounds before drawing it. The diamond is centered
 * at (0, TILE_H/2) with half-width TILE_W/2 and half-height TILE_H/2.
 */
function inDiamond(px: number, py: number, margin = 0): boolean {
  const dx = Math.abs(px) / (TILE_W / 2);
  const dy = Math.abs(py - TILE_H / 2) / (TILE_H / 2);
  const m = margin / (TILE_W / 2);
  return dx + dy <= 1 - m;
}

/** Grass: layered greens + tufts + dirt patches + occasional flower. */
function drawGrass(g: Graphics, rng: Rng): void {
  // Base diamond — slightly varied green per tile.
  const baseShade = Math.floor(rngRange(rng, -8, 8));
  const base = clampColor(0x6a8c3a + baseShade * 0x010101);
  diamond(g).fill(base);

  // Mid-tone uneven patches: 2-3 darker blotches give the tile depth.
  const blotches = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < blotches; i++) {
    const px = rngRange(rng, -TILE_W / 2 + 6, TILE_W / 2 - 6);
    const py = rngRange(rng, 6, TILE_H - 6);
    if (!inDiamond(px, py, 4)) continue;
    const rx = rngRange(rng, 5, 9);
    const ry = rngRange(rng, 2, 4);
    const dark = clampColor(0x4a6c20 + Math.floor(rngRange(rng, -6, 6)) * 0x010101);
    g.ellipse(px, py, rx, ry).fill({ color: dark, alpha: 0.45 });
  }

  // Occasional dirt patch (1 in 6 tiles). Light brown ellipse.
  if (rng() < 0.16) {
    const px = rngRange(rng, -TILE_W / 4, TILE_W / 4);
    const py = rngRange(rng, TILE_H / 3, (TILE_H * 2) / 3);
    if (inDiamond(px, py, 4)) {
      g.ellipse(px, py, rngRange(rng, 4, 7), rngRange(rng, 1.5, 2.5))
        .fill({ color: 0x8a6838, alpha: 0.55 });
    }
  }

  // Tiny grass tufts: tiny vertical strokes of slightly lighter green.
  const tufts = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < tufts; i++) {
    const px = rngRange(rng, -TILE_W / 2 + 4, TILE_W / 2 - 4);
    const py = rngRange(rng, 4, TILE_H - 4);
    if (!inDiamond(px, py, 3)) continue;
    const tuftColor = clampColor(0x88a850 + Math.floor(rngRange(rng, -10, 10)) * 0x010101);
    // Two vertical 2px lines side-by-side
    g.rect(px, py, 1, 2).fill(tuftColor);
    g.rect(px + 1.4, py - 0.5, 1, 2).fill(tuftColor);
  }

  // Rare yellow flower (1 in 12 tiles). One tiny dot.
  if (rng() < 0.08) {
    const px = rngRange(rng, -TILE_W / 3, TILE_W / 3);
    const py = rngRange(rng, 8, TILE_H - 8);
    if (inDiamond(px, py, 4)) {
      g.circle(px, py, 1.2).fill(0xf4d050);
    }
  }
}

/**
 * Stone outcrop: rocky, angular shapes — a "boulder" composed of a few faceted
 * polygons in shades of gray. These are gameplay landmarks (unbuildable
 * obstacles) so they should read as solid.
 */
function drawStone(g: Graphics, rng: Rng): void {
  // Base diamond is a darker grass tone (the ground around the rocks).
  const baseShade = Math.floor(rngRange(rng, -6, 6));
  const ground = clampColor(0x5a7a32 + baseShade * 0x010101);
  diamond(g).fill(ground);

  // Faint dirt collar around the base of the boulder.
  g.ellipse(0, TILE_H / 2 + 2, TILE_W / 2 - 8, 5)
    .fill({ color: 0x6a5028, alpha: 0.40 });

  // Main boulder: irregular polygon, two-tone (lit side and shadow side).
  const cx = rngRange(rng, -3, 3);
  const cy = rngRange(rng, TILE_H / 2 - 2, TILE_H / 2 + 2);
  const w = 18; // half-width
  const h = 9;  // half-height
  // Build an irregular polygon by perturbing 6 cardinal-ish points.
  const pts: [number, number][] = [];
  const nVerts = 6;
  for (let i = 0; i < nVerts; i++) {
    const a = (Math.PI * 2 * i) / nVerts - Math.PI / 2; // start at top
    const jitter = rngRange(rng, 0.75, 1.05);
    pts.push([cx + Math.cos(a) * w * jitter, cy + Math.sin(a) * h * jitter]);
  }
  // Lit (top) side: lighter gray
  g.poly(pts.flat()).fill(0x8a8a8a).stroke({ color: 0x2a2a2a, width: 1 });
  // Shadow (bottom) wedge: re-fill the lower half darker.
  const shadowPts: [number, number][] = [];
  for (const [px, py] of pts) {
    if (py >= cy) shadowPts.push([px, py]);
  }
  // Add the left-most and right-most points to close the wedge cleanly.
  if (shadowPts.length >= 2) {
    shadowPts.unshift([cx - w * 0.9, cy]);
    shadowPts.push([cx + w * 0.9, cy]);
    g.poly(shadowPts.flat()).fill({ color: 0x5a5a5a, alpha: 0.85 });
  }

  // 2-3 small pebbles around the boulder.
  const pebbles = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < pebbles; i++) {
    const px = rngRange(rng, -TILE_W / 2 + 6, TILE_W / 2 - 6);
    const py = rngRange(rng, TILE_H / 2 + 2, TILE_H - 4);
    if (!inDiamond(px, py, 5)) continue;
    // Skip if it overlaps the main boulder.
    if (Math.abs(px - cx) < w * 0.8 && Math.abs(py - cy) < h * 0.8) continue;
    const sz = rngRange(rng, 1.2, 2.2);
    g.circle(px, py, sz).fill(0x707070).stroke({ color: 0x2a2a2a, width: 0.5 });
  }

  // A bright highlight dot on the boulder's lit side.
  g.circle(cx - w * 0.35, cy - h * 0.55, 1.4).fill({ color: 0xc0c0c0, alpha: 0.85 });
}

/** Forest: a dense pine-tree clump filling the tile. Three trees layered. */
function drawForest(g: Graphics, rng: Rng): void {
  // Darker grass under the trees.
  const baseShade = Math.floor(rngRange(rng, -6, 6));
  const ground = clampColor(0x4a6a28 + baseShade * 0x010101);
  diamond(g).fill(ground);

  // Three pine trees, slightly offset — back tree first (smallest), front
  // trees later (bigger), so they layer naturally.
  const trees: [number, number, number][] = [
    [rngRange(rng, -10, -2), rngRange(rng, 4, 8),  9], // back-left
    [rngRange(rng, 0, 8),    rngRange(rng, 2, 6),  10],// back-right
    [rngRange(rng, -4, 4),   rngRange(rng, 10, 14),12] // front-center
  ];
  // Sort back-to-front by y ascending.
  trees.sort((a, b) => a[1] - b[1]);
  for (const [px, py, size] of trees) {
    drawPine(g, px, py, size, rng);
  }
}

/** Helper: a single pine tree as a layered triangle stack with a trunk. */
function drawPine(g: Graphics, x: number, y: number, size: number, rng: Rng): void {
  // Trunk
  g.rect(x - 1, y, 2, size * 0.4).fill(0x4a2810);
  // Three stacked triangle layers, darkest at base, lighter on top.
  const greens = [0x2a4818, 0x355a20, 0x406828];
  for (let i = 0; i < 3; i++) {
    const layerY = y - size * (0.3 + i * 0.35);
    const w = size * (1 - i * 0.18);
    const h = size * 0.55;
    g.poly([x - w / 2, layerY + h, x, layerY, x + w / 2, layerY + h]).fill(greens[i]);
  }
  // Tiny highlight on the topmost triangle for definition.
  const topY = y - size * 1.0;
  g.circle(x, topY + size * 0.1, 1).fill({ color: 0x90c060, alpha: 0.5 });
  // Suppress unused-param warning if rng goes unreferenced after future edits.
  void rng;
}

/** Water: blue gradient + a couple of horizontal wave streaks. */
function drawWater(g: Graphics, rng: Rng): void {
  // Two-tone fill via two stacked diamonds — darker base, lighter overlay.
  const base = clampColor(0x2a5878 + Math.floor(rngRange(rng, -4, 4)) * 0x010101);
  diamond(g).fill(base);
  // Lighter overlay on the upper half of the diamond.
  g.poly([0, 1, TILE_W / 2 - 1, TILE_H / 2, 0, TILE_H / 2 + 1, -TILE_W / 2 + 1, TILE_H / 2])
    .fill({ color: 0x4a88a8, alpha: 0.55 });

  // Two or three subtle wave streaks at varying y offsets.
  const streaks = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < streaks; i++) {
    const yy = rngRange(rng, 8, TILE_H - 8);
    const xStart = rngRange(rng, -10, -4);
    const xEnd = rngRange(rng, 4, 10);
    g.moveTo(xStart, yy)
      .lineTo(xStart + 4, yy - 1)
      .lineTo(xEnd - 4, yy)
      .lineTo(xEnd, yy - 1)
      .stroke({ color: 0x9ad0e8, width: 1, alpha: 0.55 });
  }

  // A glint highlight on one wave for brightness.
  if (rng() < 0.5) {
    const gx = rngRange(rng, -8, 8);
    const gy = rngRange(rng, 10, TILE_H - 10);
    g.ellipse(gx, gy, 2.5, 0.7).fill({ color: 0xffffff, alpha: 0.55 });
  }
}

/** Convenience: build the diamond outline path on a Graphics. Caller fills. */
function diamond(g: Graphics): Graphics {
  return g
    .moveTo(0, 0)
    .lineTo(TILE_W / 2, TILE_H / 2)
    .lineTo(0, TILE_H)
    .lineTo(-TILE_W / 2, TILE_H / 2)
    .closePath();
}
