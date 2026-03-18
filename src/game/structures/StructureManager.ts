import Matter from 'matter-js';
import { GridPowerSummary, Vector2 } from '../../types/GameTypes';
import { Structure } from './Structure';
import { StructureCore } from './StructureCore';

/**
 * Manages the lifecycle of all Structure instances in the world.
 * Handles spawning, per-frame updates, and teardown.
 */
export class StructureManager {
  private structures: Structure[] = [];
  private addBodyToWorld: (body: Matter.Body) => void;
  private removeBodyFromWorld: (body: Matter.Body) => void;

  constructor(
    addBodyToWorld: (body: Matter.Body) => void,
    removeBodyFromWorld: (body: Matter.Body) => void,
  ) {
    this.addBodyToWorld = addBodyToWorld;
    this.removeBodyFromWorld = removeBodyFromWorld;
  }

  /** Spawn the Core structure for a team at the given position. */
  public spawnCore(position: Vector2, team: number): StructureCore {
    const core = new StructureCore(position, team);
    this.addBodyToWorld(core.body);
    this.structures.push(core);
    return core;
  }

  /** Per-frame update — remove destroyed structures. */
  public update(_deltaTimeMs: number): void {
    for (let i = this.structures.length - 1; i >= 0; i--) {
      if (this.structures[i].isDestroyed()) {
        this.removeBodyFromWorld(this.structures[i].body);
        this.structures.splice(i, 1);
      }
    }
  }

  /** Return all structures (for rendering and UI). */
  public getStructures(): Structure[] {
    return this.structures;
  }

  /** Return the Core for a given team, or null. */
  public getTeamCore(team: number): StructureCore | null {
    for (const s of this.structures) {
      if (s instanceof StructureCore && s.team === team) return s;
    }
    return null;
  }

  /** Get a grid power summary for a team via its Core. */
  public getTeamGridSummary(team: number): GridPowerSummary | null {
    const core = this.getTeamCore(team);
    if (!core) return null;
    return core.getGridSummary(this.structures);
  }

  /** Tear down all structures and remove their bodies from the world. */
  public dispose(): void {
    for (const s of this.structures) {
      this.removeBodyFromWorld(s.body);
    }
    this.structures = [];
  }
}
