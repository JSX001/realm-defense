import { Container, Graphics } from 'pixi.js';
import { TowerDef, TowerLevel, getLevelStats } from '../data/towers';
import { Enemy } from './Enemy';
import { Projectile } from './Projectile';
import { gridToScreen, isoDepth, TILE_W, TILE_H } from '../utils/isometric';
import {
  sfxBowShot, sfxHeavyShot, sfxCaltropsShot, sfxGreekFire, sfxUpgradeComplete
} from '../utils/sound';

export class Tower {
  public container: Container;
  public col: number;
  public row: number;
  public def: TowerDef;
  public level: number = 0;

  /** Wall HP. Only meaningful for wall-type towers (palisade, wall). 0 = destroyed. */
  public hp: number = Infinity;
  public maxHp: number = Infinity;

  /** Heat-based overheat system. Each shot adds heatPerShot; coolRate ticks down. */
  public heat = 0;
  public maxHeat = 100;
  public overheated = false;

  /** Construction-in-progress: when > 0, tower is being upgraded. Counts down by dt. */
  private upgradeRemainingSec = 0;
  private upgradeTotalSec = 0;
  /** If upgrading, this is the level we're upgrading TO (level + 1 at start). */
  private upgradeTargetLevel = 0;
  private scaffold: Graphics;
  private progressRing: Graphics;

  private cooldown = 0;
  private rangeIndicator: Graphics;
  private body: Graphics;
  private levelPips: Graphics;
  private hpBar: Graphics;
  private heatBar: Graphics;
  /** When > 0, the wall is briefly tinted to show it's being hit. */
  private hitFlashTimer = 0;

  // Visual sizes (vary by tower id; level adds small modifiers)
  private bodyHeight: number = 0;
  private roofHeight: number = 0;
  private bodyWidth: number = 0;

  constructor(def: TowerDef, col: number, row: number) {
    this.def = def;
    this.col = col;
    this.row = row;

    // Wall HP. Stone walls take much longer to chew through than palisades.
    if (def.id === 'palisade') {
      this.hp = this.maxHp = 40;
    } else if (def.id === 'wall') {
      this.hp = this.maxHp = 200;
    }

    this.container = new Container();

    this.rangeIndicator = new Graphics();
    this.rangeIndicator.visible = false;
    this.container.addChild(this.rangeIndicator);

    this.body = new Graphics();
    this.container.addChild(this.body);

    this.levelPips = new Graphics();
    this.container.addChild(this.levelPips);

    this.hpBar = new Graphics();
    this.container.addChild(this.hpBar);

    this.heatBar = new Graphics();
    this.container.addChild(this.heatBar);

    this.scaffold = new Graphics();
    this.container.addChild(this.scaffold);
    this.progressRing = new Graphics();
    this.container.addChild(this.progressRing);

    this.recomputeVisualSizes();
    this.drawBody();
    this.drawRange();
    this.drawLevelPips();
    this.drawHpBar();
    this.drawHeatBar();
    // Monastery: aura is always visible. Other towers only show range when
    // selected or being placed.
    if (this.def.id === 'monastery') this.rangeIndicator.visible = true;

    const { x, y } = gridToScreen(col, row);
    this.container.x = x;
    this.container.y = y;
    this.container.zIndex = isoDepth(col, row);
  }

  /** True if this is a destructible obstacle (palisade or stone wall). */
  isWall(): boolean {
    return this.def.id === 'palisade' || this.def.id === 'wall';
  }

  /** Apply damage. Only meaningful for walls. Returns true if the wall was destroyed. */
  takeDamage(amount: number): boolean {
    if (!this.isWall()) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.drawHpBar();
    // Brief tint to show the wall is taking hits. Continuous chewing keeps
    // re-setting this each frame, so the wall stays subtly red while attacked.
    this.hitFlashTimer = 0.18;
    this.body.tint = 0xff8060;
    return this.hp <= 0;
  }

  isDead(): boolean {
    return this.isWall() && this.hp <= 0;
  }

  /** Effective stats at the current level. */
  stats(): TowerLevel {
    return getLevelStats(this.def, this.level);
  }

  /**
   * Begin a timed upgrade. Returns true if the upgrade was started.
   * The tower keeps firing at its current level during construction.
   */
  startUpgrade(): boolean {
    if (!this.canUpgrade()) return false;
    if (this.isUpgrading()) return false;
    const target = this.level + 1;
    this.upgradeTargetLevel = target;
    // Time scales by target level: bigger upgrades take longer.
    this.upgradeTotalSec = Tower.upgradeDurationFor(target);
    this.upgradeRemainingSec = this.upgradeTotalSec;
    this.drawScaffold();
    this.drawProgressRing();
    return true;
  }

  /** Advance the upgrade timer. Returns true if the upgrade just completed. */
  tickUpgrade(dt: number): boolean {
    if (!this.isUpgrading()) return false;
    this.upgradeRemainingSec -= dt;
    if (this.upgradeRemainingSec <= 0) {
      this.upgradeRemainingSec = 0;
      this.completeUpgrade();
      return true;
    }
    this.drawProgressRing();
    return false;
  }

  isUpgrading(): boolean {
    return this.upgradeRemainingSec > 0;
  }

  /** 0..1 progress through the current upgrade (1 = done). */
  upgradeProgress(): number {
    if (!this.isUpgrading()) return 0;
    return 1 - this.upgradeRemainingSec / this.upgradeTotalSec;
  }

  /** Seconds remaining on the current upgrade, for HUD display. */
  upgradeSecondsRemaining(): number {
    return this.upgradeRemainingSec;
  }

  private completeUpgrade(): void {
    this.level = this.upgradeTargetLevel;
    this.upgradeTargetLevel = 0;
    this.recomputeVisualSizes();
    this.body.clear();
    this.drawBody();
    this.rangeIndicator.clear();
    this.drawRange();
    this.drawLevelPips();
    this.scaffold.clear();
    this.progressRing.clear();
    sfxUpgradeComplete();
  }

  /** Per-target-level duration. Bigger upgrades take longer. */
  private static upgradeDurationFor(targetLevel: number): number {
    // targetLevel is 1..4 (we have 5 levels max, so highest target is 4)
    switch (targetLevel) {
      case 1: return 3;
      case 2: return 5;
      case 3: return 8;
      case 4: return 12;
      default: return 5;
    }
  }

  canUpgrade(): boolean {
    return this.level < this.def.levels.length - 1;
  }

  /** Cost to upgrade to the next level (or null if maxed). */
  nextUpgradeCost(): number | null {
    if (!this.canUpgrade()) return null;
    return this.def.levels[this.level + 1].cost;
  }

  private recomputeVisualSizes(): void {
    const id = this.def.id;
    const lv = this.level;
    this.bodyWidth = (
      id === 'trebuchet' ? 28 :
      id === 'lightning' ? 18 :
      id === 'watchtower' ? 16 :
      id === 'monastery' ? 26 :
      22
    ) + lv;
    this.bodyHeight = (
      id === 'lightning' ? 40 :
      id === 'trebuchet' ? 22 :
      id === 'watchtower' ? 46 :
      id === 'monastery' ? 24 :
      28
    ) + lv * 2;
    this.roofHeight = (
      id === 'lightning' ? 14 :
      id === 'watchtower' ? 6 :
      id === 'monastery' ? 14 :
      12
    ) + lv;
  }

  private drawBody(): void {
    const def = this.def;
    const cx = 0;
    const cy = TILE_H / 2;

    // Walls are simple stone blocks, no roof, no level scaling.
    if (def.id === 'wall') {
      // Diamond base (matches tile).
      this.body
        .moveTo(0, 0)
        .lineTo(TILE_W / 2, TILE_H / 2)
        .lineTo(0, TILE_H)
        .lineTo(-TILE_W / 2, TILE_H / 2)
        .closePath()
        .fill(def.color)
        .stroke({ color: 0x000000, width: 1 });
      // Short stone block on top.
      const bw = 26;
      const bh = 14;
      this.body
        .rect(cx - bw / 2, cy - bh, bw, bh)
        .fill(def.bodyColor)
        .stroke({ color: 0x000000, width: 1 });
      // Two horizontal mortar lines for stone-block texture.
      this.body
        .moveTo(cx - bw / 2 + 1, cy - bh + 5)
        .lineTo(cx + bw / 2 - 1, cy - bh + 5)
        .stroke({ color: 0x000000, width: 0.5, alpha: 0.5 });
      this.body
        .moveTo(cx - bw / 2 + 1, cy - bh + 10)
        .lineTo(cx + bw / 2 - 1, cy - bh + 10)
        .stroke({ color: 0x000000, width: 0.5, alpha: 0.5 });
      this.body
        .moveTo(cx - 4, cy - bh + 1)
        .lineTo(cx - 4, cy - bh + 5)
        .stroke({ color: 0x000000, width: 0.5, alpha: 0.5 });
      this.body
        .moveTo(cx + 6, cy - bh + 5)
        .lineTo(cx + 6, cy - bh + 10)
        .stroke({ color: 0x000000, width: 0.5, alpha: 0.5 });
      return;
    }

    // Wood palisade — vertical sharpened logs.
    if (def.id === 'palisade') {
      // Diamond base.
      this.body
        .moveTo(0, 0)
        .lineTo(TILE_W / 2, TILE_H / 2)
        .lineTo(0, TILE_H)
        .lineTo(-TILE_W / 2, TILE_H / 2)
        .closePath()
        .fill(def.color)
        .stroke({ color: 0x000000, width: 1 });
      // Five short vertical logs with pointed tops.
      const logW = 4;
      const logH = 12;
      const startX = cx - 12;
      for (let i = 0; i < 5; i++) {
        const lx = startX + i * 6;
        const ly = cy - logH;
        // Log body
        this.body
          .rect(lx - logW / 2, ly, logW, logH)
          .fill(def.bodyColor)
          .stroke({ color: 0x000000, width: 0.5 });
        // Pointed top
        this.body
          .moveTo(lx - logW / 2, ly)
          .lineTo(lx, ly - 4)
          .lineTo(lx + logW / 2, ly)
          .closePath()
          .fill(def.bodyColor)
          .stroke({ color: 0x000000, width: 0.5 });
      }
      return;
    }

    // Attacking towers: shared base + per-type silhouette.
    const bw = this.bodyWidth;
    const bh = this.bodyHeight;
    const rh = this.roofHeight;

    // Slightly brighter at higher levels (subtle visual cue).
    const tint = this.level * 0x080808;
    const bodyColor = clampColor(def.bodyColor + tint);
    const roofColor = clampColor(def.roofColor + tint);

    // Diamond base (matches the tile underneath).
    this.body
      .moveTo(0, 0)
      .lineTo(TILE_W / 2, TILE_H / 2)
      .lineTo(0, TILE_H)
      .lineTo(-TILE_W / 2, TILE_H / 2)
      .closePath()
      .fill(def.color)
      .stroke({ color: 0x000000, width: 1 });

    // Foundation lip: a small darker band at the very base of the tower,
    // sitting on the diamond. Sells the "structure planted in the ground" feel.
    const lipW = bw + 6;
    const lipH = 4;
    this.body
      .rect(cx - lipW / 2, cy - lipH, lipW, lipH)
      .fill(0x3a2818)
      .stroke({ color: 0x000000, width: 1 });

    // Per-tower silhouette. Each helper draws the upright body and any
    // tower-specific accents. They all share the same coord system: cx, cy
    // is the bottom-center of the tower; bw, bh, rh are the sized fields.
    const isStone = def.id === 'bombard' || def.id === 'lightning' || def.id === 'watchtower';
    const isWood = def.id === 'archer' || def.id === 'frost';
    // Trebuchet's "body" is an A-frame, not a continuous slab — the shared
    // shading + plank overlays would draw on empty space, so it opts out.
    // Monastery uses cream-coloured stone (not the darker gray) so the stone
    // mortar overlay would look wrong; it draws its own block-and-window detail.
    const useSharedOverlays = def.id !== 'trebuchet' && def.id !== 'monastery';

    if (def.id === 'archer') this.drawArcherTower(cx, cy, bw, bh, rh, bodyColor, roofColor);
    else if (def.id === 'bombard') this.drawBombardTower(cx, cy, bw, bh, rh, bodyColor, roofColor);
    else if (def.id === 'frost') this.drawCaltropsTower(cx, cy, bw, bh, rh, bodyColor, roofColor);
    else if (def.id === 'lightning') this.drawGreekFireTower(cx, cy, bw, bh, rh, bodyColor, roofColor);
    else if (def.id === 'trebuchet') this.drawTrebuchetTower(cx, cy, bw, bh, rh, bodyColor, roofColor);
    else if (def.id === 'watchtower') this.drawWatchtowerTower(cx, cy, bw, bh, rh, bodyColor, roofColor);
    else if (def.id === 'monastery') this.drawMonasteryTower(cx, cy, bw, bh, rh, bodyColor, roofColor);

    // Shared body shading: lit-from-left. Add a darker strip on the right ~30%
    // of the body and a lighter strip on the left ~20%. Sells volume cheaply.
    // Drawn LAST so it overlays the per-tower body fills.
    if (useSharedOverlays) {
      const shadeTop = cy - bh + 2;
      const shadeBot = cy - 4;
      // Shadow side (right)
      this.body
        .rect(cx + bw / 2 - bw * 0.30, shadeTop, bw * 0.30, shadeBot - shadeTop)
        .fill({ color: 0x000000, alpha: 0.22 });
      // Lit side (left)
      this.body
        .rect(cx - bw / 2, shadeTop, bw * 0.18, shadeBot - shadeTop)
        .fill({ color: 0xffffff, alpha: 0.10 });

      // Shared mortar / plank lines based on material.
      if (isStone) this.drawStoneMortar(cx, cy, bw, bh);
      if (isWood) this.drawWoodPlanks(cx, cy, bw, bh);
    }

    // Level-up flag on the roof at L3+ (subtle progression cue beyond pips).
    if (this.level >= 3) {
      const flagY = cy - bh - rh;
      this.body
        .moveTo(cx - 1, flagY)
        .lineTo(cx - 1, flagY - 14)
        .stroke({ color: 0x2a1808, width: 1 });
      this.body
        .moveTo(cx - 1, flagY - 14)
        .lineTo(cx + 7, flagY - 11)
        .lineTo(cx - 1, flagY - 8)
        .closePath()
        .fill(0xa02828)
        .stroke({ color: 0x500808, width: 0.6 });
    }
  }

  // ─── Per-tower body helpers ─────────────────────────────────────────────

  private drawArcherTower(cx: number, cy: number, bw: number, bh: number, rh: number, bodyColor: number, roofColor: number): void {
    const top = cy - bh;
    // Wooden body
    this.body.rect(cx - bw / 2, top, bw, bh).fill(bodyColor).stroke({ color: 0x000000, width: 1 });
    // Small balcony/platform near the top with a slightly wider lip
    const balconyY = top + 6;
    this.body.rect(cx - bw / 2 - 2, balconyY, bw + 4, 3).fill(0x4a3010).stroke({ color: 0x000000, width: 0.6 });
    // Arrow slit (cross-shaped) high on the body
    const slitX = cx;
    const slitY = top + 11;
    this.body.rect(slitX - 0.7, slitY, 1.4, 5).fill(0x101010);
    this.body.rect(slitX - 2, slitY + 1.5, 4, 1.4).fill(0x101010);
    // Pointed thatched roof — slightly overhanging
    this.body
      .moveTo(cx - bw / 2 - 3, top)
      .lineTo(cx, top - rh)
      .lineTo(cx + bw / 2 + 3, top)
      .closePath()
      .fill(roofColor)
      .stroke({ color: 0x000000, width: 1 });
    // Thatch ridge lines (short diagonals on the roof)
    for (let i = 0; i < 3; i++) {
      const t = (i + 1) / 4;
      this.body
        .moveTo(cx - bw / 2 - 3 + (bw + 6) * t, top)
        .lineTo(cx - bw / 2 - 3 + (bw + 6) * t + 2, top - rh * 0.4 * t)
        .stroke({ color: 0x000000, width: 0.4, alpha: 0.5 });
    }
  }

  private drawBombardTower(cx: number, cy: number, bw: number, bh: number, _rh: number, bodyColor: number, roofColor: number): void {
    const top = cy - bh;
    // Squat stone body
    this.body.rect(cx - bw / 2, top, bw, bh).fill(bodyColor).stroke({ color: 0x000000, width: 1 });
    // Crenellation cap (3 small merlons across the top)
    const mw = (bw - 4) / 5; // merlon width with gaps
    const mh = 3;
    for (let i = 0; i < 3; i++) {
      const mx = cx - bw / 2 + 2 + i * (mw + 2);
      this.body
        .rect(mx, top - mh, mw, mh)
        .fill(roofColor)
        .stroke({ color: 0x000000, width: 0.6 });
    }
    // Cannon barrel poking up from inside the crenellations, slightly tilted
    const barrelW = 5;
    const barrelH = 10;
    const barrelX = cx - 2;
    const barrelY = top - mh - barrelH + 2;
    this.body
      .rect(barrelX, barrelY, barrelW, barrelH)
      .fill(0x202028)
      .stroke({ color: 0x000000, width: 0.8 });
    // Barrel rim/highlight
    this.body.rect(barrelX, barrelY, barrelW, 1.5).fill(0x6a6a78);
    // Smoke wisp above the barrel (small ellipse)
    this.body.ellipse(barrelX + barrelW / 2, barrelY - 2, 3, 1.5).fill({ color: 0x707080, alpha: 0.5 });
  }

  private drawCaltropsTower(cx: number, cy: number, bw: number, bh: number, rh: number, bodyColor: number, roofColor: number): void {
    const top = cy - bh;
    // Wooden hut body
    this.body.rect(cx - bw / 2, top, bw, bh).fill(bodyColor).stroke({ color: 0x000000, width: 1 });
    // Doorway hint (small dark arch at the bottom). Top corners rounded by
    // overlaying a small ellipse cap on a flat-bottomed rect.
    this.body.rect(cx - 3, cy - 8, 6, 8).fill(0x201810);
    this.body.ellipse(cx, cy - 8, 3, 2.5).fill(0x201810);
    // Sloped roof (slightly off-center for a thatched-shed feel)
    this.body
      .moveTo(cx - bw / 2 - 2, top)
      .lineTo(cx + bw / 2 + 2, top)
      .lineTo(cx + bw / 2 + 2, top - 2)
      .lineTo(cx, top - rh)
      .lineTo(cx - bw / 2 - 2, top - 2)
      .closePath()
      .fill(roofColor)
      .stroke({ color: 0x000000, width: 1 });
    // Caltrop spikes on the roof: three tiny crosses
    const spikes: [number, number][] = [
      [cx - 6, top - rh * 0.55],
      [cx, top - rh * 0.75],
      [cx + 6, top - rh * 0.55]
    ];
    for (const [sx, sy] of spikes) {
      // 4-pointed spike (X shape)
      this.body.moveTo(sx - 2.5, sy).lineTo(sx + 2.5, sy).stroke({ color: 0x202028, width: 1 });
      this.body.moveTo(sx, sy - 2.5).lineTo(sx, sy + 2.5).stroke({ color: 0x202028, width: 1 });
      this.body.moveTo(sx - 1.8, sy - 1.8).lineTo(sx + 1.8, sy + 1.8).stroke({ color: 0x202028, width: 0.8 });
      this.body.moveTo(sx + 1.8, sy - 1.8).lineTo(sx - 1.8, sy + 1.8).stroke({ color: 0x202028, width: 0.8 });
      // Tiny center
      this.body.circle(sx, sy, 0.8).fill(0x404048);
    }
  }

  private drawGreekFireTower(cx: number, cy: number, bw: number, bh: number, rh: number, bodyColor: number, roofColor: number): void {
    const top = cy - bh;
    // Tall narrow stone body
    this.body.rect(cx - bw / 2, top, bw, bh).fill(bodyColor).stroke({ color: 0x000000, width: 1 });
    // Stone band around the middle
    const bandY = top + bh * 0.55;
    this.body.rect(cx - bw / 2 - 1, bandY, bw + 2, 2).fill(0x2a2438).stroke({ color: 0x000000, width: 0.4 });
    // Arrow slit
    this.body.rect(cx - 0.7, top + bh * 0.25, 1.4, 5).fill(0x101010);
    // Open brazier/flame-pot on top — wide bowl with flames
    const bowlY = top - 2;
    const bowlW = bw + 4;
    this.body
      .roundRect(cx - bowlW / 2, bowlY, bowlW, 4, 1)
      .fill(0x303038)
      .stroke({ color: 0x000000, width: 0.8 });
    // Flame: layered triangles, hottest yellow at base
    const flameH = rh + 2;
    // Outer red flame
    this.body
      .moveTo(cx - bowlW * 0.35, bowlY)
      .quadraticCurveTo(cx - 2, bowlY - flameH * 0.4, cx, bowlY - flameH)
      .quadraticCurveTo(cx + 2, bowlY - flameH * 0.4, cx + bowlW * 0.35, bowlY)
      .closePath()
      .fill(roofColor); // roofColor is the orange/red for greek fire
    // Inner yellow flame (smaller)
    this.body
      .moveTo(cx - bowlW * 0.18, bowlY)
      .quadraticCurveTo(cx - 1, bowlY - flameH * 0.4, cx, bowlY - flameH * 0.7)
      .quadraticCurveTo(cx + 1, bowlY - flameH * 0.4, cx + bowlW * 0.18, bowlY)
      .closePath()
      .fill(0xffd040);
    // Bright core at the very base of the flame
    this.body.ellipse(cx, bowlY - 1, bowlW * 0.18, 1.5).fill(0xfff080);
  }

  private drawTrebuchetTower(cx: number, cy: number, bw: number, bh: number, _rh: number, bodyColor: number, _roofColor: number): void {
    const top = cy - bh;
    // Wooden frame: 4 legs forming an A-frame, plus a small base box
    // Base box (the platform the trebuchet sits on)
    this.body.rect(cx - bw / 2, cy - 6, bw, 6).fill(bodyColor).stroke({ color: 0x000000, width: 1 });
    // Two angled support beams forming a triangle
    this.body
      .moveTo(cx - bw / 2 + 2, cy - 6)
      .lineTo(cx, top + 2)
      .lineTo(cx + bw / 2 - 2, cy - 6)
      .closePath()
      .fill(0x6a4818)
      .stroke({ color: 0x000000, width: 1 });
    // Cross-brace
    this.body
      .moveTo(cx - bw / 2 + 4, cy - 14)
      .lineTo(cx + bw / 2 - 4, cy - 14)
      .stroke({ color: 0x402810, width: 1.6 });
    // Pivot point at the top of the A-frame
    this.body.circle(cx, top + 2, 1.6).fill(0x202020).stroke({ color: 0x000000, width: 0.5 });
    // Long swing arm — extends up and to the right at an angle
    const armEndX = cx + bw / 2 + 6;
    const armEndY = top - 14;
    this.body
      .moveTo(cx - 3, top + 8)
      .lineTo(armEndX, armEndY)
      .stroke({ color: 0x2a1810, width: 2.5 });
    // Counterweight box hanging at the SHORT end (lower-left of arm)
    this.body
      .rect(cx - 8, top + 6, 6, 6)
      .fill(0x4a3818)
      .stroke({ color: 0x000000, width: 0.8 });
    // Sling/projectile pouch at the LONG end
    this.body
      .ellipse(armEndX + 1, armEndY + 1, 2.5, 1.5)
      .fill(0x6a4828)
      .stroke({ color: 0x000000, width: 0.5 });
  }

  private drawWatchtowerTower(cx: number, cy: number, bw: number, bh: number, _rh: number, bodyColor: number, roofColor: number): void {
    const top = cy - bh;
    // Tall narrow stone body
    this.body.rect(cx - bw / 2, top, bw, bh).fill(bodyColor).stroke({ color: 0x000000, width: 1 });
    // Stone bands at thirds (gives sense of height)
    const band1 = top + bh * 0.35;
    const band2 = top + bh * 0.65;
    this.body
      .rect(cx - bw / 2 - 1, band1, bw + 2, 1.6)
      .fill(0x2a2a2a);
    this.body
      .rect(cx - bw / 2 - 1, band2, bw + 2, 1.6)
      .fill(0x2a2a2a);
    // Three vertical arrow slits running up the body
    [top + 6, top + bh * 0.5 - 2, top + bh * 0.85 - 6].forEach(slitY => {
      this.body.rect(cx - 0.7, slitY, 1.4, 4).fill(0x101010);
    });
    // Wider top platform with merlons (the watchtower's signature)
    const platTop = top - 4;
    this.body
      .rect(cx - bw / 2 - 3, platTop, bw + 6, 4)
      .fill(roofColor)
      .stroke({ color: 0x000000, width: 1 });
    // 5 small merlons across the platform
    const mw = 3;
    const mh = 4;
    const merlonStart = cx - bw / 2 - 2;
    const merlonEnd = cx + bw / 2 + 2;
    const merlonStep = (merlonEnd - merlonStart - mw) / 4;
    for (let i = 0; i < 5; i++) {
      const mx = merlonStart + i * merlonStep;
      this.body
        .rect(mx, platTop - mh, mw, mh)
        .fill(roofColor)
        .stroke({ color: 0x000000, width: 0.5 });
    }
    // Small pennant on a pole rising from the center merlon
    const poleX = cx;
    const poleTop = platTop - mh - 8;
    this.body
      .moveTo(poleX, platTop - mh)
      .lineTo(poleX, poleTop)
      .stroke({ color: 0x2a1808, width: 0.8 });
    this.body
      .moveTo(poleX, poleTop)
      .lineTo(poleX + 4, poleTop + 2)
      .lineTo(poleX, poleTop + 4)
      .closePath()
      .fill(0x4a8030)
      .stroke({ color: 0x204010, width: 0.5 });
  }

  /**
   * Monastery: small chapel — squat cream-stone body, a tall arched window,
   * a steep gabled roof, and a cross at the apex. Different colour palette
   * from the gray stone towers so it reads as "holy place" not "fortress."
   */
  private drawMonasteryTower(cx: number, cy: number, bw: number, bh: number, rh: number, bodyColor: number, roofColor: number): void {
    const top = cy - bh;
    // Cream-stone body
    this.body.rect(cx - bw / 2, top, bw, bh).fill(bodyColor).stroke({ color: 0x000000, width: 1 });
    // Tall arched window in the centre — rectangle with a half-circle cap
    const winW = 6;
    const winH = bh * 0.55;
    const winX = cx - winW / 2;
    const winY = top + bh * 0.30;
    this.body.rect(winX, winY, winW, winH).fill(0x2a1810);
    this.body.ellipse(cx, winY, winW / 2, 3).fill(0x2a1810);
    // Window glow (warm)
    this.body.rect(winX + 1.5, winY + 2, winW - 3, winH * 0.5).fill({ color: 0xffd070, alpha: 0.55 });
    // Stone block lines (a small set, less busy than the regular stone mortar)
    const blockY1 = top + bh * 0.20;
    const blockY2 = top + bh * 0.85;
    this.body
      .moveTo(cx - bw / 2 + 1, blockY1)
      .lineTo(cx + bw / 2 - 1, blockY1)
      .stroke({ color: 0xa08858, width: 0.4, alpha: 0.7 });
    this.body
      .moveTo(cx - bw / 2 + 1, blockY2)
      .lineTo(cx + bw / 2 - 1, blockY2)
      .stroke({ color: 0xa08858, width: 0.4, alpha: 0.7 });
    // Steep gabled roof (two-slope) — overhang slightly past the body
    this.body
      .moveTo(cx - bw / 2 - 3, top)
      .lineTo(cx, top - rh)
      .lineTo(cx + bw / 2 + 3, top)
      .closePath()
      .fill(roofColor)
      .stroke({ color: 0x000000, width: 1 });
    // Roof ridge highlight (lighter band along the apex)
    this.body
      .moveTo(cx - bw / 2 - 2, top - 1)
      .lineTo(cx, top - rh + 2)
      .stroke({ color: 0xc06040, width: 0.8, alpha: 0.8 });
    // Cross at the apex of the roof
    const crossY = top - rh - 7;
    this.body.rect(cx - 0.7, crossY, 1.4, 7).fill(0xe0c060).stroke({ color: 0x6a4a20, width: 0.4 });
    this.body.rect(cx - 3, crossY + 2, 6, 1.4).fill(0xe0c060).stroke({ color: 0x6a4a20, width: 0.4 });
  }

  /** Horizontal mortar lines + a few vertical seams for stone-built towers. */
  private drawStoneMortar(cx: number, _cy: number, bw: number, bh: number): void {
    const top = TILE_H / 2 - bh;
    const stoneRows = Math.max(3, Math.floor(bh / 7));
    const rowH = bh / stoneRows;
    for (let i = 1; i < stoneRows; i++) {
      const y = top + i * rowH;
      this.body
        .moveTo(cx - bw / 2 + 1, y)
        .lineTo(cx + bw / 2 - 1, y)
        .stroke({ color: 0x000000, width: 0.4, alpha: 0.45 });
      // Two short vertical seams per row, staggered (brick-pattern)
      const stagger = i % 2 === 0 ? 0 : bw * 0.25;
      const seamY1 = y - rowH * 0.5;
      this.body
        .moveTo(cx - bw / 4 + stagger, seamY1)
        .lineTo(cx - bw / 4 + stagger, y)
        .stroke({ color: 0x000000, width: 0.3, alpha: 0.4 });
      this.body
        .moveTo(cx + bw / 4 - stagger, seamY1)
        .lineTo(cx + bw / 4 - stagger, y)
        .stroke({ color: 0x000000, width: 0.3, alpha: 0.4 });
    }
  }

  /** Vertical plank lines + a couple of cross-beams for wooden towers. */
  private drawWoodPlanks(cx: number, _cy: number, bw: number, bh: number): void {
    const top = TILE_H / 2 - bh;
    // 3 vertical plank seams across the body
    const planks = 3;
    for (let i = 1; i < planks; i++) {
      const px = cx - bw / 2 + (bw * i) / planks;
      this.body
        .moveTo(px, top + 1)
        .lineTo(px, TILE_H / 2 - 1)
        .stroke({ color: 0x000000, width: 0.4, alpha: 0.45 });
    }
    // Two horizontal cross-beams at top quarter and bottom quarter
    const beam1Y = top + bh * 0.25;
    const beam2Y = top + bh * 0.75;
    this.body
      .rect(cx - bw / 2 + 1, beam1Y, bw - 2, 1.2)
      .fill({ color: 0x3a2818, alpha: 0.7 });
    this.body
      .rect(cx - bw / 2 + 1, beam2Y, bw - 2, 1.2)
      .fill({ color: 0x3a2818, alpha: 0.7 });
  }

  /** Draw small pips above the tower indicating its level (1..5). */
  private drawLevelPips(): void {
    this.levelPips.clear();
    if (this.isWall()) return; // walls/palisades have no levels
    const cx = 0;
    const cy = TILE_H / 2 - this.bodyHeight - this.roofHeight - 8;
    const totalLevels = this.level + 1;
    const pipR = 2;
    const gap = 5;
    const totalW = totalLevels * (pipR * 2) + (totalLevels - 1) * gap;
    const startX = cx - totalW / 2 + pipR;
    for (let i = 0; i < totalLevels; i++) {
      const x = startX + i * (pipR * 2 + gap);
      this.levelPips.circle(x, cy, pipR).fill(0xffd870).stroke({ color: 0x000000, width: 0.5 });
    }
  }

  /** Draw scaffolding around the tower while it's being upgraded. */
  private drawScaffold(): void {
    this.scaffold.clear();
    if (!this.isUpgrading()) return;
    const cx = 0;
    const cy = TILE_H / 2;
    const bw = this.bodyWidth + 6;
    const bh = this.bodyHeight + this.roofHeight + 4;
    // Four diagonal wooden beams crossing the tower silhouette.
    const top = cy - bh;
    const left = cx - bw / 2;
    const right = cx + bw / 2;
    const bot = cy;
    this.scaffold.moveTo(left, top).lineTo(right, bot).stroke({ color: 0x8a6028, width: 1.5, alpha: 0.9 });
    this.scaffold.moveTo(right, top).lineTo(left, bot).stroke({ color: 0x8a6028, width: 1.5, alpha: 0.9 });
    // Two horizontal beams
    const midY1 = cy - bh * 0.66;
    const midY2 = cy - bh * 0.33;
    this.scaffold.moveTo(left, midY1).lineTo(right, midY1).stroke({ color: 0x8a6028, width: 1.5, alpha: 0.9 });
    this.scaffold.moveTo(left, midY2).lineTo(right, midY2).stroke({ color: 0x8a6028, width: 1.5, alpha: 0.9 });
    // A small tool (mallet?) head perched on top
    this.scaffold.rect(cx - 5, top - 4, 10, 3).fill(0x6a4818).stroke({ color: 0x000000, width: 0.5 });
  }

  /** Circular progress ring above the tower, filling clockwise as the upgrade completes. */
  private drawProgressRing(): void {
    this.progressRing.clear();
    if (!this.isUpgrading()) return;
    const cx = 0;
    const cy = TILE_H / 2 - this.bodyHeight - this.roofHeight - 16;
    const r = 7;
    // Background ring (dim)
    this.progressRing.circle(cx, cy, r).stroke({ color: 0x000000, width: 3, alpha: 0.6 });
    this.progressRing.circle(cx, cy, r).stroke({ color: 0x6a5028, width: 2, alpha: 0.9 });
    // Foreground arc — sweep clockwise from top by progress fraction.
    const progress = this.upgradeProgress();
    if (progress > 0) {
      const start = -Math.PI / 2; // top
      const end = start + Math.PI * 2 * progress;
      this.progressRing.arc(cx, cy, r, start, end);
      this.progressRing.stroke({ color: 0x88dd60, width: 3, alpha: 1 });
    }
  }

  /** Draw an HP bar above damaged walls. Hidden at full HP. */
  private drawHpBar(): void {
    this.hpBar.clear();
    if (!this.isWall()) return;
    if (this.hp >= this.maxHp) return; // hide at full HP
    const cx = 0;
    const cy = TILE_H / 2 - 28; // higher above the wall block
    const w = 28;
    const h = 5;
    const ratio = Math.max(0, this.hp / this.maxHp);
    // Background — black w/ light outline so it pops against any tile color.
    this.hpBar
      .rect(cx - w / 2, cy, w, h)
      .fill(0x000000)
      .stroke({ color: 0xf4d27a, width: 1 });
    // Fill (red→yellow→green by ratio)
    const fillColor = ratio > 0.6 ? 0x60e040 : ratio > 0.3 ? 0xffc040 : 0xff4040;
    this.hpBar
      .rect(cx - w / 2 + 1, cy + 1, (w - 2) * ratio, h - 2)
      .fill(fillColor);
  }

  /**
   * Heat added per shot, by tower id. Higher heat = fewer sustained shots.
   * Lightning and trebuchet have the highest heat (intentional nerf to stacking).
   */
  private heatPerShot(): number {
    switch (this.def.id) {
      case 'archer': return 18;
      case 'frost': return 22;
      case 'bombard': return 30;
      case 'lightning': return 35;
      case 'trebuchet': return 40;
      case 'watchtower': return 14;
      default: return 0;
    }
  }

  /** Draw a small heat bar above the tower. Hidden when heat is near zero. */
  private drawHeatBar(): void {
    this.heatBar.clear();
    if (this.isWall()) return;
    if (this.heat < this.maxHeat * 0.1) return; // hide at low heat
    const cx = 0;
    const cy = TILE_H / 2 - this.bodyHeight - this.roofHeight - 16;
    const w = 22;
    const h = 3;
    const ratio = Math.max(0, Math.min(1, this.heat / this.maxHeat));
    // Background
    this.heatBar
      .rect(cx - w / 2, cy, w, h)
      .fill(0x201010)
      .stroke({ color: 0x000000, width: 0.5 });
    // Fill: yellow→orange→red as heat rises; bright red while overheated
    const fillColor = this.overheated ? 0xff4020 : ratio > 0.7 ? 0xe06020 : ratio > 0.4 ? 0xe0a040 : 0xc0c040;
    this.heatBar
      .rect(cx - w / 2, cy, w * ratio, h)
      .fill(fillColor);
  }

  /** Where projectiles spawn (top of the tower, in screen coords). */
  getMuzzlePosition(): { x: number; y: number } {
    const tile = gridToScreen(this.col, this.row);
    const cy = TILE_H / 2 - this.bodyHeight - this.roofHeight;
    return { x: tile.x, y: tile.y + cy };
  }

  update(
    dt: number,
    enemies: Enemy[],
    projectiles: Projectile[],
    projectileLayer: Container,
    effectsLayer: Container
  ): void {
    // Tick wall hit-flash regardless of tower type (walls use this; non-walls
    // never set the timer so this is a no-op for them).
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= dt;
      if (this.hitFlashTimer <= 0) {
        this.hitFlashTimer = 0;
        this.body.tint = 0xffffff;
      }
    }

    // Walls/palisades have no attack — skip the whole targeting/firing pipeline.
    if (this.isWall()) return;

    // Monastery: Faith aura is computed externally in Game.tickFaithAuras().
    // The tower itself has no projectile, so we still tick upgrades but skip
    // the targeting/firing pipeline entirely.
    if (this.def.id === 'monastery') {
      if (this.isUpgrading()) this.tickUpgrade(dt);
      return;
    }

    // Tick the upgrade timer, if one is in progress. Tower keeps firing during
    // construction at its CURRENT level — that's the design tension: you commit
    // now to better stats later, but you're vulnerable while the masons work.
    if (this.isUpgrading()) {
      this.tickUpgrade(dt);
    }

    // Heat always cools, even mid-fire. Hysteresis: overheated state clears
    // only when heat drops below 50% of max, preventing rapid flapping.
    const COOL_RATE = 25; // heat units per second
    if (this.heat > 0) {
      this.heat = Math.max(0, this.heat - COOL_RATE * dt);
      this.drawHeatBar();
    }
    if (this.overheated && this.heat < this.maxHeat * 0.5) {
      this.overheated = false;
    }

    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    if (this.overheated) return; // can't fire while overheated

    const target = this.findTarget(enemies);
    if (!target) return;

    const s = this.stats();
    if (this.def.projectileSpeed === 0 && s.chainTargets !== undefined) {
      this.fireChainLightning(target, enemies, effectsLayer);
    } else {
      const proj = new Projectile(this, target);
      projectiles.push(proj);
      projectileLayer.addChild(proj.container);
    }
    // Play shot sound, throttled per-type so multiple towers firing at once
    // don't drown each other out.
    switch (this.def.id) {
      case 'archer':
      case 'watchtower': sfxBowShot(); break;
      case 'bombard':
      case 'trebuchet': sfxHeavyShot(); break;
      case 'frost': sfxCaltropsShot(); break;
      case 'lightning': sfxGreekFire(); break;
    }
    this.cooldown = 1 / s.fireRate;

    // Add heat from this shot. If we hit max, enter overheated state.
    this.heat = Math.min(this.maxHeat, this.heat + this.heatPerShot());
    if (this.heat >= this.maxHeat) this.overheated = true;
    this.drawHeatBar();
  }

  private findTarget(enemies: Enemy[]): Enemy | null {
    const s = this.stats();
    const isWatchtower = this.def.id === 'watchtower';
    let best: Enemy | null = null;
    let bestDist = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (e.def.layer === 'ground' && !this.def.targetsGround) continue;
      if (e.def.layer === 'armored' && !this.def.targetsArmored) continue;
      // Watchtower can only fire along the four cardinal directions:
      // target must share the tower's row OR column (within ½ tile tolerance).
      if (isWatchtower) {
        const sameRow = Math.abs(e.row - this.row) <= 0.5;
        const sameCol = Math.abs(e.col - this.col) <= 0.5;
        if (!sameRow && !sameCol) continue;
      }
      const d = e.distanceTo(this.col, this.row);
      if (d <= s.range && d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  private fireChainLightning(primary: Enemy, allEnemies: Enemy[], effectsLayer: Container): void {
    const s = this.stats();
    const visited = new Set<Enemy>([primary]);
    const segments: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];

    const muzzle = this.getMuzzlePosition();
    let prevPos = muzzle;
    let prev: Enemy = primary;
    let dmg = s.damage;
    primary.takeDamage(dmg);
    {
      const tPos = gridToScreen(primary.col, primary.row);
      const targetPoint = { x: tPos.x, y: tPos.y + 8 };
      segments.push({ from: prevPos, to: targetPoint });
      prevPos = targetPoint;
    }

    const jumps = s.chainTargets ?? 0;
    const jumpRange = s.chainRange ?? 2;
    const falloff = s.chainDamageFalloff ?? 0.7;

    for (let i = 0; i < jumps; i++) {
      let next: Enemy | null = null;
      let nextDist = Infinity;
      for (const e of allEnemies) {
        if (!e.alive || visited.has(e)) continue;
        if (e.def.layer === 'ground' && !this.def.targetsGround) continue;
        if (e.def.layer === 'armored' && !this.def.targetsArmored) continue;
        const d = e.distanceTo(prev.col, prev.row);
        if (d <= jumpRange && d < nextDist) {
          nextDist = d;
          next = e;
        }
      }
      if (!next) break;
      visited.add(next);
      dmg *= falloff;
      next.takeDamage(dmg);
      const tPos = gridToScreen(next.col, next.row);
      const targetPoint = { x: tPos.x, y: tPos.y + 8 };
      segments.push({ from: prevPos, to: targetPoint });
      prevPos = targetPoint;
      prev = next;
    }

    const beam = new Graphics();
    for (const seg of segments) {
      this.drawLightning(beam, seg.from.x, seg.from.y, seg.to.x, seg.to.y);
    }
    beam.zIndex = 999999;
    effectsLayer.addChild(beam);
    let life = 0.18;
    let lastTs = performance.now();
    const step = (ts: number) => {
      const dtSec = (ts - lastTs) / 1000;
      lastTs = ts;
      life -= dtSec;
      if (life <= 0) { beam.destroy(); return; }
      beam.alpha = life / 0.18;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private drawLightning(g: Graphics, x1: number, y1: number, x2: number, y2: number): void {
    // Despite the legacy name, this now draws a flowing fire arc (Greek Fire).
    // Less jagged than electricity, with warm flame colors.
    const segments = 5;
    const dx = (x2 - x1) / segments;
    const dy = (y2 - y1) / segments;
    let px = x1, py = y1;
    g.moveTo(px, py);
    for (let i = 1; i < segments; i++) {
      const jitter = (Math.random() - 0.5) * 8;
      const nx = x1 + dx * i;
      const ny = y1 + dy * i;
      const len = Math.hypot(dx, dy) || 1;
      const ox = (-dy / len) * jitter;
      const oy = (dx / len) * jitter;
      g.lineTo(nx + ox, ny + oy);
      px = nx + ox; py = ny + oy;
    }
    g.lineTo(x2, y2);
    // Outer glow: deep orange
    g.stroke({ color: 0xff6020, width: 5, alpha: 0.55 });
    // Mid: bright orange/yellow
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke({ color: 0xffb040, width: 3, alpha: 0.85 });
    // Core: yellow-white hot
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke({ color: 0xfff0c0, width: 1, alpha: 0.95 });
  }

  private drawRange(): void {
    const s = this.stats();
    this.rangeIndicator.clear();
    if (this.def.id === 'monastery') {
      // Faith aura: low-alpha cream ellipse with a soft gold glow inside.
      // Always visible (set in constructor) so players can see where Faith
      // is active. Drawn with a slightly heavier outline so it reads against
      // grass without the user having to select it.
      const w = s.range * TILE_W;
      const h = s.range * TILE_H;
      this.rangeIndicator
        .ellipse(0, TILE_H / 2, w, h)
        .fill({ color: 0xffd070, alpha: 0.10 })
        .stroke({ color: 0xffe098, width: 1.5, alpha: 0.55 });
      // Slightly smaller inner ring for definition
      this.rangeIndicator
        .ellipse(0, TILE_H / 2, w * 0.55, h * 0.55)
        .stroke({ color: 0xffd070, width: 0.8, alpha: 0.35 });
      return;
    }
    if (this.def.id === 'watchtower') {
      // Cross-shaped indicator: two narrow rectangles along row and column,
      // showing exactly which tiles can be targeted.
      const len = s.range;
      // Row band (horizontal in screen space is along col axis)
      // In iso space, "row constant" tiles trace one diagonal direction; "col constant" the other.
      // To draw straightforwardly: each cardinal direction (col±1, row±1) is one direction in iso.
      // Render four narrow strips from tower center along each direction.
      const cy = TILE_H / 2;
      const drawStrip = (dCol: number, dRow: number) => {
        // Endpoint tile in screen-local coords (relative to tower center).
        const ex = (dCol - dRow) * (TILE_W / 2) * len;
        const ey = (dCol + dRow) * (TILE_H / 2) * len;
        this.rangeIndicator
          .moveTo(0, cy)
          .lineTo(ex, cy + ey)
          .stroke({ color: 0xf4d27a, width: 4, alpha: 0.55 });
      };
      drawStrip(1, 0);
      drawStrip(-1, 0);
      drawStrip(0, 1);
      drawStrip(0, -1);
      return;
    }
    const w = s.range * TILE_W;
    const h = s.range * TILE_H;
    this.rangeIndicator
      .ellipse(0, TILE_H / 2, w, h)
      .stroke({ color: 0xf4d27a, width: 2, alpha: 0.8 })
      .fill({ color: 0xf4d27a, alpha: 0.1 });
  }

  showRange(visible: boolean): void {
    // Monastery aura is always visible — its showRange is a no-op so the
    // global "hide all ranges" loop in Game.ts doesn't blank it.
    if (this.def.id === 'monastery') {
      this.rangeIndicator.visible = true;
      return;
    }
    this.rangeIndicator.visible = visible;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

function clampColor(c: number): number {
  const r = Math.min(255, (c >> 16) & 0xff);
  const g = Math.min(255, (c >> 8) & 0xff);
  const b = Math.min(255, c & 0xff);
  return (r << 16) | (g << 8) | b;
}
