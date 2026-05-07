// AoE2-flavored enemy roster.
//
// IMPORTANT: the v0.7 'air' layer is renamed to 'armored' here. Mechanically it
// behaves the same way: only towers with `targetsArmored: true` (Trebuchet,
// Lightning) can damage these units. Thematically this represents heavy siege
// armor on Mangonels rather than flight.

import { Resources, ResourceKey } from './resources';

export type EnemyLayer = 'ground' | 'armored';

export interface StealSpec {
  resource: ResourceKey;
  base: number;
  percent: number;
}

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  speed: number;
  reward: Partial<Resources>;
  steal: StealSpec;
  color: number;
  outline: number;
  size: number;
  layer: EnemyLayer;
  armor?: number;
  counterTip: string;
  description: string;
}

// No more "universal kill bounty" — villagers replace that role for income.
export const UNIVERSAL_KILL_BOUNTY: Partial<Resources> = {};

export const ENEMIES: Record<string, EnemyDef> = {
  militia: {
    id: 'militia', name: 'Militia',
    hp: 26, speed: 1.2,
    reward: { food: 6 },
    steal: { resource: 'food', base: 18, percent: 0.05 },
    color: 0xa05030, outline: 0x000000, size: 8, layer: 'ground',
    description: 'Peasant levy roused from the fields, armed with whatever the lord could muster. Untrained, lightly equipped, and present in every assault.',
    counterTip: 'Any tower handles them. Archers are the most cost-efficient answer.'
  },
  scoutCavalry: {
    id: 'scoutCavalry', name: 'Scout Cavalry',
    hp: 19, speed: 2.4,
    reward: { gold: 7 },
    steal: { resource: 'gold', base: 22, percent: 0.06 },
    color: 0xc0a060, outline: 0x000000, size: 7, layer: 'ground',
    description: 'Mounted skirmishers, lightly armoured for speed. They probe your defences and exploit the slightest gap in your lines.',
    counterTip: 'Caltrops Towers slow them; Archers shred their thin barding. Do not let a single one reach the village.'
  },
  paladin: {
    id: 'paladin', name: 'Paladin',
    hp: 94, speed: 0.8,
    reward: { stone: 14 },
    steal: { resource: 'stone', base: 50, percent: 0.10 },
    color: 0xb0b0c0, outline: 0x000000, size: 11, layer: 'ground', armor: 3,
    description: 'The realm\'s enemies field their own mounted nobility. Encased in plate, a Paladin\'s charge can crush a maze. They do not break — they are killed.',
    counterTip: 'Trebuchets one-shot them at high level. Bombards work in numbers. Caltrops alone cannot stop them.'
  },
  skirmisher: {
    id: 'skirmisher', name: 'Skirmisher',
    hp: 12, speed: 1.6,
    reward: { wood: 5 },
    steal: { resource: 'wood', base: 12, percent: 0.04 },
    color: 0x60a040, outline: 0x000000, size: 6, layer: 'ground',
    description: 'Archers in close-fitted hoods, lightly equipped for skirmishing. Each one alone is little threat — the danger is the swarm. They die quickly, but quickly is not always quickly enough.',
    counterTip: 'Bombards splash them down. Greek Fire chains between them. A line of single-target Archers will be overrun.'
  },
  mangonel: {
    id: 'mangonel', name: 'Mangonel',
    hp: 51, speed: 1.6,
    reward: { gold: 12 },
    steal: { resource: 'gold', base: 38, percent: 0.08 },
    color: 0x8030c0, outline: 0x301050, size: 10, layer: 'armored',
    description: 'A wheeled stone-thrower, plated against arrow and stone alike. Most weapons glance from its frame — only siege-grade fire pierces it.',
    counterTip: 'Only Greek Fire and Trebuchets pierce its armour. Build at least one before wave four.'
  },
  sapper: {
    id: 'sapper', name: 'Sapper',
    hp: 30, speed: 0.7,
    reward: { wood: 8 },
    steal: { resource: 'wood', base: 0, percent: 0 }, // sappers don't reach the village often
    color: 0x705038, outline: 0x000000, size: 8, layer: 'ground',
    description: 'Demolition engineer with a pickaxe. Where a Paladin would charge a wall, a Sapper sets to work on it — patiently, and methodically. Fragile in the open, ruinous given time.',
    counterTip: 'Cover your wall sections with overlapping fire. Stone walls slow Sappers but do not stop them — the goal is to kill the Sapper, not save the wall.'
  }
};

/**
 * Compute the actual steal amount given a current pool value.
 * Returns an integer (rounded up so the % component bites even at low pools).
 */
export function computeStealAmount(spec: StealSpec, currentPool: number): number {
  const pct = Math.ceil(Math.max(0, currentPool) * spec.percent);
  return spec.base + pct;
}
