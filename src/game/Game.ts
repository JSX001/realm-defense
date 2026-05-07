import { Application, Container } from 'pixi.js';
import { MAPS } from '../data/maps';
import { TOWERS, totalSpent, SELL_REFUND } from '../data/towers';
import { Grid } from './Grid';
import { WaveManager } from './WaveManager';
import { Enemy } from '../entities/Enemy';
import { Tower } from '../entities/Tower';
import { Projectile } from '../entities/Projectile';
import { Village } from '../entities/Village';
import { gameStore } from '../state/store';
import {
  Resources,
  add,
  subtract,
  canAfford,
  clampFloor,
  scaleCost,
  clone
} from '../data/resources';
import {
  sfxTowerPlace, sfxTowerSell, sfxWaveStart, sfxWaveComplete,
  sfxVictory, sfxDefeat, sfxVillagerDeath, sfxPickaxeHit, sfxWallCrumble
} from '../utils/sound';
import { Effect, ResourceTicker, DeathPuff } from '../utils/effects';
import { gridToScreen } from '../utils/isometric';
import { loadDifficulty, DIFFICULTY_TUNING } from '../utils/persistence';

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.12;

export class Game {
  private app: Application;
  private world: Container;
  private grid: Grid | null = null;
  private waveManager: WaveManager | null = null;

  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private enemyLayer: Container | null = null;
  private projectileLayer: Container | null = null;
  private effectsLayer: Container | null = null;
  private village: Village | null = null;

  /** Transient visual effects (resource ticker, death puff). Cleared per map. */
  private transientEffects: Effect[] = [];
  private transientLayer: Container | null = null;

  /** Track per-tower total spent (Resources) for accurate sell refunds. */
  private totalSpentByTower = new WeakMap<Tower, Resources>();

  constructor(app: Application) {
    this.app = app;

    this.world = new Container();
    this.world.sortableChildren = true;
    this.app.stage.addChild(this.world);

    this.app.ticker.add(() => this.update(this.app.ticker.deltaMS / 1000));

    window.addEventListener('resize', () => {
      if (this.grid) this.centerWorld();
    });

    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

    // When the player selects/deselects a tower to build OR their resources change,
    // tell Grid so it can toggle hypothetical-path preview and color the hover
    // tile based on whether the player can actually afford to place. Subscribe
    // here once; the Grid is rebuilt on each loadMap, so we read the latest
    // grid each callback.
    let lastBuildId: string | null = null;
    let lastAffordable = true;
    gameStore.subscribe((s) => {
      const buildId = s.selectedBuildId;
      let affordable = true;
      if (buildId) {
        const def = TOWERS[buildId];
        if (def) affordable = canAfford(s.resources, def.levels[0].cost);
      }
      if (buildId !== lastBuildId || affordable !== lastAffordable) {
        lastBuildId = buildId;
        lastAffordable = affordable;
        if (this.grid) this.grid.setBuildPreviewActive(buildId !== null, affordable);
      }
    });
  }

  /**
   * Abandon the current map and return to map-select. Tears down all map
   * state, clears selections, and sets phase = 'menu' so the HUD shows the
   * map-select overlay. Does NOT modify persisted progress.
   */
  quitToMenu(): void {
    this.teardown();
    const state = gameStore.getState();
    state.selectBuild(null);
    state.selectTower(null);
    state.setMap(null);
    state.setVillageStats(null);
    // Always resume to clean state so paused/sped-up runs don't carry over.
    state.setPaused(false);
    state.setSpeed(1);
    state.setPhase('menu');
  }

  loadMap(mapId: string): void {
    const mapDef = MAPS[mapId];
    if (!mapDef) return;

    this.teardown();

    this.grid = new Grid(mapDef);
    this.world.addChild(this.grid.container);

    this.enemyLayer = new Container();
    this.enemyLayer.sortableChildren = true;
    this.enemyLayer.zIndex = 100000;
    this.grid.container.addChild(this.enemyLayer);

    this.projectileLayer = new Container();
    this.projectileLayer.sortableChildren = true;
    this.projectileLayer.zIndex = 200000;
    this.grid.container.addChild(this.projectileLayer);

    this.effectsLayer = new Container();
    this.effectsLayer.sortableChildren = true;
    this.effectsLayer.zIndex = 300000;
    this.grid.container.addChild(this.effectsLayer);

    // Transient effects (resource ticker text, death puffs) — drawn above all
    // gameplay layers so they're never occluded by towers or units.
    this.transientLayer = new Container();
    this.transientLayer.sortableChildren = true;
    this.transientLayer.zIndex = 400000;
    this.grid.container.addChild(this.transientLayer);
    this.transientEffects = [];

    // Spawn the Village at the first path's goal. (All paths share the goal
    // on every map; we use path[0] as the canonical goal location.)
    const goalWaypoint = mapDef.paths[0][mapDef.paths[0].length - 1];
    this.village = new Village(mapDef.village, goalWaypoint.col, goalWaypoint.row);
    // Add to grid container so it sorts naturally with tiles/towers.
    this.grid.container.addChild(this.village.container);

    // Read the player's difficulty setting (persisted to localStorage). Standard
    // is the reference experience; Easy/Hard scale enemy HP and starting
    // resources to widen the audience.
    const difficulty = loadDifficulty();
    const tuning = DIFFICULTY_TUNING[difficulty];

    // WaveManager asks the grid for fresh paths via callback. This keeps the
    // wave system decoupled from grid internals and lets us swap in
    // tower-aware pathfinding later without changing WaveManager.
    const grid = this.grid;
    this.waveManager = new WaveManager(
      mapDef.waves,
      (pathIndex, enemyId) => grid.findPathForRoute(pathIndex, enemyId === 'sapper'),
      tuning.hpMult
    );
    this.enemies = [];
    this.projectiles = [];

    this.world.scale.set(1);
    this.centerWorld();

    // Scale starting resources by the difficulty's resourceMult.
    const scaledStart: Resources = {
      wood:  Math.round(mapDef.startResources.wood  * tuning.resourceMult),
      gold:  Math.round(mapDef.startResources.gold  * tuning.resourceMult),
      stone: Math.round(mapDef.startResources.stone * tuning.resourceMult),
      food:  Math.round(mapDef.startResources.food  * tuning.resourceMult)
    };
    gameStore.getState().reset(scaledStart, mapDef.waves.length);
    gameStore.getState().setMap(mapId);
    gameStore.getState().setSpeed(1);
    this.pushVillageStats();

    this.grid.setOnTileClick((tile) => this.handleTileClick(tile));
  }

  /** Push current village stats to the store so HUD can render them. */
  private pushVillageStats(): void {
    if (!this.village) {
      gameStore.getState().setVillageStats(null);
      return;
    }
    const alive = this.village.aliveCount();
    const total = this.village.totalCount();
    const cur = gameStore.getState().villageStats;
    if (!cur || cur.alive !== alive || cur.total !== total) {
      gameStore.getState().setVillageStats({ alive, total });
    }
  }

  private teardown(): void {
    if (this.grid) {
      this.grid.container.destroy({ children: true });
      this.grid = null;
    }
    this.enemyLayer = null;
    this.projectileLayer = null;
    this.effectsLayer = null;
    this.transientLayer = null;
    this.transientEffects = [];
    this.village = null;
    this.enemies = [];
    this.projectiles = [];
    this.waveManager = null;
  }

  private centerWorld(): void {
    if (!this.grid) return;
    const cols = this.grid.mapDef.cols;
    const rows = this.grid.mapDef.rows;
    const minX = -(rows - 1) * 32 - 32;
    const maxX = (cols - 1) * 32 + 32;
    const minY = 0;
    const maxY = (cols + rows - 2) * 16 + 32;
    const mapW = (maxX - minX) * this.world.scale.x;
    const mapH = (maxY - minY) * this.world.scale.y;
    this.world.x = (this.app.screen.width - mapW) / 2 - minX * this.world.scale.x;
    this.world.y = (this.app.screen.height - mapH) / 2 - minY * this.world.scale.y + 30;
  }

  private handleWheel(e: WheelEvent): void {
    if (!this.grid) return;
    e.preventDefault();
    const rect = (this.app.canvas as HTMLCanvasElement).getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const oldScale = this.world.scale.x;
    const worldX = (cursorX - this.world.x) / oldScale;
    const worldY = (cursorY - this.world.y) / oldScale;
    const direction = e.deltaY < 0 ? 1 : -1;
    const factor = 1 + direction * ZOOM_STEP;
    let newScale = oldScale * factor;
    newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));
    if (newScale === oldScale) return;
    this.world.scale.set(newScale);
    this.world.x = cursorX - worldX * newScale;
    this.world.y = cursorY - worldY * newScale;
  }

  private handleTileClick(tile: { col: number; row: number; buildable: boolean }): void {
    if (!this.grid) return;
    const state = gameStore.getState();
    if (state.phase === 'won' || state.phase === 'lost' || state.phase === 'menu') return;

    const existing = this.grid.getTowerAt(tile.col, tile.row);
    if (existing) {
      for (const t of this.grid.getTowers()) t.showRange(false);
      existing.showRange(true);
      state.selectTower({ col: existing.col, row: existing.row });
      return;
    }

    if (state.selectedBuildId && tile.buildable) {
      const towerDef = TOWERS[state.selectedBuildId];
      if (!towerDef) return;
      const cost = towerDef.levels[0].cost;
      if (!canAfford(state.resources, cost)) return;
      const tower = new Tower(towerDef, tile.col, tile.row);
      this.grid.addTower(tower);
      sfxTowerPlace();
      state.recordTowerBuilt();
      // Track resources spent on this tower (start with build cost as full Resources).
      this.totalSpentByTower.set(tower, {
        wood: cost.wood ?? 0,
        gold: cost.gold ?? 0,
        stone: cost.stone ?? 0,
        food: cost.food ?? 0
      });
      state.setResources(subtract(state.resources, cost));
      // On freeform maps, the new tower may have just rerouted enemies.
      this.replanEnemyPaths();
      return;
    }

    if (state.selectedTower) {
      for (const t of this.grid.getTowers()) t.showRange(false);
      state.selectTower(null);
    }
  }

  upgradeSelectedTower(): void {
    if (!this.grid) return;
    const state = gameStore.getState();
    if (!state.selectedTower) return;
    const tower = this.grid.getTowerAt(state.selectedTower.col, state.selectedTower.row);
    if (!tower || !tower.canUpgrade()) return;
    if (tower.isUpgrading()) return; // already in progress
    const cost = tower.nextUpgradeCost();
    if (!cost || !canAfford(state.resources, cost)) return;
    state.setResources(subtract(state.resources, cost));
    tower.startUpgrade();
    // Track the upgrade cost in totalSpent. If the player sells DURING the
    // upgrade, this includes the in-progress cost — meaning the player loses
    // the (1 - SELL_REFUND) portion of it. Acceptable; selling mid-upgrade
    // is a panic move and shouldn't be free.
    const prev = this.totalSpentByTower.get(tower) ?? { wood: 0, gold: 0, stone: 0, food: 0 };
    this.totalSpentByTower.set(tower, add(prev, cost));
    state.selectTower({ col: tower.col, row: tower.row });
  }

  sellSelectedTower(): void {
    if (!this.grid) return;
    const state = gameStore.getState();
    if (!state.selectedTower) return;
    const tower = this.grid.getTowerAt(state.selectedTower.col, state.selectedTower.row);
    if (!tower) return;
    const spent = this.totalSpentByTower.get(tower) ?? totalSpent(tower.def, tower.level);
    const refund = scaleCost(spent, SELL_REFUND);
    state.setResources(add(state.resources, refund));
    state.recordEarned(refund); // sell refunds count toward "earned"
    this.grid.removeTower(tower);
    this.totalSpentByTower.delete(tower);
    state.selectTower(null);
    sfxTowerSell();
    // On freeform maps, removing a tower may open new shortcuts — replan paths
    // for all live enemies.
    this.replanEnemyPaths();
  }

  /** Remove a wall destroyed by a sapper. No refund — it was destroyed, not sold. */
  private removeWall(tower: Tower): void {
    if (!this.grid) return;
    this.grid.removeTower(tower);
    this.totalSpentByTower.delete(tower);
    sfxWallCrumble();
    // If the destroyed wall was selected, clear selection.
    const sel = gameStore.getState().selectedTower;
    if (sel && sel.col === tower.col && sel.row === tower.row) {
      gameStore.getState().selectTower(null);
    }
  }

  /**
   * For freeform maps: re-run A* for every live enemy from its current tile to
   * the goal. Called after any tower is added or removed. No-op for corridor
   * maps because their path masks don't change.
   */
  private replanEnemyPaths(): void {
    if (!this.grid) return;
    if (!this.grid.mapDef.freeform) return;
    const goal = this.grid.getGoalTile();
    if (!goal) return;
    for (const e of this.enemies) {
      if (!e.alive || e.reachedGoal) continue;
      const isSapper = e.def.id === 'sapper';
      const newPath = this.grid.findPathFromTile(
        { col: Math.round(e.col), row: Math.round(e.row) },
        goal,
        isSapper
      );
      if (newPath && newPath.length > 0) {
        e.setPath(newPath);
      }
    }
    // Tower changed — redraw the path preview so the overlay reflects the new
    // route. (If the player is still hovering with a build selected, the next
    // hover-tile change will re-evaluate hypothetically; this catches the
    // current-paths case for when build is not selected.)
    this.grid.refreshPathPreview();
  }

  /**
   * Recompute every enemy's Faith damage multiplier from active monasteries.
   * Called once per frame BEFORE towers fire so shots resolve against current
   * multipliers. Cost: O(monasteries × enemies). With ~10 enemies and ~3
   * monasteries that's negligible; cap is well into the hundreds.
   *
   * Multiple monasteries covering one enemy multiply together — placing two
   * monasteries side-by-side in a kill zone is a real strategic flex, not an
   * exploit, since it costs significant gold.
   */
  private tickFaithAuras(): void {
    if (!this.grid) return;
    // Gather monasteries up front. Skip those mid-upgrade? No — the player
    // has paid the upgrade cost and the tower is functional at its current
    // level during construction; same rule as projectile towers.
    const monasteries: { col: number; row: number; range: number; mult: number }[] = [];
    for (const t of this.grid.getTowers()) {
      if (t.def.id !== 'monastery') continue;
      const s = t.stats();
      if (s.faithMultiplier === undefined) continue;
      monasteries.push({ col: t.col, row: t.row, range: s.range, mult: s.faithMultiplier });
    }
    // Walk enemies once. If no monasteries exist, fast-path everyone to 1.
    if (monasteries.length === 0) {
      for (const e of this.enemies) e.damageMultiplier = 1;
      return;
    }
    for (const e of this.enemies) {
      if (!e.alive) continue;
      let m = 1;
      for (const mn of monasteries) {
        const d = e.distanceTo(mn.col, mn.row);
        if (d <= mn.range) m *= mn.mult;
      }
      e.damageMultiplier = m;
    }
  }

  getSelectedTower(): Tower | null {
    if (!this.grid) return null;
    const state = gameStore.getState();
    if (!state.selectedTower) return null;
    return this.grid.getTowerAt(state.selectedTower.col, state.selectedTower.row);
  }

  /** For HUD wave-preview display. Returns null if there's no next wave. */
  getNextWaveSpawns() {
    return this.waveManager ? this.waveManager.getNextWaveSpawns() : null;
  }

  startWave(): void {
    if (!this.waveManager) return;
    const state = gameStore.getState();
    if (state.phase !== 'building') return;
    if (this.waveManager.startNextWave()) {
      state.setPhase('wave');
      state.setWave(this.waveManager.getCurrentWave(), this.waveManager.getTotalWaves());
      sfxWaveStart();
    }
  }

  cycleSpeed(): void {
    const cur = gameStore.getState().speed;
    const next = cur === 1 ? 2 : cur === 2 ? 4 : 1;
    gameStore.getState().setSpeed(next);
  }

  togglePause(): void {
    gameStore.getState().togglePaused();
  }

  private update(realDt: number): void {
    const state = gameStore.getState();
    if (state.phase === 'won' || state.phase === 'lost' || state.phase === 'menu') return;
    if (!this.grid || !this.waveManager || !this.enemyLayer || !this.projectileLayer || !this.effectsLayer) return;
    if (state.paused) return;

    const dt = Math.min(realDt * state.speed, 0.25);

    if (state.phase === 'wave') {
      const newEnemies = this.waveManager.update(dt);
      for (const e of newEnemies) {
        this.enemies.push(e);
        this.enemyLayer.addChild(e.container);
      }
    }

    // Sapper logic: for each living sapper, check if its next tile is a wall.
    // If yes, pause and chew. If wall is destroyed this frame, replan paths.
    let anyWallDied = false;
    for (const e of this.enemies) {
      if (!e.alive || e.def.id !== 'sapper') continue;
      const nextTile = e.getNextTile();
      if (!nextTile) { e.paused = false; continue; }
      const wallTower = this.grid.getTowerAt(nextTile.col, nextTile.row);
      if (wallTower && wallTower.isWall()) {
        e.paused = true;
        // Sapper DPS: 6 against any wall. Palisade ~7s, stone wall ~33s.
        const destroyed = wallTower.takeDamage(6 * dt);
        sfxPickaxeHit(); // throttled internally to ~4/sec regardless of how many sappers
        if (destroyed) {
          this.removeWall(wallTower);
          anyWallDied = true;
        }
      } else {
        e.paused = false;
      }
    }
    if (anyWallDied) this.replanEnemyPaths();

    for (const e of this.enemies) e.update(dt);

    // Update Faith damage multipliers from monastery auras BEFORE towers fire,
    // so any shots resolve against current-frame multipliers (not stale ones).
    this.tickFaithAuras();

    const projectilesBefore = this.projectiles.length;
    for (const t of this.grid.getTowers()) {
      t.update(dt, this.enemies, this.projectiles, this.projectileLayer, this.effectsLayer);
    }
    for (let i = projectilesBefore; i < this.projectiles.length; i++) {
      this.projectiles[i].setEnemiesRef(this.enemies);
    }

    for (const p of this.projectiles) p.update(dt);

    // Tick transient effects (resource ticker text, death puffs). Filter out
    // any that returned false — they're done and need their container removed.
    if (this.transientEffects.length > 0) {
      this.transientEffects = this.transientEffects.filter((eff) => {
        const alive = eff.update(dt);
        if (!alive) eff.destroy();
        return alive;
      });
    }

    // Village income tick — passive resource generation while villagers are alive.
    let resources: Resources = clone(state.resources);
    let earnedDelta: Resources = { wood: 0, gold: 0, stone: 0, food: 0 };
    if (this.village) {
      const earned = this.village.tick(dt);
      resources = add(resources, earned);
      earnedDelta = add(earnedDelta, earned);
    }

    // Process consequences (kills give resources; breaches kill villagers).
    let villagerDied = false;
    for (const e of this.enemies) {
      if (e.reachedGoal && !e.rewarded) {
        // A villager dies. The resource cost is the lost income going forward.
        if (this.village && this.village.killOne()) {
          villagerDied = true;
          sfxVillagerDeath();
        }
        e.rewarded = true;
      } else if (!e.alive && !e.reachedGoal && !e.rewarded) {
        // Killed by a tower: drop carried resource and spawn visual feedback.
        resources = add(resources, e.def.reward);
        earnedDelta = add(earnedDelta, e.def.reward);
        e.rewarded = true;
        state.recordEnemyKill(e.def.id);
        // Death effects: floating "+N resource" text and a small puff at the
        // enemy's screen position. Skipped if no transient layer (defensive).
        if (this.transientLayer) {
          const screen = gridToScreen(e.col, e.row);
          // Anchor effects above the unit's feet (tile-center).
          const fx = screen.x;
          const fy = screen.y + 8;
          // Particle puff color tinted by enemy color for variety.
          const puff = new DeathPuff(fx, fy, e.def.color);
          this.transientLayer.addChild(puff.container);
          this.transientEffects.push(puff);
          // Resource ticker only if there's actually a reward.
          if (e.def.reward.wood || e.def.reward.gold || e.def.reward.stone || e.def.reward.food) {
            const ticker = new ResourceTicker(fx, fy - 4, e.def.reward);
            this.transientLayer.addChild(ticker.container);
            this.transientEffects.push(ticker);
          }
        }
      }
    }
    resources = clampFloor(resources);
    state.setResources(resources);
    if (villagerDied) this.pushVillageStats();
    if (earnedDelta.wood + earnedDelta.gold + earnedDelta.stone + earnedDelta.food > 0) {
      state.recordEarned(earnedDelta);
    }

    // Lose check: no villagers left.
    if (this.village && this.village.aliveCount() === 0) {
      // Only play defeat sound on the transition (not every frame thereafter).
      if (gameStore.getState().phase !== 'lost') {
        sfxDefeat();
        gameStore.getState().finalizeMapTimer();
      }
      gameStore.getState().setPhase('lost');
    }

    this.enemies = this.enemies.filter((e) => {
      if (!e.alive) { e.destroy(); return false; }
      return true;
    });
    this.projectiles = this.projectiles.filter((p) => {
      if (!p.alive) { p.destroy(); return false; }
      return true;
    });

    // Re-read phase from live store: lose may have triggered above.
    const livePhase = gameStore.getState().phase;
    if (livePhase === 'wave' && this.waveManager.isWaveSpawnComplete() && this.enemies.length === 0) {
      this.waveManager.endWave();
      if (this.waveManager.isLastWave()) {
        gameStore.getState().setPhase('won');
        if (state.currentMapId) gameStore.getState().markCompleted(state.currentMapId);
        gameStore.getState().finalizeMapTimer();
        sfxVictory();
      } else {
        gameStore.getState().setPhase('building');
        sfxWaveComplete();
        // Between-wave bonus: scales with wave number so mid/late game gets
        // meaningful build-up cash. Multiplier = 1 + 0.4 * waveIdx, where
        // waveIdx is 0-based (so the bonus after wave 1 is 1.0x base, after
        // wave 5 is ~2.6x, after wave 10 is 5.0x). Without this scaling,
        // the fixed 10/8/6/10 bonus barely covers an L1 upgrade.
        const waveIdx = this.waveManager.getCurrentWave(); // 0-based, just-completed
        const mult = 1 + 0.4 * waveIdx;
        const bonus: Partial<Resources> = {
          wood:  Math.round(15 * mult),
          gold:  Math.round(12 * mult),
          stone: Math.round(9  * mult),
          food:  Math.round(15 * mult)
        };
        const cur = gameStore.getState().resources;
        gameStore.getState().setResources(add(cur, bonus));
        gameStore.getState().recordEarned(bonus);
      }
    }
  }
}
