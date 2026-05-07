// Persistent hero progression: which maps have been cleared.
// Backed by localStorage. Schema-versioned so future shape changes don't crash
// on stale data (we just discard the old blob and start fresh).

const STORAGE_KEY = 'realm-defense.progress';
const SCHEMA_VERSION = 1;

interface PersistedSchemaV1 {
  v: 1;
  completedMapIds: string[];
}

export interface PersistedProgress {
  completedMapIds: Set<string>;
}

/** Empty progress, used when nothing is stored or the stored blob is invalid. */
function emptyProgress(): PersistedProgress {
  return { completedMapIds: new Set() };
}

/**
 * Read progress from localStorage. Returns an empty progress if storage is
 * unavailable, the blob is missing, malformed, or from an unknown schema.
 */
export function loadProgress(): PersistedProgress {
  if (typeof localStorage === 'undefined') return emptyProgress();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Some browsers throw on localStorage access in private mode.
    return emptyProgress();
  }
  if (!raw) return emptyProgress();
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSchemaV1>;
    if (parsed && parsed.v === SCHEMA_VERSION && Array.isArray(parsed.completedMapIds)) {
      const valid = parsed.completedMapIds.filter((s): s is string => typeof s === 'string');
      return { completedMapIds: new Set(valid) };
    }
  } catch {
    // Corrupt JSON — fall through to empty.
  }
  return emptyProgress();
}

/** Write progress to localStorage. Silently ignores failures. */
export function saveProgress(progress: PersistedProgress): void {
  if (typeof localStorage === 'undefined') return;
  const blob: PersistedSchemaV1 = {
    v: SCHEMA_VERSION,
    completedMapIds: Array.from(progress.completedMapIds)
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // Storage full / blocked — silently drop.
  }
}

/** Clear all stored progress (used by the Reset Progress button). */
export function clearProgress(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TUTORIAL_KEY);
  } catch {
    // ignore
  }
}

// ─── First-run tutorial flag ──────────────────────────────────────────────
// Stored as a separate localStorage key so it has an independent lifecycle
// from progression and a simpler shape (just "seen" or not).

const TUTORIAL_KEY = 'realm-defense.tutorialSeen';

export function isTutorialSeen(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTutorialSeen(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    // ignore
  }
}

// ─── Difficulty selector ──────────────────────────────────────────────────
// Stored as a separate key. Values: 'easy' | 'standard' | 'hard'. Default
// 'standard'. Applied at map-load time in Game.loadMap.

const DIFFICULTY_KEY = 'realm-defense.difficulty';

export type Difficulty = 'easy' | 'standard' | 'hard';

export function loadDifficulty(): Difficulty {
  if (typeof localStorage === 'undefined') return 'standard';
  try {
    const v = localStorage.getItem(DIFFICULTY_KEY);
    if (v === 'easy' || v === 'standard' || v === 'hard') return v;
  } catch {
    // ignore
  }
  return 'standard';
}

export function saveDifficulty(d: Difficulty): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(DIFFICULTY_KEY, d);
  } catch {
    // ignore
  }
}

/** Tuning constants: HP × M and starting resources × M for each difficulty. */
export const DIFFICULTY_TUNING: Record<Difficulty, { hpMult: number; resourceMult: number; label: string; description: string }> = {
  easy:     { hpMult: 0.7, resourceMult: 1.20, label: 'Easy',     description: 'Enemies are softer; you start richer. For learning the maps.' },
  standard: { hpMult: 1.0, resourceMult: 1.00, label: 'Standard', description: 'The realm as designed. The reference experience.' },
  hard:     { hpMult: 1.4, resourceMult: 0.90, label: 'Hard',     description: 'Enemies hit harder and you start with less. For when Standard feels routine.' }
};
