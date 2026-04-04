import { ObjectiveItem, TCU_CAPTURE_DURATION_MS } from '../../types/GameTypes';
import { Structure } from '../structures/Structure';
import { WaveManager } from './WaveManager';

/** Result returned by ObjectivesManager.update() each frame. */
export interface ObjectivesState {
  objectivesPhase: number;
  objectiveItems: ObjectiveItem[];
  /** Milliseconds remaining until sector is captured, or null if TCU not yet fully built. */
  tcuCountdownMs: number | null;
  sectorCaptured: boolean;
}

/**
 * Guides the player through the sector conquest objectives.
 * Phases:
 *   0 — Build a Connector AND a Mining Laser
 *   1 — Build a Refinery
 *   2 — Build a Turret (any type) → activates WaveManager
 *   3 — Build a Territory Control Unit → starts 5-minute capture countdown
 *   4 — Defend until countdown reaches zero → victory
 */
export class ObjectivesManager {
  private phase = 0;
  private readonly waveManager: WaveManager;
  private readonly onPhaseChange: (phase: number) => void;
  private readonly onVictory: () => void;
  /** Timestamp (performance.now()) when the TCU was completed. */
  private tcuCompletedAt: number | null = null;

  constructor(
    waveManager: WaveManager,
    onPhaseChange: (phase: number) => void,
    onVictory: () => void,
  ) {
    this.waveManager = waveManager;
    this.onPhaseChange = onPhaseChange;
    this.onVictory = onVictory;
  }

  /** Call every frame. Returns the full objectives state to push to the store. */
  update(deltaTimeMs: number, structures: Structure[], now: number): ObjectivesState {
    void deltaTimeMs; // not currently needed but kept for API consistency

    switch (this.phase) {
      case 0:
        return this.tickPhase0(structures, now);
      case 1:
        return this.tickPhase1(structures, now);
      case 2:
        return this.tickPhase2(structures, now);
      case 3:
        return this.tickPhase3(structures, now);
      case 4:
        return this.tickPhase4(now);
      default:
        return this.buildState([], null, false);
    }
  }

  // ── Phase tick methods ──────────────────────────────────────────────────────

  private tickPhase0(structures: Structure[], now: number): ObjectivesState {
    const hasConnector = this.hasBuilt(structures, 'Connector');
    const hasMiningLaser = this.hasBuilt(structures, 'StructureMiningLaser');
    const items: ObjectiveItem[] = [
      { label: 'Build a Connector', done: hasConnector },
      { label: 'Build a Mining Laser', done: hasMiningLaser },
    ];
    if (hasConnector && hasMiningLaser) {
      this.advancePhase(1, now);
    }
    return this.buildState(items, null, false);
  }

  private tickPhase1(structures: Structure[], now: number): ObjectivesState {
    const hasRefinery = this.hasBuilt(structures, 'Refinery');
    const items: ObjectiveItem[] = [
      { label: 'Build a Connector', done: true },
      { label: 'Build a Mining Laser', done: true },
      { label: 'Build a Refinery', done: hasRefinery },
    ];
    if (hasRefinery) {
      this.advancePhase(2, now);
    }
    return this.buildState(items, null, false);
  }

  private tickPhase2(structures: Structure[], now: number): ObjectivesState {
    const hasTurret = this.hasBuilt(structures, 'SmallTurret') ||
                      this.hasBuilt(structures, 'MediumTurret') ||
                      this.hasBuilt(structures, 'LargeTurret');
    const items: ObjectiveItem[] = [
      { label: 'Build a Connector', done: true },
      { label: 'Build a Mining Laser', done: true },
      { label: 'Build a Refinery', done: true },
      { label: 'Build a defense turret', done: hasTurret },
    ];
    if (hasTurret) {
      this.waveManager.activate();
      this.advancePhase(3, now);
    }
    return this.buildState(items, null, false);
  }

  private tickPhase3(structures: Structure[], now: number): ObjectivesState {
    const hasTCU = this.hasBuilt(structures, 'TerritoryControlUnit');
    if (hasTCU && this.tcuCompletedAt === null) {
      this.tcuCompletedAt = now;
    }
    const items: ObjectiveItem[] = [
      { label: 'Build a Connector', done: true },
      { label: 'Build a Mining Laser', done: true },
      { label: 'Build a Refinery', done: true },
      { label: 'Build a defense turret', done: true },
      { label: 'Construct a Territory Control Unit', done: hasTCU },
    ];
    if (this.tcuCompletedAt !== null) {
      const elapsed = now - this.tcuCompletedAt;
      const remaining = Math.max(0, TCU_CAPTURE_DURATION_MS - elapsed);
      if (remaining <= 0) {
        this.advancePhase(4, now);
        this.onVictory();
        return this.buildState(items, 0, true);
      }
      return this.buildState(items, remaining, false);
    }
    return this.buildState(items, null, false);
  }

  private tickPhase4(now: number): ObjectivesState {
    void now;
    return this.buildState([], 0, true);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private hasBuilt(structures: Structure[], type: string): boolean {
    return structures.some(s => s.type === type && s.isConstructed);
  }

  private advancePhase(next: number, _now: number): void {
    this.phase = next;
    this.onPhaseChange(next);
  }

  private buildState(
    objectiveItems: ObjectiveItem[],
    tcuCountdownMs: number | null,
    sectorCaptured: boolean,
  ): ObjectivesState {
    return { objectivesPhase: this.phase, objectiveItems, tcuCountdownMs, sectorCaptured };
  }
}
