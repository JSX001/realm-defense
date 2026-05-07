// Map definitions: terrain grid, paths enemies follow, and wave composition.

import { Resources } from './resources';

export type TileType = 'grass' | 'path' | 'water' | 'forest' | 'stone';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface VillageDef {
  /** How many villagers start the map alive. */
  count: number;
  /**
   * Per-resource role distribution among villagers. Sum should equal count.
   * e.g., { wood: 3, food: 2, gold: 2, stone: 1 } means 3 wood-cutters etc.
   */
  roles: Partial<Resources>;
  /** Seconds between income ticks per villager. */
  tickSeconds: number;
}

export interface MapDef {
  id: string;
  name: string;
  difficulty: Difficulty;
  description: string;
  cols: number;
  rows: number;
  tiles: TileType[][];
  /**
   * One or more paths. For corridor maps, each is a list of waypoints.
   * For freeform maps, only the first and last waypoint matter (spawn → goal);
   * walkability is determined by the terrain instead of the corridor.
   */
  paths: { col: number; row: number }[][];
  /** If true, enemies pathfind across all walkable terrain (towers block). */
  freeform?: boolean;
  startResources: Resources;
  village: VillageDef;
  waves: WaveDef[];
}

export interface WaveDef {
  spawns: SpawnDef[];
}

export interface SpawnDef {
  enemyId: string;
  count: number;
  interval: number;
  delay: number;
  /** Index into MapDef.paths. Defaults to 0 if omitted. */
  pathIndex?: number;
}

// ─── Tile-grid construction helpers ──────────────────────────────────────
// Each map's `tiles` is a 2D array of TileType. To author them legibly we
// start with a grass field and scatter decoration tiles by coord pairs.
//
// Important reminder for layout authors: in freeform mode only `grass` tiles
// are walkable AND only grass tiles are buildable. Forest, stone, and water
// tiles all block both walking and building, which is what makes them useful
// for shaping where enemies travel.

/** All-grass grid of the given dimensions. */
function grass(cols: number, rows: number): TileType[][] {
  const grid: TileType[][] = [];
  for (let r = 0; r < rows; r++) grid.push(new Array(cols).fill('grass') as TileType[]);
  return grid;
}

/** Set a list of [col, row] tiles to a given type, in-place. Bounds-checked. */
function setTiles(grid: TileType[][], cells: [number, number][], type: TileType): void {
  for (const [c, r] of cells) {
    if (grid[r] && grid[r][c] !== undefined) grid[r][c] = type;
  }
}

/** Fill a rectangular block (inclusive) with a tile type. Useful for big features. */
function setRect(grid: TileType[][], c0: number, r0: number, c1: number, r1: number, type: TileType): void {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (grid[r] && grid[r][c] !== undefined) grid[r][c] = type;
    }
  }
}

export const MAPS: Record<string, MapDef> = {
  // ─── Freeform map ────────────────────────────────────────────────
  // No fixed corridors. Enemies spawn from two gates and pathfind across
  // the open grass to the village. YOUR TOWERS BUILD THE MAZE — placing
  // them changes where enemies walk. New enemy types in later waves can
  // make your early maze the wrong shape.
  openField: {
    id: 'openField',
    name: 'The Open Field',
    difficulty: 'medium',
    description: 'Open ground beyond the village walls. The enemy comes through gates in the north — let your towers shape the road they walk.',
    cols: 16,
    rows: 12,
    // For freeform maps, paths[i] = [spawn, goal]. Only the spawn (paths[i][0])
    // is used; the goal is the village tile (which is the same as paths[0][last]).
    paths: [
      [{ col: 0, row: 1 }, { col: 13, row: 10 }],   // top-left gate
      [{ col: 15, row: 1 }, { col: 13, row: 10 }]   // top-right gate
    ],
    freeform: true,
    tiles: (() => {
      // All grass; scatter a few unbuildable decorative tiles for shape.
      const grid: TileType[][] = [];
      for (let r = 0; r < 12; r++) grid.push(new Array(16).fill('grass') as TileType[]);
      // Stone outcrops scattered around
      const stones: [number, number][] = [
        [4, 3], [5, 3], [4, 4],
        [11, 4], [12, 4], [12, 5],
        [3, 8], [4, 8],
        [9, 7], [10, 8]
      ];
      for (const [c, r] of stones) grid[r][c] = 'stone';
      // Forest patches in corners
      const forest: [number, number][] = [
        [0, 11], [1, 11], [0, 10],
        [15, 11], [14, 11], [15, 10]
      ];
      for (const [c, r] of forest) grid[r][c] = 'forest';
      // Don't carve a path — freeform!
      return grid;
    })(),
    startResources: { wood: 130, gold: 100, stone: 80, food: 130 },
    village: {
      count: 8,
      roles: { wood: 3, food: 2, gold: 2, stone: 1 },
      tickSeconds: 3
    },
    waves: [
      // 1: easy intro — small mixed group from one gate
      { spawns: [
        { enemyId: 'militia', count: 6, interval: 0.8, delay: 0, pathIndex: 0 }
      ]},
      // 2: both gates start firing
      { spawns: [
        { enemyId: 'militia', count: 5, interval: 0.7, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 5, interval: 0.7, delay: 0, pathIndex: 1 }
      ]},
      // 3: skirmisher swarm — your maze had better not be a single chokepoint
      { spawns: [
        { enemyId: 'skirmisher', count: 14, interval: 0.3, delay: 0, pathIndex: 0 },
        { enemyId: 'skirmisher', count: 14, interval: 0.3, delay: 4, pathIndex: 1 }
      ]},
      // 4: scout cavalry — speed punishes long mazes; first sapper appears
      { spawns: [
        { enemyId: 'scoutCavalry', count: 8, interval: 0.4, delay: 0, pathIndex: 0 },
        { enemyId: 'scoutCavalry', count: 8, interval: 0.4, delay: 3, pathIndex: 1 },
        { enemyId: 'sapper', count: 2, interval: 2.0, delay: 6, pathIndex: 0 },
        { enemyId: 'militia', count: 5, interval: 0.6, delay: 8, pathIndex: 0 }
      ]},
      // 5: mangonel + sapper pressure — your palisades are at risk
      { spawns: [
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 0 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 1 },
        { enemyId: 'sapper', count: 3, interval: 1.5, delay: 4, pathIndex: 1 },
        { enemyId: 'skirmisher', count: 10, interval: 0.3, delay: 6, pathIndex: 0 }
      ]},
      // 6: paladin — heavy armor through your maze + sappers on opposite gate
      { spawns: [
        { enemyId: 'paladin', count: 4, interval: 1.5, delay: 0, pathIndex: 0 },
        { enemyId: 'paladin', count: 4, interval: 1.5, delay: 0, pathIndex: 1 },
        { enemyId: 'sapper', count: 4, interval: 1.5, delay: 3, pathIndex: 0 },
        { enemyId: 'scoutCavalry', count: 6, interval: 0.4, delay: 5, pathIndex: 1 }
      ]},
      // 7: full mix + sapper swarm — adapt or fall
      { spawns: [
        { enemyId: 'militia', count: 8, interval: 0.5, delay: 0, pathIndex: 0 },
        { enemyId: 'scoutCavalry', count: 8, interval: 0.4, delay: 3, pathIndex: 1 },
        { enemyId: 'sapper', count: 6, interval: 1.0, delay: 5, pathIndex: 0 },
        { enemyId: 'sapper', count: 6, interval: 1.0, delay: 5, pathIndex: 1 },
        { enemyId: 'skirmisher', count: 14, interval: 0.25, delay: 6, pathIndex: 0 },
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 10, pathIndex: 1 },
        { enemyId: 'mangonel', count: 5, interval: 0.9, delay: 12, pathIndex: 0 }
      ]}
    ]
  },

  // ─── The Three Roads ─────────────────────────────────────────────
  // Three gates from north, west, east converge on a central village.
  // Forces multi-front defense — you can't put all your towers in one place.
  // Larger map, more villagers, more wood income to support a sprawling maze.
  threeRoads: {
    id: 'threeRoads',
    name: 'The Three Roads',
    difficulty: 'hard',
    description: 'Where three caravan roads meet, the enemy converges from all of them. The village sits at the crossroads, and so the burden of defence is threefold.',
    cols: 18,
    rows: 14,
    paths: [
      [{ col: 9,  row: 0  }, { col: 9, row: 9 }],   // north gate
      [{ col: 0,  row: 7  }, { col: 9, row: 9 }],   // west gate
      [{ col: 17, row: 7  }, { col: 9, row: 9 }]    // east gate
    ],
    freeform: true,
    tiles: (() => {
      const grid: TileType[][] = [];
      for (let r = 0; r < 14; r++) grid.push(new Array(18).fill('grass') as TileType[]);
      // Forest patches in the four corners
      const forest: [number, number][] = [
        [0, 0], [1, 0], [0, 1],
        [17, 0], [16, 0], [17, 1],
        [0, 13], [1, 13], [0, 12],
        [17, 13], [16, 13], [17, 12]
      ];
      for (const [c, r] of forest) grid[r][c] = 'forest';
      // Stone outcrops creating natural anchor points around the village
      // (without sealing it off — leaves plenty of grass to maze around).
      const stones: [number, number][] = [
        [6, 5], [7, 5],
        [10, 5], [11, 5],
        [5, 9], [5, 10],
        [12, 9], [12, 10],
        [8, 12], [9, 12], [10, 12]
      ];
      for (const [c, r] of stones) grid[r][c] = 'stone';
      return grid;
    })(),
    startResources: { wood: 150, gold: 110, stone: 90, food: 140 },
    village: {
      count: 10,
      roles: { wood: 4, food: 2, gold: 2, stone: 2 },
      tickSeconds: 3
    },
    waves: [
      // 1: gentle intro from the north
      { spawns: [
        { enemyId: 'militia', count: 6, interval: 0.8, delay: 0, pathIndex: 0 }
      ]},
      // 2: north + west open up
      { spawns: [
        { enemyId: 'militia', count: 5, interval: 0.7, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 5, interval: 0.7, delay: 2, pathIndex: 1 }
      ]},
      // 3: all three gates fire — first taste of three-front pressure
      { spawns: [
        { enemyId: 'militia', count: 5, interval: 0.7, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 5, interval: 0.7, delay: 0, pathIndex: 1 },
        { enemyId: 'militia', count: 5, interval: 0.7, delay: 0, pathIndex: 2 }
      ]},
      // 4: skirmisher swarm from west + east, scouts from north
      { spawns: [
        { enemyId: 'skirmisher', count: 12, interval: 0.3, delay: 0, pathIndex: 1 },
        { enemyId: 'skirmisher', count: 12, interval: 0.3, delay: 2, pathIndex: 2 },
        { enemyId: 'scoutCavalry', count: 6, interval: 0.4, delay: 6, pathIndex: 0 }
      ]},
      // 5: sappers join — your maze had better be deep
      { spawns: [
        { enemyId: 'sapper', count: 3, interval: 1.5, delay: 0, pathIndex: 0 },
        { enemyId: 'sapper', count: 3, interval: 1.5, delay: 0, pathIndex: 1 },
        { enemyId: 'sapper', count: 3, interval: 1.5, delay: 0, pathIndex: 2 },
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 6, pathIndex: 0 }
      ]},
      // 6: mangonels from all three. need anti-armor coverage everywhere
      { spawns: [
        { enemyId: 'mangonel', count: 3, interval: 1.0, delay: 0, pathIndex: 0 },
        { enemyId: 'mangonel', count: 3, interval: 1.0, delay: 0, pathIndex: 1 },
        { enemyId: 'mangonel', count: 3, interval: 1.0, delay: 0, pathIndex: 2 },
        { enemyId: 'skirmisher', count: 10, interval: 0.3, delay: 8, pathIndex: 0 }
      ]},
      // 7: paladins from east + west, scout cavalry up the middle
      { spawns: [
        { enemyId: 'paladin', count: 4, interval: 1.5, delay: 0, pathIndex: 1 },
        { enemyId: 'paladin', count: 4, interval: 1.5, delay: 0, pathIndex: 2 },
        { enemyId: 'scoutCavalry', count: 10, interval: 0.35, delay: 4, pathIndex: 0 },
        { enemyId: 'sapper', count: 4, interval: 1.2, delay: 8, pathIndex: 0 }
      ]},
      // 8: full assault — everything from everywhere
      { spawns: [
        { enemyId: 'militia', count: 8, interval: 0.5, delay: 0, pathIndex: 0 },
        { enemyId: 'scoutCavalry', count: 8, interval: 0.4, delay: 0, pathIndex: 1 },
        { enemyId: 'scoutCavalry', count: 8, interval: 0.4, delay: 0, pathIndex: 2 },
        { enemyId: 'sapper', count: 5, interval: 1.0, delay: 4, pathIndex: 0 },
        { enemyId: 'sapper', count: 5, interval: 1.0, delay: 4, pathIndex: 1 },
        { enemyId: 'sapper', count: 5, interval: 1.0, delay: 4, pathIndex: 2 },
        { enemyId: 'skirmisher', count: 16, interval: 0.25, delay: 8, pathIndex: 0 },
        { enemyId: 'paladin', count: 4, interval: 1.5, delay: 12, pathIndex: 1 },
        { enemyId: 'paladin', count: 4, interval: 1.5, delay: 12, pathIndex: 2 },
        { enemyId: 'mangonel', count: 6, interval: 0.9, delay: 14, pathIndex: 0 }
      ]}
    ]
  },

  // ─── The Citadel ─────────────────────────────────────────────────
  // Tiny battlefield. Single gate, opposite-corner village. Limited tiles
  // mean every wall and tower has to earn its place. Stone is scarce, so
  // wood palisades and the Caltrops Tower carry the early waves.
  citadel: {
    id: 'citadel',
    name: 'The Citadel',
    difficulty: 'easy',
    description: 'A small keep clutched into the hillside. One gate, one approach, one chance. Stone is scarce — let timber palisades carry the early assaults.',
    cols: 12,
    rows: 9,
    paths: [
      [{ col: 6, row: 0 }, { col: 10, row: 7 }]    // single gate, north
    ],
    freeform: true,
    tiles: (() => {
      const grid = grass(12, 9);
      // Outer corner tucked decorations only — keep most tiles open since
      // the map is small.
      setTiles(grid, [
        [0, 0], [1, 0], [0, 1],
        [11, 0], [11, 8], [10, 8]
      ], 'forest');
      setTiles(grid, [
        [3, 3], [4, 3],
        [7, 5], [8, 5]
      ], 'stone');
      return grid;
    })(),
    startResources: { wood: 110, gold: 80, stone: 50, food: 100 },
    village: {
      count: 6,
      roles: { wood: 2, food: 2, gold: 1, stone: 1 },
      tickSeconds: 3
    },
    waves: [
      { spawns: [{ enemyId: 'militia', count: 5, interval: 0.7, delay: 0, pathIndex: 0 }] },
      { spawns: [
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 0, pathIndex: 0 },
        { enemyId: 'skirmisher', count: 4, interval: 0.5, delay: 4, pathIndex: 0 }
      ]},
      { spawns: [
        { enemyId: 'scoutCavalry', count: 6, interval: 0.5, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 5, interval: 0.7, delay: 4, pathIndex: 0 }
      ]},
      { spawns: [
        { enemyId: 'sapper', count: 2, interval: 1.5, delay: 0, pathIndex: 0 },
        { enemyId: 'skirmisher', count: 10, interval: 0.3, delay: 3, pathIndex: 0 }
      ]},
      { spawns: [
        { enemyId: 'paladin', count: 3, interval: 1.5, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 8, interval: 0.5, delay: 5, pathIndex: 0 }
      ]},
      { spawns: [
        { enemyId: 'mangonel', count: 3, interval: 1.0, delay: 0, pathIndex: 0 },
        { enemyId: 'sapper', count: 3, interval: 1.2, delay: 2, pathIndex: 0 },
        { enemyId: 'scoutCavalry', count: 8, interval: 0.4, delay: 5, pathIndex: 0 },
        { enemyId: 'paladin', count: 2, interval: 1.5, delay: 10, pathIndex: 0 }
      ]}
    ]
  },

  // ─── The Pass ────────────────────────────────────────────────────
  // Wide-shallow corridor walled by forest top + bottom. You can't really
  // maze here — the geometry forces a packed gauntlet of towers along the
  // 4-tile-tall central strip. Tests bombards / trebuchets at range.
  thePass: {
    id: 'thePass',
    name: 'The Pass',
    difficulty: 'medium',
    description: 'A narrow defile between dense forest. The enemy cannot flank, but neither can you — pack your engines along the corridor and pour your fire.',
    cols: 14,
    rows: 8,
    paths: [
      [{ col: 0, row: 4 }, { col: 13, row: 4 }]
    ],
    freeform: true,
    tiles: (() => {
      const grid = grass(14, 8);
      // Forest walls top and bottom — leaves a 4-row corridor (rows 2..5).
      setRect(grid, 0, 0, 13, 1, 'forest');
      setRect(grid, 0, 6, 13, 7, 'forest');
      // A few stone outcrops in the corridor as natural pinch points.
      setTiles(grid, [
        [4, 3], [4, 5],
        [9, 3], [9, 5]
      ], 'stone');
      return grid;
    })(),
    startResources: { wood: 110, gold: 110, stone: 130, food: 110 },
    village: {
      count: 8,
      roles: { wood: 2, food: 2, gold: 2, stone: 2 },
      tickSeconds: 3
    },
    waves: [
      { spawns: [{ enemyId: 'militia', count: 8, interval: 0.6, delay: 0, pathIndex: 0 }] },
      { spawns: [
        { enemyId: 'skirmisher', count: 12, interval: 0.3, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 4, interval: 0.7, delay: 6, pathIndex: 0 }
      ]},
      { spawns: [
        { enemyId: 'scoutCavalry', count: 10, interval: 0.35, delay: 0, pathIndex: 0 }
      ]},
      { spawns: [
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 0, pathIndex: 0 },
        { enemyId: 'skirmisher', count: 14, interval: 0.25, delay: 5, pathIndex: 0 }
      ]},
      { spawns: [
        { enemyId: 'mangonel', count: 5, interval: 0.9, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 8, interval: 0.5, delay: 4, pathIndex: 0 }
      ]},
      { spawns: [
        { enemyId: 'paladin', count: 5, interval: 1.4, delay: 0, pathIndex: 0 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 4, pathIndex: 0 },
        { enemyId: 'scoutCavalry', count: 12, interval: 0.3, delay: 8, pathIndex: 0 }
      ]},
      { spawns: [
        { enemyId: 'mangonel', count: 6, interval: 0.9, delay: 0, pathIndex: 0 },
        { enemyId: 'paladin', count: 6, interval: 1.3, delay: 3, pathIndex: 0 },
        { enemyId: 'scoutCavalry', count: 14, interval: 0.3, delay: 6, pathIndex: 0 },
        { enemyId: 'skirmisher', count: 18, interval: 0.22, delay: 10, pathIndex: 0 }
      ]}
    ]
  },

  // ─── Crossroads ──────────────────────────────────────────────────
  // Symmetric square. Two gates on opposite sides, village dead center.
  // Stone outcrops in a + pattern create four quadrants — rewards mirrored
  // builds, punishes lopsided defense.
  crossroads: {
    id: 'crossroads',
    name: 'Crossroads',
    difficulty: 'medium',
    description: 'An old toll stop where two highways cross. Enemies pour from east and west with equal weight — what works on one road must work on both.',
    cols: 14,
    rows: 12,
    paths: [
      [{ col: 0,  row: 6 }, { col: 7, row: 6 }],   // west gate
      [{ col: 13, row: 6 }, { col: 7, row: 6 }]    // east gate
    ],
    freeform: true,
    tiles: (() => {
      const grid = grass(14, 12);
      // Forest in the four corners
      setTiles(grid, [
        [0, 0], [1, 0], [0, 1],
        [13, 0], [12, 0], [13, 1],
        [0, 11], [1, 11], [0, 10],
        [13, 11], [12, 11], [13, 10]
      ], 'forest');
      // Stone outcrops in a + shape around (but not on) the village (7, 6).
      // Vertical arm:
      setTiles(grid, [[7, 2], [7, 3], [7, 9], [7, 10]], 'stone');
      // Horizontal arm — leaves the village row clear so paths can reach it.
      setTiles(grid, [[3, 6], [10, 6]], 'stone');
      return grid;
    })(),
    startResources: { wood: 130, gold: 110, stone: 100, food: 130 },
    village: {
      count: 8,
      roles: { wood: 3, food: 2, gold: 2, stone: 1 },
      tickSeconds: 3
    },
    waves: [
      { spawns: [
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 0, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'skirmisher', count: 10, interval: 0.3, delay: 0, pathIndex: 0 },
        { enemyId: 'skirmisher', count: 10, interval: 0.3, delay: 2, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'scoutCavalry', count: 8, interval: 0.4, delay: 0, pathIndex: 0 },
        { enemyId: 'scoutCavalry', count: 8, interval: 0.4, delay: 0, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'sapper', count: 3, interval: 1.4, delay: 0, pathIndex: 0 },
        { enemyId: 'sapper', count: 3, interval: 1.4, delay: 0, pathIndex: 1 },
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 4, pathIndex: 0 },
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 4, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 0, pathIndex: 0 },
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 0, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 0 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 1 },
        { enemyId: 'skirmisher', count: 12, interval: 0.3, delay: 6, pathIndex: 0 },
        { enemyId: 'skirmisher', count: 12, interval: 0.3, delay: 6, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'paladin', count: 5, interval: 1.4, delay: 0, pathIndex: 0 },
        { enemyId: 'paladin', count: 5, interval: 1.4, delay: 0, pathIndex: 1 },
        { enemyId: 'sapper', count: 4, interval: 1.2, delay: 5, pathIndex: 0 },
        { enemyId: 'sapper', count: 4, interval: 1.2, delay: 5, pathIndex: 1 },
        { enemyId: 'mangonel', count: 5, interval: 0.9, delay: 10, pathIndex: 0 },
        { enemyId: 'mangonel', count: 5, interval: 0.9, delay: 10, pathIndex: 1 }
      ]}
    ]
  },

  // ─── The Marsh ───────────────────────────────────────────────────
  // A diagonal river splits the map, with a 2-tile land bridge in the
  // middle. Water is unwalkable AND unbuildable — natural choke at the
  // bridge. Two gates on the north side; village on the south.
  marsh: {
    id: 'marsh',
    name: 'The Marsh',
    difficulty: 'medium',
    description: 'Marshland cut by a sluggish river. Only the central bridge bears troops — fortify it before the boots reach the bank.',
    cols: 16,
    rows: 12,
    paths: [
      [{ col: 1,  row: 0 }, { col: 14, row: 11 }],  // top-left gate
      [{ col: 14, row: 0 }, { col: 14, row: 11 }]   // top-right gate
    ],
    freeform: true,
    tiles: (() => {
      const grid = grass(16, 12);
      // Diagonal river: cells from approx (0, 5) sweeping down to (15, 7),
      // with a 2-tile land bridge at the middle (cols 7–8, row 6).
      const river: [number, number][] = [
        [0, 5], [1, 5], [2, 5],
        [3, 5], [3, 6],
        [4, 6], [5, 6],
        [6, 6], [6, 7],
        // skip 7,6 and 8,6 — that's the bridge
        [7, 7], [8, 7],
        [9, 7], [9, 6], // river curves slightly above the lower run
        [10, 6], [10, 7],
        [11, 7], [12, 7],
        [13, 7], [14, 7], [15, 7]
      ];
      setTiles(grid, river, 'water');
      // Forest fringes at both ends of the river
      setTiles(grid, [
        [0, 4], [0, 6], [1, 4], [1, 6],
        [15, 6], [15, 8], [14, 8]
      ], 'forest');
      // A few rocky outcrops on the south bank for terrain texture
      setTiles(grid, [[4, 9], [11, 9], [8, 10]], 'stone');
      return grid;
    })(),
    startResources: { wood: 130, gold: 110, stone: 100, food: 120 },
    village: {
      count: 9,
      roles: { wood: 3, food: 2, gold: 2, stone: 2 },
      tickSeconds: 3
    },
    waves: [
      { spawns: [
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 2, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'skirmisher', count: 12, interval: 0.3, delay: 0, pathIndex: 0 },
        { enemyId: 'scoutCavalry', count: 6, interval: 0.4, delay: 4, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'scoutCavalry', count: 8, interval: 0.4, delay: 0, pathIndex: 0 },
        { enemyId: 'scoutCavalry', count: 8, interval: 0.4, delay: 0, pathIndex: 1 },
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 4, pathIndex: 0 }
      ]},
      { spawns: [
        { enemyId: 'sapper', count: 4, interval: 1.2, delay: 0, pathIndex: 0 },
        { enemyId: 'sapper', count: 4, interval: 1.2, delay: 0, pathIndex: 1 },
        { enemyId: 'skirmisher', count: 12, interval: 0.3, delay: 5, pathIndex: 0 }
      ]},
      { spawns: [
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 0, pathIndex: 0 },
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 2, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 0 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 1 },
        { enemyId: 'paladin', count: 3, interval: 1.4, delay: 6, pathIndex: 0 }
      ]},
      { spawns: [
        { enemyId: 'sapper', count: 5, interval: 1.0, delay: 0, pathIndex: 0 },
        { enemyId: 'sapper', count: 5, interval: 1.0, delay: 0, pathIndex: 1 },
        { enemyId: 'scoutCavalry', count: 12, interval: 0.3, delay: 5, pathIndex: 0 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 10, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'paladin', count: 6, interval: 1.3, delay: 0, pathIndex: 0 },
        { enemyId: 'paladin', count: 6, interval: 1.3, delay: 0, pathIndex: 1 },
        { enemyId: 'mangonel', count: 6, interval: 0.9, delay: 5, pathIndex: 0 },
        { enemyId: 'sapper', count: 6, interval: 1.0, delay: 8, pathIndex: 1 },
        { enemyId: 'skirmisher', count: 16, interval: 0.25, delay: 12, pathIndex: 0 }
      ]}
    ]
  },

  // ─── Twin Heights ────────────────────────────────────────────────
  // The village sits on a rocky plateau, ringed by stone outcrops on every
  // side except two narrow approaches. Two gates from the north and south
  // converge on those approaches. Forces fortifying TWO chokepoints.
  twinHeights: {
    id: 'twinHeights',
    name: 'Twin Heights',
    difficulty: 'medium',
    description: 'The village sits high on a rocky plateau, walled by stone the realm did not build. Two narrow approaches — north and south — pierce the heights. Hold them, or fall.',
    cols: 16,
    rows: 12,
    paths: [
      [{ col: 8, row: 0 },  { col: 8, row: 6 }],   // north gate
      [{ col: 8, row: 11 }, { col: 8, row: 6 }]    // south gate
    ],
    freeform: true,
    tiles: (() => {
      const grid = grass(16, 12);
      // Plateau ring: stones around (col 8, row 6) leaving narrow N–S corridor
      // through col 8, blocked everywhere else.
      const ring: [number, number][] = [
        // Top of plateau (row 5) — leave col 8 open
        [5, 5], [6, 5], [7, 5], [9, 5], [10, 5], [11, 5],
        // Sides (row 6) — leave col 8 open in the middle, block sides
        [4, 6], [5, 6], [6, 6], [10, 6], [11, 6], [12, 6],
        // Bottom of plateau (row 7) — leave col 8 open
        [5, 7], [6, 7], [7, 7], [9, 7], [10, 7], [11, 7]
      ];
      setTiles(grid, ring, 'stone');
      // Forest fringes
      setTiles(grid, [
        [0, 0], [1, 0], [0, 1],
        [15, 0], [14, 0], [15, 1],
        [0, 11], [1, 11], [0, 10],
        [15, 11], [14, 11], [15, 10]
      ], 'forest');
      return grid;
    })(),
    startResources: { wood: 140, gold: 110, stone: 110, food: 130 },
    village: {
      count: 8,
      roles: { wood: 2, food: 2, gold: 2, stone: 2 },
      tickSeconds: 3
    },
    waves: [
      { spawns: [
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 4, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'scoutCavalry', count: 8, interval: 0.4, delay: 0, pathIndex: 0 },
        { enemyId: 'scoutCavalry', count: 8, interval: 0.4, delay: 0, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'sapper', count: 3, interval: 1.4, delay: 0, pathIndex: 0 },
        { enemyId: 'sapper', count: 3, interval: 1.4, delay: 0, pathIndex: 1 },
        { enemyId: 'skirmisher', count: 10, interval: 0.3, delay: 4, pathIndex: 0 }
      ]},
      { spawns: [
        { enemyId: 'paladin', count: 5, interval: 1.4, delay: 0, pathIndex: 0 },
        { enemyId: 'paladin', count: 5, interval: 1.4, delay: 0, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 0 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 1 },
        { enemyId: 'militia', count: 8, interval: 0.5, delay: 5, pathIndex: 0 }
      ]},
      { spawns: [
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 0, pathIndex: 0 },
        { enemyId: 'sapper', count: 5, interval: 1.0, delay: 2, pathIndex: 0 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 6, pathIndex: 1 },
        { enemyId: 'scoutCavalry', count: 12, interval: 0.3, delay: 8, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'paladin', count: 6, interval: 1.3, delay: 0, pathIndex: 0 },
        { enemyId: 'paladin', count: 6, interval: 1.3, delay: 0, pathIndex: 1 },
        { enemyId: 'mangonel', count: 5, interval: 0.9, delay: 5, pathIndex: 0 },
        { enemyId: 'mangonel', count: 5, interval: 0.9, delay: 5, pathIndex: 1 },
        { enemyId: 'sapper', count: 6, interval: 1.0, delay: 10, pathIndex: 0 },
        { enemyId: 'skirmisher', count: 16, interval: 0.25, delay: 14, pathIndex: 1 }
      ]}
    ]
  },

  // ─── The Hollow ──────────────────────────────────────────────────
  // Sprawling open valley with three gates along the north. Scattered
  // stone "rooms" (small clusters) break up the open space — there are
  // many possible maze shapes. Tests planning across a large area.
  hollow: {
    id: 'hollow',
    name: 'The Hollow',
    difficulty: 'hard',
    description: 'A wide valley overlooked by three mountain passes. The enemy spills down from all three at once. Many places to fortify; never coin enough for all of them.',
    cols: 20,
    rows: 14,
    paths: [
      [{ col: 4,  row: 0 }, { col: 10, row: 12 }],
      [{ col: 10, row: 0 }, { col: 10, row: 12 }],
      [{ col: 16, row: 0 }, { col: 10, row: 12 }]
    ],
    freeform: true,
    tiles: (() => {
      const grid = grass(20, 14);
      // Forest fringes at the corners
      setTiles(grid, [
        [0, 0], [1, 0], [0, 1],
        [19, 0], [18, 0], [19, 1],
        [0, 13], [1, 13], [0, 12],
        [19, 13], [18, 13], [19, 12]
      ], 'forest');
      // Stone "rooms" — small 2x2 or 3-tile clusters scattered.
      // Cluster A: NW upper-mid
      setTiles(grid, [[2, 4], [3, 4], [2, 5], [3, 5]], 'stone');
      // Cluster B: NE upper-mid
      setTiles(grid, [[16, 4], [17, 4], [16, 5], [17, 5]], 'stone');
      // Cluster C: middle-left
      setTiles(grid, [[6, 7], [7, 7], [6, 8]], 'stone');
      // Cluster D: middle-right
      setTiles(grid, [[13, 7], [14, 7], [14, 8]], 'stone');
      // Cluster E: south of village
      setTiles(grid, [[8, 13], [9, 13], [11, 13], [12, 13]], 'stone');
      // Forest patches breaking up the central open space
      setTiles(grid, [[10, 6], [10, 5]], 'forest');
      return grid;
    })(),
    startResources: { wood: 160, gold: 120, stone: 110, food: 150 },
    village: {
      count: 10,
      roles: { wood: 4, food: 2, gold: 2, stone: 2 },
      tickSeconds: 3
    },
    waves: [
      { spawns: [
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 0, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'militia', count: 5, interval: 0.6, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 5, interval: 0.6, delay: 0, pathIndex: 2 }
      ]},
      { spawns: [
        { enemyId: 'skirmisher', count: 10, interval: 0.3, delay: 0, pathIndex: 0 },
        { enemyId: 'skirmisher', count: 10, interval: 0.3, delay: 0, pathIndex: 2 },
        { enemyId: 'scoutCavalry', count: 6, interval: 0.4, delay: 4, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'sapper', count: 3, interval: 1.4, delay: 0, pathIndex: 0 },
        { enemyId: 'sapper', count: 3, interval: 1.4, delay: 0, pathIndex: 1 },
        { enemyId: 'sapper', count: 3, interval: 1.4, delay: 0, pathIndex: 2 }
      ]},
      { spawns: [
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 0, pathIndex: 0 },
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 0, pathIndex: 2 },
        { enemyId: 'scoutCavalry', count: 10, interval: 0.35, delay: 5, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 0 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 1 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 2 }
      ]},
      { spawns: [
        { enemyId: 'paladin', count: 5, interval: 1.4, delay: 0, pathIndex: 1 },
        { enemyId: 'sapper', count: 5, interval: 1.0, delay: 3, pathIndex: 0 },
        { enemyId: 'sapper', count: 5, interval: 1.0, delay: 3, pathIndex: 2 },
        { enemyId: 'scoutCavalry', count: 12, interval: 0.3, delay: 8, pathIndex: 1 }
      ]},
      { spawns: [
        { enemyId: 'militia', count: 8, interval: 0.5, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 8, interval: 0.5, delay: 0, pathIndex: 2 },
        { enemyId: 'paladin', count: 5, interval: 1.4, delay: 4, pathIndex: 0 },
        { enemyId: 'paladin', count: 5, interval: 1.4, delay: 4, pathIndex: 2 },
        { enemyId: 'mangonel', count: 5, interval: 0.9, delay: 10, pathIndex: 1 },
        { enemyId: 'sapper', count: 6, interval: 1.0, delay: 12, pathIndex: 1 },
        { enemyId: 'skirmisher', count: 18, interval: 0.22, delay: 16, pathIndex: 0 }
      ]}
    ]
  },

  // ─── Four Winds ──────────────────────────────────────────────────
  // FOUR gates, one on each side of the map. Village dead center. The
  // ultimate multi-front test — your defense has to face every direction
  // simultaneously. Generous starting resources to compensate.
  fourWinds: {
    id: 'fourWinds',
    name: 'Four Winds',
    difficulty: 'hard',
    description: 'An ancient crossroads at the heart of the realm. Roads run to all four cardinal points — and the enemy comes down each. Surrounded on every side, the defender holds only a single point: the village itself.',
    cols: 18,
    rows: 14,
    paths: [
      [{ col: 9,  row: 0  }, { col: 9, row: 7 }],   // north
      [{ col: 9,  row: 13 }, { col: 9, row: 7 }],   // south
      [{ col: 0,  row: 7  }, { col: 9, row: 7 }],   // west
      [{ col: 17, row: 7  }, { col: 9, row: 7 }]    // east
    ],
    freeform: true,
    tiles: (() => {
      const grid = grass(18, 14);
      // Forest in the four corners
      setTiles(grid, [
        [0, 0], [1, 0], [0, 1],
        [17, 0], [16, 0], [17, 1],
        [0, 13], [1, 13], [0, 12],
        [17, 13], [16, 13], [17, 12]
      ], 'forest');
      // Stone outcrops in a diamond around the village (9, 7) without
      // sealing it — leaves the four cardinal approaches clear.
      setTiles(grid, [
        [6, 4], [12, 4],
        [4, 6], [4, 8],
        [14, 6], [14, 8],
        [6, 10], [12, 10]
      ], 'stone');
      return grid;
    })(),
    startResources: { wood: 170, gold: 140, stone: 130, food: 160 },
    village: {
      count: 11,
      roles: { wood: 4, food: 3, gold: 2, stone: 2 },
      tickSeconds: 3
    },
    waves: [
      { spawns: [
        { enemyId: 'militia', count: 5, interval: 0.7, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 5, interval: 0.7, delay: 0, pathIndex: 2 }
      ]},
      { spawns: [
        { enemyId: 'militia', count: 5, interval: 0.7, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 5, interval: 0.7, delay: 0, pathIndex: 1 },
        { enemyId: 'militia', count: 5, interval: 0.7, delay: 0, pathIndex: 2 },
        { enemyId: 'militia', count: 5, interval: 0.7, delay: 0, pathIndex: 3 }
      ]},
      { spawns: [
        { enemyId: 'skirmisher', count: 10, interval: 0.3, delay: 0, pathIndex: 0 },
        { enemyId: 'skirmisher', count: 10, interval: 0.3, delay: 0, pathIndex: 1 },
        { enemyId: 'scoutCavalry', count: 6, interval: 0.4, delay: 4, pathIndex: 2 },
        { enemyId: 'scoutCavalry', count: 6, interval: 0.4, delay: 4, pathIndex: 3 }
      ]},
      { spawns: [
        { enemyId: 'sapper', count: 3, interval: 1.4, delay: 0, pathIndex: 0 },
        { enemyId: 'sapper', count: 3, interval: 1.4, delay: 0, pathIndex: 1 },
        { enemyId: 'sapper', count: 3, interval: 1.4, delay: 0, pathIndex: 2 },
        { enemyId: 'sapper', count: 3, interval: 1.4, delay: 0, pathIndex: 3 }
      ]},
      { spawns: [
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 0, pathIndex: 0 },
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 0, pathIndex: 2 },
        { enemyId: 'mangonel', count: 3, interval: 1.0, delay: 6, pathIndex: 1 },
        { enemyId: 'mangonel', count: 3, interval: 1.0, delay: 6, pathIndex: 3 }
      ]},
      { spawns: [
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 0 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 1 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 2 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 3 }
      ]},
      { spawns: [
        { enemyId: 'paladin', count: 5, interval: 1.3, delay: 0, pathIndex: 0 },
        { enemyId: 'paladin', count: 5, interval: 1.3, delay: 0, pathIndex: 1 },
        { enemyId: 'sapper', count: 4, interval: 1.0, delay: 4, pathIndex: 2 },
        { enemyId: 'sapper', count: 4, interval: 1.0, delay: 4, pathIndex: 3 },
        { enemyId: 'scoutCavalry', count: 10, interval: 0.35, delay: 8, pathIndex: 0 }
      ]},
      { spawns: [
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 0, pathIndex: 0 },
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 0, pathIndex: 1 },
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 0, pathIndex: 2 },
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 0, pathIndex: 3 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 6, pathIndex: 0 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 6, pathIndex: 2 }
      ]},
      { spawns: [
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 0, pathIndex: 1 },
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 0, pathIndex: 2 },
        { enemyId: 'militia', count: 6, interval: 0.6, delay: 0, pathIndex: 3 },
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 5, pathIndex: 0 },
        { enemyId: 'paladin', count: 4, interval: 1.4, delay: 5, pathIndex: 2 },
        { enemyId: 'mangonel', count: 5, interval: 0.9, delay: 10, pathIndex: 1 },
        { enemyId: 'mangonel', count: 5, interval: 0.9, delay: 10, pathIndex: 3 },
        { enemyId: 'sapper', count: 6, interval: 1.0, delay: 14, pathIndex: 0 },
        { enemyId: 'sapper', count: 6, interval: 1.0, delay: 14, pathIndex: 2 },
        { enemyId: 'skirmisher', count: 20, interval: 0.22, delay: 18, pathIndex: 1 }
      ]}
    ]
  },

  // ─── The Last Stand ──────────────────────────────────────────────
  // The endgame map. 22×16, four asymmetric gates, mixed terrain (forest
  // cluster, water pond, stone clusters scattered). 10 brutal waves
  // culminating in everything from everywhere.
  lastStand: {
    id: 'lastStand',
    name: 'The Last Stand',
    difficulty: 'hard',
    description: 'The last unfallen fortress of the realm. Marsh, wood, and stone complicate the approaches; ten waves of every banner you have ever fought come to claim it. Hold here, or hold nowhere.',
    cols: 22,
    rows: 16,
    paths: [
      [{ col: 3,  row: 0  }, { col: 11, row: 9 }],   // top-left gate
      [{ col: 18, row: 0  }, { col: 11, row: 9 }],   // top-right gate
      [{ col: 0,  row: 8  }, { col: 11, row: 9 }],   // mid-left gate
      [{ col: 11, row: 15 }, { col: 11, row: 9 }]    // bottom-center gate
    ],
    freeform: true,
    tiles: (() => {
      const grid = grass(22, 16);
      // NW forest cluster — irregular shape
      const forestNW: [number, number][] = [
        [0, 2], [1, 2], [2, 2],
        [0, 3], [1, 3],
        [0, 4],
        [6, 0], [7, 0], [6, 1]
      ];
      setTiles(grid, forestNW, 'forest');
      // SE water pond — small irregular body of water (unwalkable)
      const pond: [number, number][] = [
        [16, 11], [17, 11], [18, 11],
        [16, 12], [17, 12], [18, 12], [19, 12],
        [17, 13], [18, 13]
      ];
      setTiles(grid, pond, 'water');
      // Forest fringe around the pond
      setTiles(grid, [[15, 12], [19, 13], [16, 14]], 'forest');
      // Far-corner forest decorations
      setTiles(grid, [
        [21, 0], [21, 1], [20, 0],
        [0, 15], [1, 15], [0, 14],
        [21, 15], [20, 15], [21, 14]
      ], 'forest');
      // Stone clusters scattered as anchors
      setTiles(grid, [
        // North-mid cluster (between gates 0 and 1)
        [10, 3], [11, 3], [12, 3],
        // West-side cluster (south of gate 2)
        [3, 11], [4, 11], [3, 12],
        // East-side cluster
        [14, 6], [15, 6],
        // South cluster (above gate 3)
        [9, 13], [12, 13], [13, 13]
      ], 'stone');
      return grid;
    })(),
    startResources: { wood: 200, gold: 160, stone: 150, food: 180 },
    village: {
      count: 12,
      roles: { wood: 4, food: 3, gold: 3, stone: 2 },
      tickSeconds: 3
    },
    waves: [
      // 1: gentle opener
      { spawns: [
        { enemyId: 'militia', count: 7, interval: 0.6, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 7, interval: 0.6, delay: 0, pathIndex: 1 }
      ]},
      // 2: all four gates, militia
      { spawns: [
        { enemyId: 'militia', count: 5, interval: 0.6, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 5, interval: 0.6, delay: 0, pathIndex: 1 },
        { enemyId: 'militia', count: 5, interval: 0.6, delay: 0, pathIndex: 2 },
        { enemyId: 'militia', count: 5, interval: 0.6, delay: 0, pathIndex: 3 }
      ]},
      // 3: skirmishers + scouts
      { spawns: [
        { enemyId: 'skirmisher', count: 12, interval: 0.3, delay: 0, pathIndex: 0 },
        { enemyId: 'skirmisher', count: 12, interval: 0.3, delay: 0, pathIndex: 1 },
        { enemyId: 'scoutCavalry', count: 8, interval: 0.4, delay: 4, pathIndex: 2 },
        { enemyId: 'scoutCavalry', count: 8, interval: 0.4, delay: 4, pathIndex: 3 }
      ]},
      // 4: first sappers — your maze had better be deep
      { spawns: [
        { enemyId: 'sapper', count: 4, interval: 1.2, delay: 0, pathIndex: 0 },
        { enemyId: 'sapper', count: 4, interval: 1.2, delay: 0, pathIndex: 1 },
        { enemyId: 'sapper', count: 4, interval: 1.2, delay: 0, pathIndex: 2 },
        { enemyId: 'sapper', count: 4, interval: 1.2, delay: 0, pathIndex: 3 }
      ]},
      // 5: paladins
      { spawns: [
        { enemyId: 'paladin', count: 5, interval: 1.3, delay: 0, pathIndex: 0 },
        { enemyId: 'paladin', count: 5, interval: 1.3, delay: 0, pathIndex: 1 },
        { enemyId: 'paladin', count: 5, interval: 1.3, delay: 0, pathIndex: 2 },
        { enemyId: 'paladin', count: 5, interval: 1.3, delay: 0, pathIndex: 3 }
      ]},
      // 6: mangonels — anti-armor coverage required everywhere
      { spawns: [
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 0 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 1 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 2 },
        { enemyId: 'mangonel', count: 4, interval: 1.0, delay: 0, pathIndex: 3 }
      ]},
      // 7: sappers + scouts mixed
      { spawns: [
        { enemyId: 'sapper', count: 6, interval: 1.0, delay: 0, pathIndex: 0 },
        { enemyId: 'sapper', count: 6, interval: 1.0, delay: 0, pathIndex: 2 },
        { enemyId: 'scoutCavalry', count: 14, interval: 0.3, delay: 4, pathIndex: 1 },
        { enemyId: 'scoutCavalry', count: 14, interval: 0.3, delay: 4, pathIndex: 3 }
      ]},
      // 8: paladins + mangonels heavy
      { spawns: [
        { enemyId: 'paladin', count: 6, interval: 1.3, delay: 0, pathIndex: 0 },
        { enemyId: 'paladin', count: 6, interval: 1.3, delay: 0, pathIndex: 1 },
        { enemyId: 'mangonel', count: 5, interval: 0.9, delay: 5, pathIndex: 2 },
        { enemyId: 'mangonel', count: 5, interval: 0.9, delay: 5, pathIndex: 3 },
        { enemyId: 'sapper', count: 6, interval: 1.0, delay: 10, pathIndex: 0 }
      ]},
      // 9: chaos with breathers
      { spawns: [
        { enemyId: 'militia', count: 10, interval: 0.5, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 10, interval: 0.5, delay: 0, pathIndex: 1 },
        { enemyId: 'paladin', count: 6, interval: 1.3, delay: 5, pathIndex: 2 },
        { enemyId: 'paladin', count: 6, interval: 1.3, delay: 5, pathIndex: 3 },
        { enemyId: 'mangonel', count: 6, interval: 0.9, delay: 10, pathIndex: 0 },
        { enemyId: 'sapper', count: 6, interval: 1.0, delay: 14, pathIndex: 1 },
        { enemyId: 'skirmisher', count: 18, interval: 0.22, delay: 18, pathIndex: 2 }
      ]},
      // 10: THE LAST STAND — full bestiary from every gate
      { spawns: [
        { enemyId: 'militia', count: 12, interval: 0.45, delay: 0, pathIndex: 0 },
        { enemyId: 'militia', count: 12, interval: 0.45, delay: 0, pathIndex: 1 },
        { enemyId: 'militia', count: 12, interval: 0.45, delay: 0, pathIndex: 2 },
        { enemyId: 'militia', count: 12, interval: 0.45, delay: 0, pathIndex: 3 },
        { enemyId: 'paladin', count: 6, interval: 1.3, delay: 6, pathIndex: 0 },
        { enemyId: 'paladin', count: 6, interval: 1.3, delay: 6, pathIndex: 1 },
        { enemyId: 'paladin', count: 6, interval: 1.3, delay: 6, pathIndex: 2 },
        { enemyId: 'paladin', count: 6, interval: 1.3, delay: 6, pathIndex: 3 },
        { enemyId: 'mangonel', count: 6, interval: 0.9, delay: 12, pathIndex: 0 },
        { enemyId: 'mangonel', count: 6, interval: 0.9, delay: 12, pathIndex: 2 },
        { enemyId: 'sapper', count: 8, interval: 1.0, delay: 16, pathIndex: 1 },
        { enemyId: 'sapper', count: 8, interval: 1.0, delay: 16, pathIndex: 3 },
        { enemyId: 'scoutCavalry', count: 16, interval: 0.3, delay: 22, pathIndex: 0 },
        { enemyId: 'scoutCavalry', count: 16, interval: 0.3, delay: 22, pathIndex: 2 },
        { enemyId: 'skirmisher', count: 24, interval: 0.20, delay: 28, pathIndex: 1 },
        { enemyId: 'mangonel', count: 8, interval: 0.8, delay: 32, pathIndex: 3 }
      ]}
    ]
  }
};

export const MAP_LIST: MapDef[] = Object.values(MAPS);
