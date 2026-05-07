import { Container, Graphics } from 'pixi.js';
import { VillageDef } from '../data/maps';
import { ResourceKey, Resources, RESOURCE_COLORS } from '../data/resources';
import { gridToScreen, isoDepth } from '../utils/isometric';

interface Villager {
  resource: ResourceKey;
  alive: boolean;
}

/**
 * A Village sits at a fixed grid tile (the goal). It owns N villagers, each
 * assigned to one resource. Villagers tick income while alive. When an enemy
 * reaches the goal, one villager dies (chosen at random from those alive).
 *
 * The village's tile is NOT walkable for tower placement — it's reserved.
 */
export class Village {
  public container: Container;
  public col: number;
  public row: number;

  private villagers: Villager[] = [];
  private tickTimer: Map<ResourceKey, number> = new Map();
  private tickSeconds: number;
  private dotsLayer: Graphics;
  private base: Graphics;

  constructor(def: VillageDef, goalCol: number, goalRow: number) {
    this.col = goalCol;
    this.row = goalRow;
    this.tickSeconds = def.tickSeconds;

    // Build the villager list from the role distribution.
    const roles = def.roles;
    const keys: ResourceKey[] = ['wood', 'gold', 'stone', 'food'];
    for (const k of keys) {
      const n = roles[k] ?? 0;
      for (let i = 0; i < n; i++) {
        this.villagers.push({ resource: k, alive: true });
      }
    }
    // If sum of roles doesn't match count, pad with food villagers (best-effort).
    while (this.villagers.length < def.count) {
      this.villagers.push({ resource: 'food', alive: true });
    }
    // Trim if oversized.
    if (this.villagers.length > def.count) this.villagers.length = def.count;

    // Each resource type has its own tick clock so income is staggered.
    for (const k of keys) this.tickTimer.set(k, 0);

    this.container = new Container();
    const { x, y } = gridToScreen(goalCol, goalRow);
    this.container.x = x;
    this.container.y = y;
    this.container.zIndex = isoDepth(goalCol, goalRow) + 0.3;

    // A small cluster of houses sitting on the goal tile, plus a status flag.
    this.base = new Graphics();
    this.drawBase();
    this.container.addChild(this.base);

    this.dotsLayer = new Graphics();
    this.container.addChild(this.dotsLayer);
    this.drawDots();
  }

  /** Advance income clocks and return resources earned this frame. */
  tick(dt: number): Partial<Resources> {
    const earned: Partial<Resources> = {};
    const keys: ResourceKey[] = ['wood', 'gold', 'stone', 'food'];
    for (const k of keys) {
      const aliveCount = this.villagers.filter((v) => v.alive && v.resource === k).length;
      if (aliveCount === 0) continue;

      let t = this.tickTimer.get(k) ?? 0;
      t += dt;
      // Per-villager ticks: if multiple villagers of this resource are alive
      // they all tick on the same clock. Tweak: use shorter effective period
      // so more villagers = faster income.
      const effectivePeriod = this.tickSeconds / aliveCount;
      let gained = 0;
      while (t >= effectivePeriod) {
        gained += 1;
        t -= effectivePeriod;
      }
      this.tickTimer.set(k, t);
      if (gained > 0) earned[k] = (earned[k] ?? 0) + gained;
    }
    return earned;
  }

  /** Kill one villager; returns true if any were alive. */
  killOne(): boolean {
    const alive = this.villagers.filter((v) => v.alive);
    if (alive.length === 0) return false;
    // Pick at random for fairness.
    const victim = alive[Math.floor(Math.random() * alive.length)];
    victim.alive = false;
    this.drawDots();
    return true;
  }

  aliveCount(): number {
    return this.villagers.filter((v) => v.alive).length;
  }

  totalCount(): number {
    return this.villagers.length;
  }

  /** Snapshot of alive villagers per resource, for HUD display. */
  aliveByResource(): Record<ResourceKey, number> {
    const out: Record<ResourceKey, number> = { wood: 0, gold: 0, stone: 0, food: 0 };
    for (const v of this.villagers) {
      if (v.alive) out[v.resource]++;
    }
    return out;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  private drawBase(): void {
    // A simple square house on the tile, slightly elevated.
    this.base.clear();
    const cx = 0;
    const cy = 16; // tile center
    // base footprint
    this.base
      .rect(cx - 14, cy - 4, 28, 8)
      .fill(0x6a4828)
      .stroke({ color: 0x000000, width: 1 });
    // house body
    this.base
      .rect(cx - 12, cy - 16, 24, 14)
      .fill(0xa07848)
      .stroke({ color: 0x000000, width: 1 });
    // roof
    this.base
      .moveTo(cx - 14, cy - 16)
      .lineTo(cx, cy - 26)
      .lineTo(cx + 14, cy - 16)
      .closePath()
      .fill(0x8a3020)
      .stroke({ color: 0x000000, width: 1 });
    // door
    this.base
      .rect(cx - 3, cy - 12, 6, 10)
      .fill(0x3a2010);
  }

  /** Render villager dots in a small grid above the house. */
  private drawDots(): void {
    this.dotsLayer.clear();
    const cx = 0;
    const baseY = -34; // above the roof
    const dotR = 2.5;
    const cols = Math.ceil(Math.sqrt(this.villagers.length));
    const spacing = 7;
    this.villagers.forEach((v, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = cx - ((cols - 1) * spacing) / 2 + col * spacing;
      const y = baseY - row * spacing;
      const color = v.alive ? hexToInt(RESOURCE_COLORS[v.resource]) : 0x404040;
      this.dotsLayer
        .circle(x, y, dotR)
        .fill(color)
        .stroke({ color: 0x000000, width: 0.5 });
    });
  }
}

function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}
