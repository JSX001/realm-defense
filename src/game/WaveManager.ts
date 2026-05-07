import { WaveDef, SpawnDef } from '../data/maps';
import { ENEMIES } from '../data/enemies';
import { Enemy } from '../entities/Enemy';
import { GridPos } from './Pathfinding';

interface ScheduledSpawn {
  enemyId: string;
  fireAt: number;
  pathIndex: number;
}

/**
 * Function the WaveManager calls each time it spawns an enemy, asking for the
 * latest A*-computed path for the given path index. Returning null means the
 * route is currently impossible (e.g., a tower has cut it off in freeform mode);
 * we drop the spawn for now (caller will see one fewer enemy this wave).
 */
export type PathProvider = (pathIndex: number, enemyId: string) => GridPos[] | null;

export class WaveManager {
  private waves: WaveDef[];
  private pathProvider: PathProvider;
  private hpMultiplier: number;
  private currentWaveIdx = -1;
  private waveTime = 0;
  private schedule: ScheduledSpawn[] = [];
  private waveActive = false;

  constructor(waves: WaveDef[], pathProvider: PathProvider, hpMultiplier = 1) {
    this.waves = waves;
    this.pathProvider = pathProvider;
    this.hpMultiplier = hpMultiplier;
  }

  startNextWave(): boolean {
    if (this.currentWaveIdx + 1 >= this.waves.length) return false;
    this.currentWaveIdx++;
    this.waveTime = 0;
    this.schedule = [];
    const wave = this.waves[this.currentWaveIdx];
    for (const group of wave.spawns) {
      for (let i = 0; i < group.count; i++) {
        this.schedule.push({
          enemyId: group.enemyId,
          fireAt: group.delay + i * group.interval,
          pathIndex: group.pathIndex ?? 0
        });
      }
    }
    this.schedule.sort((a, b) => a.fireAt - b.fireAt);
    this.waveActive = true;
    return true;
  }

  update(dt: number): Enemy[] {
    if (!this.waveActive) return [];
    this.waveTime += dt;
    const spawned: Enemy[] = [];
    while (this.schedule.length > 0 && this.schedule[0].fireAt <= this.waveTime) {
      const next = this.schedule.shift()!;
      const def = ENEMIES[next.enemyId];
      const path = this.pathProvider(next.pathIndex, next.enemyId);
      if (def && path && path.length > 0) {
        spawned.push(new Enemy(def, path, this.hpMultiplier));
      }
      // If path is null (no route exists), we drop the spawn. Future round
      // will revisit this for freeform maps.
    }
    return spawned;
  }

  isWaveSpawnComplete(): boolean {
    return this.waveActive && this.schedule.length === 0;
  }

  endWave(): void {
    this.waveActive = false;
  }

  isLastWave(): boolean {
    return this.currentWaveIdx >= this.waves.length - 1;
  }

  getCurrentWave(): number {
    return this.currentWaveIdx;
  }

  getTotalWaves(): number {
    return this.waves.length;
  }

  /**
   * Returns the spawn list for the wave that will start next, or null if
   * no more waves remain. Used by the HUD to telegraph upcoming threats.
   */
  getNextWaveSpawns(): SpawnDef[] | null {
    const next = this.currentWaveIdx + 1;
    if (next >= this.waves.length) return null;
    return this.waves[next].spawns;
  }

  reset(): void {
    this.currentWaveIdx = -1;
    this.waveTime = 0;
    this.schedule = [];
    this.waveActive = false;
  }
}
