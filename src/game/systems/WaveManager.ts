import { IncomingWaveInfo, Vector2 } from '../../types/GameTypes';

// ── Wave scheduling constants ─────────────────────────────────────────────────
const WAVE_INTERVAL_MIN_MS = 90_000;   // Minimum ms between waves
const WAVE_INTERVAL_MAX_MS = 180_000;  // Maximum ms between waves
const WAVE_SPAWN_RADIUS_MIN = 3_500;   // Min world-unit distance from core to spawn
const WAVE_SPAWN_RADIUS_MAX = 4_500;   // Max world-unit distance from core to spawn
const WAVE_BASE_COUNT = 2;             // Ships in the first wave
const WAVE_GROWTH_RATE = 2;            // Waves between each size increase
const WAVE_MAX_COUNT = 8;              // Maximum ships per wave

/** Index into ships.json for Scout Raider (index 6) and Missile Boat (index 7). */
const SCOUT_RAIDER_INDEX = 6;
const MISSILE_BOAT_INDEX = 7;

/** Describes a wave the caller should spawn. */
export interface WaveSpec {
  ships: { shipIndex: number; count: number }[];
  spawnPosition: Vector2;
}

/**
 * Manages enemy wave scheduling and composition for Sector Conquest mode.
 * Call `activate()` once the player has completed early-game objectives.
 * Call `update(deltaTimeMs)` every game frame; it returns IncomingWaveInfo for the UI
 * and fires `onSpawnWave` when a wave is ready.
 *
 * Wave gating: the next countdown only starts after ALL ships from the previous
 * wave have been destroyed or have left (i.e. their IDs are absent from the set
 * returned by `getAliveAssemblyIds`).
 */
export class WaveManager {
  private isActive = false;
  private waveNumber = 0;
  private nextWaveCountdownMs = 0;  // initialised in activate()

  /** IDs of assemblies spawned in the most recent wave. Null while counting down. */
  private activeWaveIds: Set<string> | null = null;
  /** True while we're waiting for the previous wave to be cleared. */
  private awaitingWaveClear = false;

  private readonly corePosition: Vector2;
  /** Returns spawned assembly IDs so WaveManager can track wave completion. */
  private readonly onSpawnWave: (spec: WaveSpec) => string[];
  /** Returns the set of currently-alive assembly IDs (called each frame while waiting). */
  private readonly getAliveAssemblyIds: () => Set<string>;

  constructor(
    corePosition: Vector2,
    onSpawnWave: (spec: WaveSpec) => string[],
    getAliveAssemblyIds: () => Set<string>,
  ) {
    this.corePosition = corePosition;
    this.onSpawnWave = onSpawnWave;
    this.getAliveAssemblyIds = getAliveAssemblyIds;
  }

  /** Start the wave system. The first wave arrives after one random interval. */
  activate(): void {
    if (this.isActive) return;
    this.isActive = true;
    this.nextWaveCountdownMs = this.randomInterval();
  }

  /**
   * Update per-frame. `deltaTimeMs` is the frame delta in milliseconds.
   * Returns IncomingWaveInfo if a wave is approaching, or null otherwise
   * (both when a wave is active and when waiting for the wave to clear).
   */
  update(deltaTimeMs: number): IncomingWaveInfo | null {
    if (!this.isActive) return null;

    // Waiting for the previous wave to be fully destroyed before starting the next timer.
    if (this.awaitingWaveClear) {
      const alive = this.getAliveAssemblyIds();
      const allClear = !this.activeWaveIds || [...this.activeWaveIds].every(id => !alive.has(id));
      if (allClear) {
        this.awaitingWaveClear = false;
        this.activeWaveIds = null;
        this.nextWaveCountdownMs = this.randomInterval();
      }
      return null; // No ETA shown while clearing
    }

    this.nextWaveCountdownMs -= deltaTimeMs;

    if (this.nextWaveCountdownMs <= 0) {
      this.spawnNextWave();
      return null; // Brief gap before awaiting-clear state provides next info
    }

    return {
      etaMs: this.nextWaveCountdownMs,
      ships: this.buildWaveComposition(this.waveNumber + 1),
    };
  }

  private spawnNextWave(): void {
    this.waveNumber++;
    const composition = this.buildWaveComposition(this.waveNumber);
    const angle = Math.random() * Math.PI * 2;
    const radius = WAVE_SPAWN_RADIUS_MIN + Math.random() * (WAVE_SPAWN_RADIUS_MAX - WAVE_SPAWN_RADIUS_MIN);
    const spawnPosition: Vector2 = {
      x: this.corePosition.x + Math.cos(angle) * radius,
      y: this.corePosition.y + Math.sin(angle) * radius,
    };

    const spawnedIds = this.onSpawnWave({
      ships: composition.map(c => ({ shipIndex: c.shipIndex, count: c.count })),
      spawnPosition,
    });
    this.activeWaveIds = new Set(spawnedIds);
    this.awaitingWaveClear = true;
  }

  private buildWaveComposition(wave: number): { name: string; shipIndex: number; count: number }[] {
    const totalShips = Math.min(
      WAVE_BASE_COUNT + Math.floor((wave - 1) / WAVE_GROWTH_RATE),
      WAVE_MAX_COUNT,
    );

    // Alternate between raider-heavy and missile-heavy waves
    if (wave % 2 === 0) {
      const raiderCount = Math.ceil(totalShips * 0.7);
      const missileCount = totalShips - raiderCount;
      return [
        { name: 'Scout Raider', shipIndex: SCOUT_RAIDER_INDEX, count: raiderCount },
        ...(missileCount > 0 ? [{ name: 'Missile Boat', shipIndex: MISSILE_BOAT_INDEX, count: missileCount }] : []),
      ];
    } else {
      const missileCount = Math.ceil(totalShips * 0.6);
      const raiderCount = totalShips - missileCount;
      return [
        { name: 'Missile Boat', shipIndex: MISSILE_BOAT_INDEX, count: missileCount },
        ...(raiderCount > 0 ? [{ name: 'Scout Raider', shipIndex: SCOUT_RAIDER_INDEX, count: raiderCount }] : []),
      ];
    }
  }

  private randomInterval(): number {
    return WAVE_INTERVAL_MIN_MS + Math.random() * (WAVE_INTERVAL_MAX_MS - WAVE_INTERVAL_MIN_MS);
  }
}
