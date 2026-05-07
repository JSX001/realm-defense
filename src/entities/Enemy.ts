import { Container, Graphics } from 'pixi.js';
import { EnemyDef } from '../data/enemies';
import { gridToScreen, isoDepth } from '../utils/isometric';
import { sfxEnemyDeath } from '../utils/sound';

export class Enemy {
  public container: Container;
  public col: number;
  public row: number;
  public hp: number;
  public maxHp: number;
  public alive = true;
  public reachedGoal = false;
  public rewarded = false;
  public def: EnemyDef; // exposed so towers can check layer for targeting
  /**
   * Damage multiplier applied to incoming damage (after armor reduction).
   * Updated each frame from any monastery Faith auras the enemy is inside.
   * 1 = no Faith, 1.4 = +40% damage taken from L4 monastery, etc.
   * Multiple overlapping monasteries multiply together (intentional; rare and
   * deserved when you've invested in two side-by-side monasteries).
   */
  public damageMultiplier = 1;

  private path: { col: number; row: number }[];
  private waypointIndex = 0;
  private body: Graphics;
  private hpBar: Graphics;
  private hitFlash: Graphics;
  private hitFlashTimer = 0;

  // Active slow effects. Each shot from a frost tower adds one. They stack
  // multiplicatively (0.7 * 0.7 = 0.49 → 51% slow), capped at a floor.
  private activeSlows: { factor: number; expiresAt: number }[] = [];
  /** Effective slow factor (product of active slows, capped). 1 = no slow. */
  private slowFactor = 1;
  /** Wall-clock-equivalent timer used for slow expiry (driven by dt). */
  private slowClock = 0;

  /** When true, the enemy halts at its current tile (e.g. a sapper chewing through a wall). */
  public paused = false;
  /** Sapper-only: rolling timer for the chew swing animation. */
  private swingTimer = 0;

  constructor(def: EnemyDef, path: { col: number; row: number }[], hpMultiplier = 1) {
    this.def = def;
    this.path = path;
    this.col = path[0].col;
    this.row = path[0].row;
    // Difficulty multiplier applied at spawn — multiplied into both current
    // and max so the HP bar starts at 100%.
    this.hp = Math.round(def.hp * hpMultiplier);
    this.maxHp = this.hp;

    this.container = new Container();
    this.body = new Graphics();
    // Hit flash overlay must be created BEFORE drawBody (which fills its shape).
    this.hitFlash = new Graphics();
    this.hitFlash.alpha = 0;

    this.drawBody();
    this.container.addChild(this.body);
    this.container.addChild(this.hitFlash);

    this.hpBar = new Graphics();
    this.container.addChild(this.hpBar);
    this.updateHpBar();

    this.updatePosition();
  }

  /** Render body. For air units, also draw a small "shadow" diamond on the ground. */
  private drawBody(): void {
    const def = this.def;
    const cy = this.bodyCenterY();

    if (def.layer === 'armored') {
      // Mangonel: dark wooden box (siege engine) with two visible wheels.
      const w = def.size * 1.6;
      const h = def.size * 1.3;
      // box body
      this.body
        .rect(-w / 2, cy - h / 2, w, h)
        .fill(def.color)
        .stroke({ color: def.outline, width: 1.5 });
      // diagonal beam (siege arm)
      this.body
        .moveTo(-w / 2 + 2, cy - h / 2 - 2)
        .lineTo(w / 2 - 4, cy - h / 2 - 10)
        .stroke({ color: 0x402048, width: 2 });
      // wheels
      this.body
        .circle(-w / 2 + 4, cy + h / 2 - 1, 4)
        .fill(0x201018)
        .stroke({ color: 0x000000, width: 1 });
      this.body
        .circle(w / 2 - 4, cy + h / 2 - 1, 4)
        .fill(0x201018)
        .stroke({ color: 0x000000, width: 1 });
    } else if (def.id === 'sapper') {
      // Brown body circle plus a pickaxe sticking out the side.
      this.body.circle(0, cy, def.size).fill(def.color).stroke({ color: def.outline, width: 1 });
      // Pickaxe handle (diagonal)
      this.body
        .moveTo(def.size - 1, cy - def.size + 2)
        .lineTo(def.size + 6, cy + def.size - 4)
        .stroke({ color: 0x402810, width: 2 });
      // Pickaxe head (small triangle at the top)
      this.body
        .moveTo(def.size - 3, cy - def.size + 1)
        .lineTo(def.size + 3, cy - def.size - 2)
        .lineTo(def.size + 1, cy - def.size + 4)
        .closePath()
        .fill(0x808890)
        .stroke({ color: 0x000000, width: 0.5 });
    } else if (def.id === 'militia') {
      // Militia: stocky humanoid. Oval body slightly wider than tall, small
      // darker head, a club to the right side. Reads as "footman with weapon."
      const s = def.size;
      // Body torso (rounded rect / oval)
      this.body.ellipse(0, cy + 1, s * 0.95, s * 1.05).fill(def.color).stroke({ color: def.outline, width: 1 });
      // Darker shading on the lower half
      this.body.ellipse(0, cy + s * 0.4, s * 0.85, s * 0.45).fill({ color: 0x602010, alpha: 0.55 });
      // Head (small lighter circle on top)
      this.body.circle(0, cy - s * 0.85, s * 0.45).fill(0xd0a070).stroke({ color: def.outline, width: 0.8 });
      // Club: short diagonal bar to the right side
      this.body
        .moveTo(s * 0.6, cy + s * 0.3)
        .lineTo(s * 1.2, cy - s * 0.4)
        .stroke({ color: 0x4a2810, width: 2.2 });
      // Club head (small ellipse at the tip)
      this.body.circle(s * 1.2, cy - s * 0.4, 1.6).fill(0x6a3818).stroke({ color: 0x000000, width: 0.5 });
    } else if (def.id === 'scoutCavalry') {
      // Scout Cavalry: horse + rider seen from a 3/4 angle. Horizontal oval
      // body distinguishes from foot units; a small darker rider blob sits
      // on top-back. Two leg dashes underneath sell the "moving fast" feel.
      const s = def.size;
      // Horse body (horizontal oval, longer than tall)
      this.body.ellipse(0, cy + 2, s * 1.4, s * 0.7).fill(def.color).stroke({ color: def.outline, width: 1 });
      // Belly shadow
      this.body.ellipse(0, cy + s * 0.35, s * 1.15, s * 0.28).fill({ color: 0x806030, alpha: 0.55 });
      // Horse neck/head leaning forward (right side)
      this.body
        .ellipse(s * 0.8, cy - s * 0.2, s * 0.4, s * 0.55)
        .fill(def.color)
        .stroke({ color: def.outline, width: 0.8 });
      // Snout dot
      this.body.circle(s * 1.05, cy - s * 0.05, 1.3).fill(0x806030);
      // Rider (small dark blob sitting back-center)
      this.body.circle(-s * 0.15, cy - s * 0.55, s * 0.45).fill(0x504028).stroke({ color: 0x000000, width: 0.6 });
      // Helmet glint
      this.body.circle(-s * 0.2, cy - s * 0.7, 1.0).fill(0x9a8050);
      // Two leg dashes underneath
      this.body.rect(-s * 0.7, cy + s * 0.55, 2, 3).fill(0x402818);
      this.body.rect(s * 0.5, cy + s * 0.55, 2, 3).fill(0x402818);
    } else if (def.id === 'skirmisher') {
      // Skirmisher: small light scout with a peaked hood and a bow. Round
      // body but with a clear pointed top and a diagonal bow line — reads as
      // "small ranged" instead of just a small circle.
      const s = def.size;
      // Body
      this.body.circle(0, cy, s).fill(def.color).stroke({ color: def.outline, width: 1 });
      // Lower-half shadow
      this.body.ellipse(0, cy + s * 0.4, s * 0.9, s * 0.45).fill({ color: 0x305020, alpha: 0.6 });
      // Pointed hood/peak on top — small triangle
      this.body
        .moveTo(-s * 0.5, cy - s * 0.5)
        .lineTo(0, cy - s * 1.6)
        .lineTo(s * 0.5, cy - s * 0.5)
        .closePath()
        .fill(0x405028)
        .stroke({ color: def.outline, width: 0.6 });
      // Bow (diagonal arc-ish line on the left side)
      this.body
        .moveTo(-s * 1.1, cy - s * 0.4)
        .quadraticCurveTo(-s * 1.5, cy + s * 0.1, -s * 1.0, cy + s * 0.6)
        .stroke({ color: 0x6a4828, width: 1.5 });
      // Bowstring
      this.body
        .moveTo(-s * 1.1, cy - s * 0.4)
        .lineTo(-s * 1.0, cy + s * 0.6)
        .stroke({ color: 0xd8c898, width: 0.6 });
    } else if (def.id === 'paladin') {
      // Paladin: heavily armored knight. Squarer "armored block" silhouette,
      // a plumed helm crest on top, a small shield silhouette on the left.
      // Two-tone shading (lit top, shadow bottom) sells "metal."
      const s = def.size;
      // Body — slightly tall rounded rectangle (squarer than circle)
      const bw = s * 1.4;
      const bh = s * 1.7;
      this.body
        .roundRect(-bw / 2, cy - bh / 2 + s * 0.2, bw, bh, 3)
        .fill(def.color)
        .stroke({ color: def.outline, width: 1.2 });
      // Lit top half (lighter band)
      this.body
        .roundRect(-bw / 2 + 1, cy - bh / 2 + s * 0.2 + 1, bw - 2, bh * 0.45, 2)
        .fill({ color: 0xe0e0f0, alpha: 0.45 });
      // Shadow bottom half
      this.body
        .roundRect(-bw / 2 + 1, cy + s * 0.1, bw - 2, bh * 0.4, 2)
        .fill({ color: 0x404858, alpha: 0.45 });
      // Helm: small dome on top
      this.body
        .ellipse(0, cy - bh / 2 + s * 0.1, s * 0.55, s * 0.5)
        .fill(0x8a8aa0)
        .stroke({ color: def.outline, width: 0.8 });
      // Visor slit
      this.body.rect(-s * 0.3, cy - bh / 2 - s * 0.1, s * 0.6, 1.5).fill(0x101018);
      // Plume crest (red, tall narrow shape)
      this.body
        .moveTo(-s * 0.15, cy - bh / 2 - s * 0.1)
        .quadraticCurveTo(s * 0.2, cy - bh / 2 - s * 0.9, s * 0.3, cy - bh / 2 - s * 0.5)
        .quadraticCurveTo(s * 0.1, cy - bh / 2 - s * 0.4, s * 0.0, cy - bh / 2 - s * 0.1)
        .closePath()
        .fill(0xc02020)
        .stroke({ color: 0x500808, width: 0.6 });
      // Shield on left side (small kite shape)
      this.body
        .moveTo(-bw / 2 - 1, cy - s * 0.2)
        .lineTo(-bw / 2 + s * 0.4, cy - s * 0.4)
        .lineTo(-bw / 2 + s * 0.4, cy + s * 0.5)
        .lineTo(-bw / 2 - 1, cy + s * 0.2)
        .closePath()
        .fill(0x8a3030)
        .stroke({ color: 0x000000, width: 0.6 });
      // Small cross on shield
      this.body.rect(-bw / 2 + s * 0.0, cy - s * 0.05, 1.2, s * 0.4).fill(0xd8c898);
      this.body.rect(-bw / 2 - s * 0.15, cy + s * 0.1, s * 0.5, 1.2).fill(0xd8c898);
    } else {
      // Fallback: simple colored circle (kept as a safety net for any future
      // enemy added without a custom silhouette).
      this.body.circle(0, cy, def.size).fill(def.color).stroke({ color: def.outline, width: 1 });
    }

    // Pre-build the hit-flash shape sized to the silhouette. Generous radius
    // covers helms, plumes, weapons, etc. without needing per-enemy tuning.
    const flashRadius = def.layer === 'armored' ? def.size * 1.4 : def.size * 1.8;
    this.hitFlash.circle(0, cy, flashRadius).fill({ color: 0xffffff, alpha: 1 });
  }

  /** Where the body's "center of mass" is in container-local Y. */
  private bodyCenterY(): number {
    // Tile center y = 16 (TILE_H/2). All units sit with their feet there.
    return 16 - this.def.size;
  }

  /**
   * Replace the enemy's path with a fresh A*-computed one. To avoid a visible
   * "snap" when the enemy is between tiles at the moment of replanning, we
   * prepend the enemy's *exact* current position as a virtual waypoint. The
   * next movement step then proceeds smoothly from where the enemy actually is,
   * not from the nearest grid cell.
   */
  setPath(newPath: { col: number; row: number }[]): void {
    if (newPath.length === 0) return;
    // If the enemy is already exactly on newPath[0], skip prepending.
    const first = newPath[0];
    const onTile = Math.abs(this.col - first.col) < 0.001 && Math.abs(this.row - first.row) < 0.001;
    if (onTile) {
      this.path = newPath;
    } else {
      // Prepend a "current position" waypoint so the first move step heads
      // toward the new path's first tile from where we are now.
      this.path = [{ col: this.col, row: this.row }, ...newPath];
    }
    this.waypointIndex = 0;
  }

  /** Move along the path. */
  update(dt: number): void {
    if (!this.alive) return;

    // Tick slow effects: advance clock, prune expired, recompute factor.
    this.slowClock += dt;
    if (this.activeSlows.length > 0) {
      this.activeSlows = this.activeSlows.filter(s => s.expiresAt > this.slowClock);
      this.recomputeSlowFactor();
    }

    // Tick hit flash.
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= dt;
      this.hitFlash.alpha = Math.max(0, this.hitFlashTimer / 0.12);
    }

    if (this.waypointIndex >= this.path.length - 1) {
      this.reachedGoal = true;
      this.alive = false;
      return;
    }
    if (this.paused) {
      // Sapper swings the pickaxe while chewing. Bob the body forward and back.
      if (this.def.id === 'sapper') {
        this.swingTimer += dt;
        // ~1.4 swings per second. sin gives oscillation; offset body container x slightly.
        const bob = Math.sin(this.swingTimer * Math.PI * 2.8) * 2.5;
        this.body.x = bob;
        this.body.y = -Math.abs(bob * 0.4); // tiny vertical lift on each swing
      }
      // Halt — Game.ts is handling something (e.g., chewing a wall in front of us).
      return;
    }
    // Reset body offset when no longer paused.
    if (this.def.id === 'sapper' && (this.body.x !== 0 || this.body.y !== 0)) {
      this.body.x = 0;
      this.body.y = 0;
    }
    const next = this.path[this.waypointIndex + 1];
    const dx = next.col - this.col;
    const dy = next.row - this.row;
    const dist = Math.hypot(dx, dy);
    const step = this.def.speed * this.slowFactor * dt;
    if (dist <= step) {
      this.col = next.col;
      this.row = next.row;
      this.waypointIndex++;
    } else {
      this.col += (dx / dist) * step;
      this.row += (dy / dist) * step;
    }
    this.updatePosition();
  }

  /** Apply damage with armor reduction. */
  takeDamage(amount: number): void {
    if (!this.alive) return;
    const armor = this.def.armor ?? 0;
    // Armor reduces incoming damage to a minimum of 1 (prevents stalemates).
    // Faith multiplier then scales the post-armor damage — so an L4 monastery
    // (1.4×) over an armored Mangonel still helps, but proportionally not as
    // much as it would help an unarmored target.
    const afterArmor = Math.max(1, amount - armor);
    const actual = afterArmor * this.damageMultiplier;
    this.hp -= actual;
    this.hitFlashTimer = 0.12;
    this.hitFlash.alpha = 1;
    if (this.hp <= 0) {
      this.alive = false;
      sfxEnemyDeath();
    }
    this.updateHpBar();
  }

  /**
   * Apply a slow effect. Slows STACK multiplicatively (multiple frost towers
   * are much better than one). Each slow is stored as its own entry with a
   * duration; effective slowFactor = product of all active, capped at floor.
   */
  applySlow(factor: number, duration: number): void {
    if (!this.alive) return;
    this.activeSlows.push({ factor, expiresAt: this.slowClock + duration });
    this.recomputeSlowFactor();
  }

  /** Floor on stacked slows so enemies can't be near-frozen indefinitely. */
  private static readonly SLOW_FLOOR = 0.15; // max 85% slow

  private recomputeSlowFactor(): void {
    let product = 1;
    for (const s of this.activeSlows) product *= s.factor;
    this.slowFactor = Math.max(Enemy.SLOW_FLOOR, product);
  }

  /** Distance to a tile position, in tile units. */
  distanceTo(col: number, row: number): number {
    return Math.hypot(this.col - col, this.row - row);
  }

  /** The tile the enemy is heading toward next (the next waypoint), or null if at end. */
  getNextTile(): { col: number; row: number } | null {
    if (this.waypointIndex >= this.path.length - 1) return null;
    return this.path[this.waypointIndex + 1];
  }

  private updatePosition(): void {
    const { x, y } = gridToScreen(this.col, this.row);
    this.container.x = x;
    this.container.y = y;
    this.container.zIndex = isoDepth(this.col, this.row) + 0.5;
  }

  private updateHpBar(): void {
    this.hpBar.clear();
    const w = 20;
    const ratio = Math.max(0, this.hp / this.maxHp);
    const cy = this.bodyCenterY();
    const barY = cy - this.def.size - 6;
    this.hpBar.rect(-w / 2, barY, w, 3).fill(0x222222);
    this.hpBar.rect(-w / 2, barY, w * ratio, 3).fill(ratio > 0.5 ? 0x44dd44 : ratio > 0.25 ? 0xddaa44 : 0xdd4444);
    // Tint slightly cyan if currently slowed (visible feedback).
    if (this.slowTimer > 0) {
      this.hpBar.rect(-w / 2, barY + 4, w, 1).fill({ color: 0x88ddff, alpha: 0.8 });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  getReward(): number { return this.def.reward; }
  getDamage(): number { return this.def.damage; }
}
