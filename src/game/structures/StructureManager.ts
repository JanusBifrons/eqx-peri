import Matter from 'matter-js';
import { GridPowerSummary, StructureType, Vector2 } from '../../types/GameTypes';
import { Structure } from './Structure';
import { StructureCore } from './StructureCore';
import { StructureTurret } from './StructureTurret';
import { StructureAssemblyYard } from './StructureAssemblyYard';
import { GridManager } from './GridManager';
import { Assembly } from '../core/Assembly';

/** Structure types that are turrets and need the StructureTurret subclass. */
const TURRET_TYPES: ReadonlySet<StructureType> = new Set(['SmallTurret', 'MediumTurret', 'LargeTurret']);

/**
 * Manages the lifecycle of all Structure instances in the world.
 * Handles spawning, per-frame updates, teardown, and delegates
 * networking/routing to the GridManager.
 */
/** Callback invoked when an Assembly Yard has built a ship. */
export type ShipSpawnCallback = (yard: StructureAssemblyYard) => void;

export class StructureManager {
  private structures: Structure[] = [];
  private addBodyToWorld: (body: Matter.Body) => void;
  private removeBodyFromWorld: (body: Matter.Body) => void;
  public readonly gridManager: GridManager = new GridManager();
  private onShipSpawn: ShipSpawnCallback | null = null;

  constructor(
    addBodyToWorld: (body: Matter.Body) => void,
    removeBodyFromWorld: (body: Matter.Body) => void,
  ) {
    this.addBodyToWorld = addBodyToWorld;
    this.removeBodyFromWorld = removeBodyFromWorld;
    this.gridManager.setWorldCallbacks(addBodyToWorld, removeBodyFromWorld);
  }

  /** Set the callback for when an Assembly Yard completes a ship build. */
  public setShipSpawnCallback(callback: ShipSpawnCallback): void {
    this.onShipSpawn = callback;
  }

  /** Spawn the Core structure for a team at the given position. */
  public spawnCore(position: Vector2, team: number): StructureCore {
    const core = new StructureCore(position, team);
    this.addBodyToWorld(core.body);
    this.structures.push(core);
    this.gridManager.registerStructure(core);
    return core;
  }

  /** Spawn any structure type at the given position. */
  public spawnStructure(type: StructureType, position: Vector2, team: number): Structure {
    let structure: Structure;
    if (type === 'Core') {
      structure = new StructureCore(position, team);
    } else if (TURRET_TYPES.has(type)) {
      structure = new StructureTurret(type, position, team);
    } else if (type === 'AssemblyYard') {
      structure = new StructureAssemblyYard(position, team);
    } else {
      structure = new Structure(type, position, team);
    }
    this.addBodyToWorld(structure.body);
    this.structures.push(structure);
    this.gridManager.registerStructure(structure);
    return structure;
  }

  /**
   * Per-frame update — remove destroyed structures, update grid manager,
   * tick turrets. Returns any laser bodies created by turrets this frame.
   */
  public update(deltaTimeMs: number, assemblies: Assembly[]): Matter.Body[] {
    // Remove destroyed structures and sever their connections
    for (let i = this.structures.length - 1; i >= 0; i--) {
      if (this.structures[i].isDestroyed()) {
        const dead = this.structures[i];
        this.gridManager.removeStructure(dead);
        this.removeBodyFromWorld(dead.body);
        this.structures.splice(i, 1);
      }
    }

    // Update grid manager (topology rebuild, resource transfer pulses)
    this.gridManager.update(deltaTimeMs, this.structures);

    // Tick turrets — collect any lasers they fire
    const now = Date.now();
    const newLasers: Matter.Body[] = [];
    for (const s of this.structures) {
      if (s instanceof StructureTurret) {
        const summary = this.gridManager.getGridPowerSummary(s, this.structures);
        const lasers = s.updateTurret(deltaTimeMs, now, assemblies, summary);
        for (const l of lasers) newLasers.push(l);
      }
    }

    // Tick assembly yards — prune dead ships, trigger builds
    for (const s of this.structures) {
      if (s instanceof StructureAssemblyYard && s.isConstructed) {
        // Prune ships that no longer exist
        s.activeShipIds = s.activeShipIds.filter(id =>
          assemblies.some(a => a.id === id && !a.destroyed),
        );

        const summary = this.gridManager.getGridPowerSummary(s, this.structures);
        if (s.tickBuild(summary) && this.onShipSpawn) {
          this.onShipSpawn(s);
          s.resetBuild();
        }
      }
    }

    return newLasers;
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

  /** Get a grid power summary for a team via its Core, using the GridManager. */
  public getTeamGridSummary(team: number): GridPowerSummary | null {
    const core = this.getTeamCore(team);
    if (!core) return null;
    return this.gridManager.getGridPowerSummary(core, this.structures);
  }

  /** Tear down all structures and remove their bodies from the world. */
  public dispose(): void {
    for (const s of this.structures) {
      this.removeBodyFromWorld(s.body);
    }
    this.structures = [];
  }
}
