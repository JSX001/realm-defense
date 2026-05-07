import { createStore } from 'zustand/vanilla';
import { Resources, zero, clone } from '../data/resources';
import { loadProgress, saveProgress, clearProgress } from '../utils/persistence';

export type GamePhase = 'menu' | 'building' | 'wave' | 'won' | 'lost';
export type SpeedFactor = 1 | 2 | 4;

export interface SelectedTowerInfo {
  col: number;
  row: number;
}

export interface VillageStats {
  alive: number;
  total: number;
}

export interface GameState {
  resources: Resources;
  /** Snapshot of the starting resources for the current map (used in end-of-map summary). */
  startResources: Resources;
  /** Total ever earned during the run, used for "% retained" scoring. */
  totalEarned: Resources;

  currentWave: number;
  totalWaves: number;
  phase: GamePhase;
  currentMapId: string | null;

  speed: SpeedFactor;
  paused: boolean;

  selectedBuildId: string | null;
  selectedTower: SelectedTowerInfo | null;

  /** Live villager status, pushed from Game each tick. Null while in menu. */
  villageStats: VillageStats | null;

  /** Cumulative kill count by enemy id for the current map run. Reset on map load. */
  enemiesKilledByType: Record<string, number>;
  /** Cumulative tower count built during the current map run. Reset on map load. */
  totalTowersBuilt: number;
  /** Wall-clock millis at map load. Used to compute elapsed time for the post-game screen. */
  mapStartedAt: number;
  /** Wall-clock millis at map end (win or lose). 0 while still playing. */
  mapEndedAt: number;

  completedMapIds: Set<string>;

  setResources: (r: Resources) => void;
  setWave: (current: number, total: number) => void;
  setPhase: (p: GamePhase) => void;
  setMap: (id: string | null) => void;
  setSpeed: (s: SpeedFactor) => void;
  setPaused: (p: boolean) => void;
  togglePaused: () => void;
  selectBuild: (id: string | null) => void;
  selectTower: (info: SelectedTowerInfo | null) => void;
  markCompleted: (mapId: string) => void;
  /** Wipe all persisted progress (cleared maps). For the "Reset Progress" UI. */
  resetProgress: () => void;
  reset: (start: Resources, totalWaves: number) => void;
  setVillageStats: (s: VillageStats | null) => void;
  /** Bump totalEarned by the given delta (for tracking "retained" %). */
  recordEarned: (delta: Partial<Resources>) => void;
  /** Bump enemy-kill counter for a given enemy id. */
  recordEnemyKill: (enemyId: string) => void;
  /** Bump total towers built. */
  recordTowerBuilt: () => void;
  /** Capture the wall-clock end time. Called by Game on win/lose. */
  finalizeMapTimer: () => void;
}

export const gameStore = createStore<GameState>((set) => ({
  resources: zero(),
  startResources: zero(),
  totalEarned: zero(),
  currentWave: -1,
  totalWaves: 0,
  phase: 'menu',
  currentMapId: null,
  speed: 1,
  paused: false,
  selectedBuildId: null,
  selectedTower: null,
  villageStats: null,
  enemiesKilledByType: {},
  totalTowersBuilt: 0,
  mapStartedAt: 0,
  mapEndedAt: 0,
  // Hydrate cleared-map progression from localStorage. Empty set on first run
  // or if the blob is missing / corrupt / from an old schema.
  completedMapIds: loadProgress().completedMapIds,

  setResources: (r) => set({ resources: r }),
  setWave: (current, total) => set({ currentWave: current, totalWaves: total }),
  setPhase: (p) => set({ phase: p }),
  setMap: (id) => set({ currentMapId: id }),
  setSpeed: (s) => set({ speed: s }),
  setPaused: (p) => set({ paused: p }),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  selectBuild: (id) => set({ selectedBuildId: id, selectedTower: null }),
  selectTower: (info) => set({ selectedTower: info, selectedBuildId: null }),
  markCompleted: (mapId) => set((s) => {
    const next = new Set(s.completedMapIds);
    next.add(mapId);
    // Persist after every clear. Cheap and means the user won't lose progress
    // even if they immediately close the tab.
    saveProgress({ completedMapIds: next });
    return { completedMapIds: next };
  }),
  resetProgress: () => {
    clearProgress();
    set({ completedMapIds: new Set() });
  },
  reset: (start, totalWaves) =>
    set({
      resources: clone(start),
      startResources: clone(start),
      totalEarned: zero(),
      currentWave: -1,
      totalWaves,
      phase: 'building',
      paused: false,
      selectedBuildId: null,
      selectedTower: null,
      villageStats: null,
      enemiesKilledByType: {},
      totalTowersBuilt: 0,
      mapStartedAt: Date.now(),
      mapEndedAt: 0
    }),
  setVillageStats: (s) => set({ villageStats: s }),
  recordEarned: (delta) => set((state) => ({
    totalEarned: {
      wood: state.totalEarned.wood + (delta.wood ?? 0),
      gold: state.totalEarned.gold + (delta.gold ?? 0),
      stone: state.totalEarned.stone + (delta.stone ?? 0),
      food: state.totalEarned.food + (delta.food ?? 0)
    }
  })),
  recordEnemyKill: (enemyId) => set((state) => ({
    enemiesKilledByType: {
      ...state.enemiesKilledByType,
      [enemyId]: (state.enemiesKilledByType[enemyId] ?? 0) + 1
    }
  })),
  recordTowerBuilt: () => set((state) => ({
    totalTowersBuilt: state.totalTowersBuilt + 1
  })),
  finalizeMapTimer: () => set({ mapEndedAt: Date.now() })
}));
