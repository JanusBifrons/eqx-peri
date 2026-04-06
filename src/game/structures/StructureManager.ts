import Matter from 'matter-js';
import { DECONSTRUCTION_RATE_KG, GridPowerSummary, StructureType, Vector2, SENSOR_DEPOSIT_DWELL_MS, STRUCTURE_DEFINITIONS, OreType } from '../../types/GameTypes';
import { Structure } from './Structure';
import { StructureCore } from './StructureCore';
import { StructureTurret } from './StructureTurret';
import { StructureAssemblyYard } from './StructureAssemblyYard';
import { StructureManufacturer } from './StructureManufacturer';
import { StructureRecycler } from './StructureRecycler';
import { StructureMiningPlatform } from './StructureMiningPlatform';
import { GridManager } from './GridManager';
import { Assembly } from '../core/Assembly';
import { BeamFireSpec } from '../weapons/BeamSystem';

/** Structure types that are turrets and need the StructureTurret subclass. */
const TURRET_TYPES: ReadonlySet<StructureType> = new Set(['SmallTurret', 'MediumTurret', 'LargeTurret']);

/**
 * Manages the lifecycle of all Structure instances in the world.
 * Handles spawning, per-frame updates, teardown, and delegates
 * networking/routing to the GridManager.
 */
/** Callback invoked when an Assembly Yard has built a ship. */
export type ShipSpawnCallback = (yard: StructureAssemblyYard) => void;

/** Sensor area deposit state — tracks how long an assembly has been inside a structure's sensor zone. */
interface SensorDwellState {
  structureId: string;
  assemblyId: string;
  enterTime: number;    // ms timestamp when assembly first entered
  depositing: boolean;  // true when dwell threshold reached and actively transferring
}

export class StructureManager {
  private structures: Structure[] = [];
  private addBodyToWorld: (body: Matter.Body) => void;
  private removeBodyFromWorld: (body: Matter.Body) => void;
  public readonly gridManager: GridManager = new GridManager();
  private onShipSpawn: ShipSpawnCallback | null = null;
  private asteroidBodiesGetter: (() => Matter.Body[]) | null = null;

  /** Tracks assemblies dwelling inside sensor areas (key = `structureId:assemblyId`). */
  private sensorDwells: Map<string, SensorDwellState> = new Map();

  /** Mining beam fire specs produced this frame — read by GameEngine to route to BeamSystem. */
  private miningBeamSpecs: BeamFireSpec[] = [];

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

  /** Set the getter for asteroid bodies (for mining laser targeting). */
  public setAsteroidBodiesGetter(getter: () => Matter.Body[]): void {
    this.asteroidBodiesGetter = getter;
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
    } else if (type === 'Manufacturer') {
      structure = new StructureManufacturer(position, team);
    } else if (type === 'Recycler') {
      structure = new StructureRecycler(position, team);
    } else if (type === 'MiningPlatform') {
      structure = new StructureMiningPlatform(position, team);
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

    // Tick deconstruction — structures being deconstructed return resources
    for (let i = this.structures.length - 1; i >= 0; i--) {
      const s = this.structures[i];
      if (!s.isDeconstructing) continue;
      const result = s.tickDeconstruction(DECONSTRUCTION_RATE_KG);
      if (result === -1) {
        // Deconstruction complete — remove the structure
        this.gridManager.removeStructure(s);
        this.removeBodyFromWorld(s.body);
        this.structures.splice(i, 1);
      }
    }

    // Update grid manager (topology rebuild, resource transfer pulses)
    this.gridManager.update(deltaTimeMs, this.structures);

    // Build obstacle bodies for LOS checks (asteroids + all structure bodies)
    const now = Date.now();
    const asteroidBodies = this.asteroidBodiesGetter?.() ?? [];
    const obstacleBodies: Matter.Body[] = [...asteroidBodies];
    for (const s of this.structures) obstacleBodies.push(s.body);

    // Tick turrets — collect any lasers they fire
    const newLasers: Matter.Body[] = [];
    for (const s of this.structures) {
      if (s instanceof StructureTurret) {
        const summary = this.gridManager.getGridPowerSummary(s, this.structures);
        const lasers = s.updateTurret(deltaTimeMs, now, assemblies, summary, obstacleBodies);
        for (const l of lasers) newLasers.push(l);
      }
    }

    // Tick assembly yards — prune dead ships, trigger builds
    for (const s of this.structures) {
      if (s instanceof StructureAssemblyYard && s.isOperational()) {
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

    // Tick manufacturers — consume materials, produce parts
    for (const s of this.structures) {
      if (s instanceof StructureManufacturer && s.isOperational()) {
        const summary = this.gridManager.getGridPowerSummary(s, this.structures);
        s.tickBuild(summary);
      }
    }

    // Tick recyclers — process scrap into recovered materials
    for (const s of this.structures) {
      if (s instanceof StructureRecycler && s.isOperational()) {
        const summary = this.gridManager.getGridPowerSummary(s, this.structures);
        s.tickProcess(summary);
      }
    }

    // Tick mining platforms — acquire asteroids and produce beam specs
    this.miningBeamSpecs = [];
    for (const s of this.structures) {
      if (s instanceof StructureMiningPlatform) {
        const summary = this.gridManager.getGridPowerSummary(s, this.structures);
        const specs = s.updateTurrets(deltaTimeMs, now, asteroidBodies, summary, obstacleBodies);
        for (const spec of specs) this.miningBeamSpecs.push(spec);
      }
    }

    // Process sensor area deposits (Refinery ore drop-off)
    this.processSensorAreas(assemblies);

    return newLasers;
  }

  // ── Sensor area deposit logic ──────────────────────────────────────────

  /**
   * Check which assemblies are inside a structure's sensor area.
   * When an assembly with cargo dwells for SENSOR_DEPOSIT_DWELL_MS, transfer ore.
   */
  private processSensorAreas(assemblies: Assembly[]): void {
    const now = Date.now();
    const activeKeys = new Set<string>();

    for (const s of this.structures) {
      const def = STRUCTURE_DEFINITIONS[s.type];
      if (!def.sensorRadius || !s.isOperational()) continue;

      const sensorRadius = def.sensorRadius;
      const sx = s.body.position.x;
      const sy = s.body.position.y;

      for (const assembly of assemblies) {
        if (assembly.destroyed || assembly.getTeam() !== s.team) continue;
        if (!assembly.hasCargoHold() || assembly.getCargoTotal() <= 0) continue;

        const ax = assembly.rootBody.position.x;
        const ay = assembly.rootBody.position.y;
        const dist = Math.hypot(ax - sx, ay - sy);
        if (dist > sensorRadius) continue;

        const key = `${s.id}:${assembly.id}`;
        activeKeys.add(key);

        let state = this.sensorDwells.get(key);
        if (!state) {
          state = { structureId: s.id, assemblyId: assembly.id, enterTime: now, depositing: false };
          this.sensorDwells.set(key, state);
        }

        // Check dwell threshold
        if (now - state.enterTime >= SENSOR_DEPOSIT_DWELL_MS) {
          state.depositing = true;
          // Transfer all ore from assembly cargo to structure inventory
          const cargoItems = assembly.getCargoItems();
          for (const [type, amount] of cargoItems) {
            if (Structure.isOreType(type)) {
              const removed = assembly.removeFromCargo(type, amount);
              if (removed > 0) {
                s.addToInventory(type as OreType, removed);
              }
            }
          }
        }
      }
    }

    // Prune stale entries (assembly left the sensor area)
    for (const key of this.sensorDwells.keys()) {
      if (!activeKeys.has(key)) {
        this.sensorDwells.delete(key);
      }
    }
  }

  /**
   * Get the current sensor dwell state for rendering.
   * Returns entries with structure position, sensor radius, and depositing flag.
   */
  public getSensorAreaStates(): { structure: Structure; assemblyInside: boolean; depositing: boolean; sensorRadius: number }[] {
    const results: { structure: Structure; assemblyInside: boolean; depositing: boolean; sensorRadius: number }[] = [];
    for (const s of this.structures) {
      const def = STRUCTURE_DEFINITIONS[s.type];
      if (!def.sensorRadius || !s.isOperational()) continue;

      let assemblyInside = false;
      let depositing = false;
      for (const state of this.sensorDwells.values()) {
        if (state.structureId === s.id) {
          assemblyInside = true;
          if (state.depositing) depositing = true;
        }
      }
      results.push({ structure: s, assemblyInside, depositing, sensorRadius: def.sensorRadius });
    }
    return results;
  }

  /** Return mining beam specs generated this frame. */
  public getMiningBeamSpecs(): BeamFireSpec[] {
    return this.miningBeamSpecs;
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
