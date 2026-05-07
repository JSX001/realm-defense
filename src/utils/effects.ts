// Short-lived visual effects: resource ticker text and enemy death puffs.
// Each effect owns a Pixi container, exposes update(dt) returning false when
// done. Game's update loop ticks all of them and removes the dead ones.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { ResourceKey, Resources } from '../data/resources';

/** Common interface every effect implements. */
export interface Effect {
  container: Container;
  /** Tick the effect. Return true if still alive, false if it should be removed. */
  update(dt: number): boolean;
  destroy(): void;
}

/** Per-resource label colors for the ticker. Tuned for legibility on grass. */
const RESOURCE_COLORS: Record<ResourceKey, number> = {
  wood:  0xc89860,
  gold:  0xffd860,
  stone: 0xc0c0c0,
  food:  0x88e060
};
const RESOURCE_ICONS: Record<ResourceKey, string> = {
  wood: '🪵', gold: '🪙', stone: '🪨', food: '🌾'
};

/**
 * Floating "+5 🪵" text that drifts upward and fades over a short duration.
 * Used when a tower-killed enemy drops resources.
 */
export class ResourceTicker implements Effect {
  public container: Container;
  private text: Text;
  private elapsed = 0;
  private readonly LIFETIME = 0.9; // seconds
  private readonly RISE_PX = 28;   // total Y drift over lifetime
  private startY: number;

  constructor(x: number, y: number, reward: Partial<Resources>) {
    // If multiple resources, show the largest one only (single-line ticker
    // looks cleaner and avoids clutter). Most enemies drop 1 resource anyway.
    let label = '';
    let color = 0xffffff;
    let bestAmount = 0;
    for (const k of Object.keys(reward) as ResourceKey[]) {
      const amt = reward[k] ?? 0;
      if (amt > bestAmount) {
        bestAmount = amt;
        label = `+${amt} ${RESOURCE_ICONS[k]}`;
        color = RESOURCE_COLORS[k];
      }
    }
    this.container = new Container();
    this.container.x = x;
    this.container.y = y;
    this.startY = y;
    // High zIndex so floating text always draws above units.
    this.container.zIndex = 999000;

    const style = new TextStyle({
      fontFamily: 'Trajan Pro, Times New Roman, serif',
      fontSize: 14,
      fontWeight: 'bold',
      fill: color,
      stroke: { color: 0x000000, width: 3 }
    });
    this.text = new Text({ text: label, style });
    this.text.anchor.set(0.5, 0.5);
    this.container.addChild(this.text);
  }

  update(dt: number): boolean {
    this.elapsed += dt;
    if (this.elapsed >= this.LIFETIME) return false;
    const t = this.elapsed / this.LIFETIME;
    // Ease-out for the rise (fast start, slow end).
    const easeT = 1 - (1 - t) * (1 - t);
    this.container.y = this.startY - this.RISE_PX * easeT;
    // Fade — stay full for the first 60%, then linearly to 0.
    this.container.alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    return true;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/**
 * Quick puff at an enemy's death position: 5 small dots radiating outward,
 * scaling up and fading. Ground vs armored both use the same shape but with
 * slightly different colors.
 */
export class DeathPuff implements Effect {
  public container: Container;
  private g: Graphics;
  private elapsed = 0;
  private readonly LIFETIME = 0.30;
  private particles: { angle: number; speed: number; size: number }[] = [];
  private color: number;

  constructor(x: number, y: number, color: number = 0xddccaa) {
    this.container = new Container();
    this.container.x = x;
    this.container.y = y;
    this.container.zIndex = 998000;
    this.color = color;
    this.g = new Graphics();
    this.container.addChild(this.g);

    // Generate 5 particles with random angles and speeds.
    const count = 5;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 22 + Math.random() * 14; // px/sec radial speed
      const size = 2 + Math.random() * 1.5;
      this.particles.push({ angle, speed, size });
    }
  }

  update(dt: number): boolean {
    this.elapsed += dt;
    if (this.elapsed >= this.LIFETIME) return false;
    const t = this.elapsed / this.LIFETIME;
    const alpha = 1 - t;
    this.g.clear();
    for (const p of this.particles) {
      const dist = p.speed * this.elapsed;
      const px = Math.cos(p.angle) * dist;
      const py = Math.sin(p.angle) * dist;
      this.g
        .circle(px, py, p.size)
        .fill({ color: this.color, alpha })
        .stroke({ color: 0x000000, width: 0.5, alpha: alpha * 0.5 });
    }
    return true;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
