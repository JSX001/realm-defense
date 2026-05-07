import { Container, Graphics } from 'pixi.js';
import { Enemy } from './Enemy';
import { Tower } from './Tower';
import { TowerDef, TowerLevel } from '../data/towers';
import { gridToScreen, isoDepth } from '../utils/isometric';

export class Projectile {
  public container: Container;
  public alive = true;

  private target: Enemy;
  private def: TowerDef;
  private stats: TowerLevel; // snapshot at fire time
  private x: number;
  private y: number;

  private enemiesRef: Enemy[] = [];

  constructor(tower: Tower, target: Enemy) {
    this.target = target;
    this.def = tower.def;
    this.stats = tower.stats();

    const muzzle = tower.getMuzzlePosition();
    this.x = muzzle.x;
    this.y = muzzle.y;

    this.container = new Container();
    const g = new Graphics();
    let color = 0xfff0a0;
    let radius = 3;
    if (this.def.id === 'bombard') { color = 0x222222; radius = 5; }
    else if (this.def.id === 'frost') { color = 0xaaddff; radius = 4; }
    else if (this.def.id === 'trebuchet') { color = 0x404040; radius = 6; }
    g.circle(0, 0, radius).fill(color).stroke({ color: 0x000000, width: 1 });
    this.container.addChild(g);
    this.container.x = this.x;
    this.container.y = this.y;
    this.container.zIndex = isoDepth(tower.col, tower.row) + 1;
  }

  setEnemiesRef(enemies: Enemy[]): void {
    this.enemiesRef = enemies;
  }

  update(dt: number): void {
    if (!this.alive) return;
    if (!this.target.alive) {
      this.alive = false;
      return;
    }
    const tPos = gridToScreen(this.target.col, this.target.row);
    const aimY = tPos.y + 8;
    const tx = tPos.x;
    const dx = tx - this.x;
    const dy = aimY - this.y;
    const dist = Math.hypot(dx, dy);
    const step = this.def.projectileSpeed * dt;
    if (dist <= step) {
      this.impact();
      this.alive = false;
    } else {
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
      this.container.x = this.x;
      this.container.y = this.y;
    }
  }

  private impact(): void {
    const s = this.stats;
    if (s.splashRadius && s.splashRadius > 0) {
      for (const e of this.enemiesRef) {
        if (!e.alive) continue;
        if (e.def.layer === 'ground' && !this.def.targetsGround) continue;
        if (e.def.layer === 'armored' && !this.def.targetsArmored) continue;
        const d = e.distanceTo(this.target.col, this.target.row);
        if (d <= s.splashRadius) {
          e.takeDamage(s.damage);
          if (s.slowFactor !== undefined && s.slowDuration !== undefined) {
            e.applySlow(s.slowFactor, s.slowDuration);
          }
        }
      }
    } else {
      this.target.takeDamage(s.damage);
      if (s.slowFactor !== undefined && s.slowDuration !== undefined) {
        this.target.applySlow(s.slowFactor, s.slowDuration);
      }
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
