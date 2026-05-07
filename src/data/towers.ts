// Tower defs with 5 levels each. Each level's cost is a partial Resources map.

import { Resources, add, zero } from './resources';

export interface TowerLevel {
  cost: Partial<Resources>;
  damage: number;
  range: number;
  fireRate: number;
  splashRadius?: number;
  slowFactor?: number;
  slowDuration?: number;
  chainTargets?: number;
  chainRange?: number;
  chainDamageFalloff?: number;
  /**
   * If set, this tower projects a Faith aura. Enemies within `range` tiles
   * have their incoming damage multiplied by this value (e.g. 1.4 = +40%).
   * Faith towers do not fire projectiles; `damage` and `fireRate` are unused.
   */
  faithMultiplier?: number;
}

export interface TowerDef {
  id: string;
  name: string;
  icon: string;
  description: string;

  color: number;
  bodyColor: number;
  roofColor: number;

  targetsGround: boolean;
  targetsArmored: boolean;

  projectileSpeed: number;
  levels: TowerLevel[];

  /** Codex hints (used by the in-game reference screen). */
  strongAgainst: string;
  weakAgainst: string;
}

export const MAX_LEVEL = 4;
export const SELL_REFUND = 0.7;

export const TOWERS: Record<string, TowerDef> = {
  archer: {
    id: 'archer',
    name: 'Archer Tower',
    icon: '🏹',
    description: 'A wooden donjon manned by levy archers. Cheap, common, and effective against any unarmoured target.',
    color: 0x8b6f3a, bodyColor: 0x6a4828, roofColor: 0x8a3020,
    targetsGround: true, targetsArmored: false,
    projectileSpeed: 400,
    strongAgainst: 'Militia, Scout Cavalry. High fire rate excels vs lightly-armored single targets.',
    weakAgainst: 'Paladins (armor reduces damage), Mangonels (cannot pierce armor), large swarms.',
    levels: [
      { cost: { wood: 40, food: 20 }, damage: 8,  range: 3.5, fireRate: 1.5 },
      { cost: { wood: 50, food: 25 }, damage: 14, range: 3.7, fireRate: 1.7 },
      { cost: { wood: 80, food: 40, gold: 20 }, damage: 22, range: 4.0, fireRate: 1.9 },
      { cost: { wood: 130, food: 60, gold: 40 }, damage: 36, range: 4.3, fireRate: 2.1 },
      { cost: { wood: 200, food: 100, gold: 80 }, damage: 60, range: 4.7, fireRate: 2.3 }
    ]
  },

  bombard: {
    id: 'bombard',
    name: 'Bombard',
    icon: '💣',
    description: 'A stone cannon mounted within the parapet. Slow to reload, but a single shot levels a knot of foot soldiers. Stone-hungry.',
    color: 0x554840, bodyColor: 0x2a2420, roofColor: 0x4a4a4a,
    targetsGround: true, targetsArmored: false,
    projectileSpeed: 280,
    strongAgainst: 'Skirmisher swarms, packed groups, lined-up Militia. Splash chains kills.',
    weakAgainst: 'Mangonels (no armor pierce), single fast units (slow fire rate).',
    levels: [
      { cost: { stone: 70, wood: 40 }, damage: 18, range: 3.0, fireRate: 0.6, splashRadius: 1.0 },
      { cost: { stone: 90, wood: 50 }, damage: 30, range: 3.1, fireRate: 0.65, splashRadius: 1.1 },
      { cost: { stone: 140, wood: 70, gold: 30 }, damage: 50, range: 3.3, fireRate: 0.7,  splashRadius: 1.25 },
      { cost: { stone: 220, wood: 110, gold: 60 }, damage: 80, range: 3.5, fireRate: 0.75, splashRadius: 1.45 },
      { cost: { stone: 350, wood: 180, gold: 120 }, damage: 130, range: 3.8, fireRate: 0.85, splashRadius: 1.7 }
    ]
  },

  frost: {
    id: 'frost',
    name: 'Caltrops Tower',
    icon: '🪤',
    description: 'A small wooden post that scatters iron caltrops across the ground. Damage is negligible; the slowing is the point. Two together stack devastatingly.',
    color: 0x8a7848, bodyColor: 0x6a5830, roofColor: 0xa89868,
    targetsGround: true, targetsArmored: false,
    projectileSpeed: 350,
    strongAgainst: 'Force multiplier — slows everything ground-based so allied towers fire more before enemies pass. Multiple Caltrops Towers stack their slow.',
    weakAgainst: 'Mangonels (no armor pierce), Paladins (low damage barely scratches them).',
    levels: [
      { cost: { gold: 50, wood: 30 },  damage: 3,  range: 3.0, fireRate: 1.0, slowFactor: 0.5,  slowDuration: 2.0 },
      { cost: { gold: 60, wood: 40 },  damage: 5,  range: 3.2, fireRate: 1.1, slowFactor: 0.45, slowDuration: 2.2 },
      { cost: { gold: 100, wood: 60 }, damage: 8,  range: 3.5, fireRate: 1.3, slowFactor: 0.4,  slowDuration: 2.5 },
      { cost: { gold: 160, wood: 100 },damage: 14, range: 3.8, fireRate: 1.5, slowFactor: 0.32, slowDuration: 2.8 },
      { cost: { gold: 250, wood: 160 },damage: 22, range: 4.2, fireRate: 1.7, slowFactor: 0.25, slowDuration: 3.2 }
    ]
  },

  lightning: {
    id: 'lightning',
    name: 'Greek Fire',
    icon: '🔥',
    description: 'The infamous Byzantine weapon, unleashed from a covered brazier. Sticky liquid fire splashes from one target to the next, seeping through the joints of plate armour. Costly to build, costly to fight.',
    color: 0x8a3018, bodyColor: 0x4a1808, roofColor: 0xe0c050,
    targetsGround: true, targetsArmored: true,
    projectileSpeed: 0,
    strongAgainst: 'Mangonels (one of only two anti-armor towers), grouped enemies (fire spreads), skirmisher swarms.',
    weakAgainst: 'Lone Paladins (spread falls off; armor still partial).',
    levels: [
      { cost: { gold: 90, stone: 40 },  damage: 14, range: 3.5, fireRate: 0.9,  chainTargets: 2, chainRange: 2.0, chainDamageFalloff: 0.65 },
      { cost: { gold: 110, stone: 50 }, damage: 22, range: 3.7, fireRate: 1.0,  chainTargets: 3, chainRange: 2.1, chainDamageFalloff: 0.7  },
      { cost: { gold: 170, stone: 70 }, damage: 35, range: 4.0, fireRate: 1.1,  chainTargets: 4, chainRange: 2.3, chainDamageFalloff: 0.72 },
      { cost: { gold: 270, stone: 110 },damage: 55, range: 4.4, fireRate: 1.25, chainTargets: 5, chainRange: 2.5, chainDamageFalloff: 0.75 },
      { cost: { gold: 420, stone: 180 },damage: 90, range: 4.8, fireRate: 1.4,  chainTargets: 6, chainRange: 2.8, chainDamageFalloff: 0.78 }
    ]
  },

  monastery: {
    id: 'monastery',
    name: 'Monastery',
    icon: '✝️',
    description: 'A small chapel from which monks chant the foe weak. Enemies inside its bounds take greater damage from every weapon — a force multiplier, not a killer in its own right.',
    color: 0xc8a868, bodyColor: 0xe8d8a8, roofColor: 0x8a4030,
    targetsGround: false, targetsArmored: false,
    projectileSpeed: 0,
    strongAgainst: 'Anywhere multiple towers already concentrate fire — chokepoints, slow zones, the inside of a tight maze loop.',
    weakAgainst: 'Open ground with few enemies. The Faith aura amplifies what you already have; it adds nothing where there is nothing to amplify.',
    levels: [
      { cost: { gold: 80,  wood: 30 },  damage: 0, range: 2.5, fireRate: 0, faithMultiplier: 1.20 },
      { cost: { gold: 110, wood: 40 },  damage: 0, range: 2.7, fireRate: 0, faithMultiplier: 1.25 },
      { cost: { gold: 160, wood: 60 },  damage: 0, range: 3.0, fireRate: 0, faithMultiplier: 1.30 },
      { cost: { gold: 240, wood: 90 },  damage: 0, range: 3.3, fireRate: 0, faithMultiplier: 1.35 },
      { cost: { gold: 380, wood: 150 }, damage: 0, range: 3.7, fireRate: 0, faithMultiplier: 1.40 }
    ]
  },

  trebuchet: {
    id: 'trebuchet',
    name: 'Trebuchet',
    icon: '🎯',
    description: 'An immense counterweight engine flinging stone across the battlefield. Slow to ready, but each shot reaches the far walls. The only weapon save Greek Fire that pierces siege armour.',
    color: 0x6a5028, bodyColor: 0x3a2810, roofColor: 0x806038,
    targetsGround: true, targetsArmored: true,
    projectileSpeed: 240,
    strongAgainst: 'Paladins (huge damage punches through armor), Mangonels, anything tough at long range.',
    weakAgainst: 'Fast swarms (slow fire rate, only one target per shot).',
    levels: [
      { cost: { stone: 100, wood: 60 },  damage: 30,  range: 5.5, fireRate: 0.4 },
      { cost: { stone: 130, wood: 75 },  damage: 50,  range: 5.8, fireRate: 0.45 },
      { cost: { stone: 200, wood: 110, gold: 40 }, damage: 80, range: 6.2, fireRate: 0.5 },
      { cost: { stone: 320, wood: 180, gold: 80 }, damage: 130, range: 6.7, fireRate: 0.55 },
      { cost: { stone: 500, wood: 280, gold: 160 }, damage: 220, range: 7.3, fireRate: 0.6 }
    ]
  },

  watchtower: {
    id: 'watchtower',
    name: 'Watchtower',
    icon: '🗼',
    description: 'A tall stone watchtower. Its archers see far and shoot true — but only along the cardinal lines from their post, never around corners. Brilliant on long straight approaches.',
    color: 0x6a5838, bodyColor: 0x8a7048, roofColor: 0x4a3820,
    targetsGround: true, targetsArmored: false,
    projectileSpeed: 380,
    strongAgainst: 'Long straight maze corridors — pierces a whole line of enemies one at a time.',
    weakAgainst: 'Diagonal paths, units to the side of its line of sight, mangonels (no armor pierce).',
    levels: [
      { cost: { wood: 80, stone: 30 },  damage: 18, range: 7.0, fireRate: 1.6 },
      { cost: { wood: 100, stone: 40 }, damage: 30, range: 7.5, fireRate: 1.8 },
      { cost: { wood: 160, stone: 70, gold: 30 }, damage: 50, range: 8.0, fireRate: 2.0 },
      { cost: { wood: 240, stone: 120, gold: 60 }, damage: 80, range: 8.5, fireRate: 2.2 },
      { cost: { wood: 380, stone: 200, gold: 120 }, damage: 140, range: 9.0, fireRate: 2.4 }
    ]
  },

  wall: {
    id: 'wall',
    name: 'Stone Wall',
    icon: '🧱',
    description: 'Cut-stone curtain wall. Sappers can dig through given time — but the time taken is time enough to kill them.',
    color: 0x707070, bodyColor: 0x606060, roofColor: 0x505050,
    targetsGround: false, targetsArmored: false,
    projectileSpeed: 0,
    strongAgainst: 'Use to lengthen enemy paths and force them past your real towers. Sappers struggle to break it.',
    weakAgainst: 'Mangonels and Paladins still walk through your maze; walls slow but cannot stop.',
    levels: [
      { cost: { stone: 15 }, damage: 0, range: 0, fireRate: 0 }
    ]
  },

  palisade: {
    id: 'palisade',
    name: 'Wood Palisade',
    icon: '🪵',
    description: 'A line of sharpened logs driven into the earth. Cheap, ubiquitous, and useful for shaping the path. It will not hold long against a determined Sapper.',
    color: 0x8a6028, bodyColor: 0x6a4818, roofColor: 0x4a3010,
    targetsGround: false, targetsArmored: false,
    projectileSpeed: 0,
    strongAgainst: 'Iterate the maze freely. Cheap to throw down and replace.',
    weakAgainst: 'Sappers destroy palisades fast. Stone walls when you need a hard line.',
    levels: [
      { cost: { wood: 5 }, damage: 0, range: 0, fireRate: 0 }
    ]
  }
};

export const TOWER_LIST: TowerDef[] = Object.values(TOWERS);

/** Total resources spent on a tower built at level 0 and upgraded to `level`. */
export function totalSpent(def: TowerDef, level: number): Resources {
  let sum: Resources = zero();
  for (let i = 0; i <= level && i < def.levels.length; i++) {
    sum = add(sum, def.levels[i].cost);
  }
  return sum;
}

export function getLevelStats(def: TowerDef, level: number): TowerLevel {
  const clamped = Math.max(0, Math.min(level, def.levels.length - 1));
  return def.levels[clamped];
}
