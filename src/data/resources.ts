// Four-resource economy a la AoE2.
// All resource math goes through these helpers so we never accidentally drop a field.

export type ResourceKey = 'wood' | 'gold' | 'stone' | 'food';

export const RESOURCE_KEYS: ResourceKey[] = ['wood', 'gold', 'stone', 'food'];

export interface Resources {
  wood: number;
  gold: number;
  stone: number;
  food: number;
}

export const RESOURCE_LABELS: Record<ResourceKey, string> = {
  wood: 'Wood',
  gold: 'Gold',
  stone: 'Stone',
  food: 'Food'
};

// Emoji icons used in HUD/tooltips. Plain text glyphs would also work.
export const RESOURCE_ICONS: Record<ResourceKey, string> = {
  wood: '🪵',
  gold: '🪙',
  stone: '🪨',
  food: '🌾'
};

// CSS color hints (for HUD display).
export const RESOURCE_COLORS: Record<ResourceKey, string> = {
  wood: '#a07050',
  gold: '#f4d27a',
  stone: '#a8a8a8',
  food: '#d8a838'
};

export function zero(): Resources {
  return { wood: 0, gold: 0, stone: 0, food: 0 };
}

export function clone(r: Resources): Resources {
  return { wood: r.wood, gold: r.gold, stone: r.stone, food: r.food };
}

export function add(a: Resources, b: Partial<Resources>): Resources {
  return {
    wood: a.wood + (b.wood ?? 0),
    gold: a.gold + (b.gold ?? 0),
    stone: a.stone + (b.stone ?? 0),
    food: a.food + (b.food ?? 0)
  };
}

export function subtract(a: Resources, b: Partial<Resources>): Resources {
  return {
    wood: a.wood - (b.wood ?? 0),
    gold: a.gold - (b.gold ?? 0),
    stone: a.stone - (b.stone ?? 0),
    food: a.food - (b.food ?? 0)
  };
}

/** True iff `pool` has enough to pay every component of `cost`. */
export function canAfford(pool: Resources, cost: Partial<Resources>): boolean {
  return (
    pool.wood >= (cost.wood ?? 0) &&
    pool.gold >= (cost.gold ?? 0) &&
    pool.stone >= (cost.stone ?? 0) &&
    pool.food >= (cost.food ?? 0)
  );
}

/** Floor every value to an integer and clamp negatives to 0. */
export function clampFloor(r: Resources): Resources {
  return {
    wood: Math.max(0, Math.floor(r.wood)),
    gold: Math.max(0, Math.floor(r.gold)),
    stone: Math.max(0, Math.floor(r.stone)),
    food: Math.max(0, Math.floor(r.food))
  };
}

/** True iff at least one resource is exactly 0. */
export function anyAtZero(r: Resources): boolean {
  return r.wood === 0 || r.gold === 0 || r.stone === 0 || r.food === 0;
}

/** Format a partial cost as a short string for buttons: "🪵50 🌾20". */
export function formatCost(cost: Partial<Resources>): string {
  const parts: string[] = [];
  for (const k of RESOURCE_KEYS) {
    const v = cost[k];
    if (v && v > 0) parts.push(`${RESOURCE_ICONS[k]}${v}`);
  }
  return parts.join(' ');
}

/** Multiply a partial cost by a refund factor and floor (for sell refunds). */
export function scaleCost(cost: Partial<Resources>, factor: number): Resources {
  return {
    wood: Math.floor((cost.wood ?? 0) * factor),
    gold: Math.floor((cost.gold ?? 0) * factor),
    stone: Math.floor((cost.stone ?? 0) * factor),
    food: Math.floor((cost.food ?? 0) * factor)
  };
}
