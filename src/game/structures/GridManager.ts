import Matter from 'matter-js';
import { CONNECTION_MAX_RANGE, GridPowerSummary, TRANSFER_PULSE_MS, SHIELD_WALL_POWER_SPIKE_MS, OreType, REFINING_TABLES, REFINERY_PROCESS_RATE_KG, CONSTRUCTION_RATE_KG, REPAIR_RATE_KG, MaterialType } from '../../types/GameTypes';
import { Structure } from './Structure';
import { Connection } from './Connection';
import { ShieldWall } from './ShieldWall';

/** Cached A* route between two structures. */
interface CachedRoute {
  path: Structure[];       // ordered node list (source → destination)
  connections: Connection[]; // connections along the path
}

/**
 * Manages the network graph of structures and connections.
 * Handles connected components, A* routing, power aggregation,
 * and pulse-based resource transfer.
 */
export class GridManager {
  private connections: Connection[] = [];
  /** adjacency: structureId → set of connections */
  private adjacency: Map<string, Connection[]> = new Map();
  /** Connected component ID per structure (structureId → componentId) */
  private componentOf: Map<string, number> = new Map();
  /** All structures in each component (componentId → structure[]) */
  private components: Map<number, Structure[]> = new Map();
  private topologyDirty: boolean = true;
  private routeCache: Map<string, CachedRoute | null> = new Map();
  private lastPulseTime: number = 0;

  /** Shield walls keyed by connection ID. */
  private shieldWalls: Map<string, ShieldWall> = new Map();
  private addBodyToWorld: ((body: Matter.Body) => void) | null = null;
  private removeBodyFromWorld: ((body: Matter.Body) => void) | null = null;

  /** Set the physics world callbacks for shield wall body management. */
  public setWorldCallbacks(
    addBody: (body: Matter.Body) => void,
    removeBody: (body: Matter.Body) => void,
  ): void {
    this.addBodyToWorld = addBody;
    this.removeBodyFromWorld = removeBody;
  }

  // ── Connection management ──────────────────────────────────────────────

  /** Get the number of connections a structure currently has. */
  public getConnectionCount(structure: Structure): number {
    return this.adjacency.get(structure.id)?.length ?? 0;
  }

  /** Can a new connection be added to this structure? */
  public canAddConnection(structure: Structure): boolean {
    return this.getConnectionCount(structure) < structure.definition.maxConnections;
  }

  /** Are the two structures already connected? */
  public areConnected(a: Structure, b: Structure): boolean {
    const conns = this.adjacency.get(a.id);
    if (!conns) return false;
    return conns.some(c => c.nodeA === b || c.nodeB === b);
  }

  /** Check whether two structures can be linked.
   *  Rules:
   *  - At least one side must be a Connector, OR both sides are ShieldFence.
   *  - ShieldFence can only connect to Connectors or other ShieldFences.
   *  - All other structures connect only to Connectors. */
  public canConnect(a: Structure, b: Structure): boolean {
    if (a === b) return false;
    if (this.areConnected(a, b)) return false;

    // Connection type validation
    const aIsConnector = a.type === 'Connector';
    const bIsConnector = b.type === 'Connector';
    const aIsFence = a.type === 'ShieldFence';
    const bIsFence = b.type === 'ShieldFence';

    // ShieldFence can only connect to Connectors or other ShieldFences
    if (aIsFence && !bIsConnector && !bIsFence) return false;
    if (bIsFence && !aIsConnector && !aIsFence) return false;

    // General rule: at least one Connector, OR both are ShieldFence
    if (!aIsConnector && !bIsConnector && !(aIsFence && bIsFence)) return false;

    if (!this.canAddConnection(a) || !this.canAddConnection(b)) return false;
    const dx = a.body.position.x - b.body.position.x;
    const dy = a.body.position.y - b.body.position.y;
    if (Math.sqrt(dx * dx + dy * dy) > CONNECTION_MAX_RANGE) return false;
    return true;
  }

  /** Create a connection between two structures. Returns the connection or null if invalid. */
  public connect(a: Structure, b: Structure): Connection | null {
    if (!this.canConnect(a, b)) return null;
    const conn = new Connection(a, b);
    this.connections.push(conn);
    this.getOrCreateAdj(a.id).push(conn);
    this.getOrCreateAdj(b.id).push(conn);
    this.topologyDirty = true;

    // If both sides are ShieldFence AND both are constructed, spawn a physical wall.
    // Unconstructed fences get their wall created later via updateShieldWallActivation().
    if (a.type === 'ShieldFence' && b.type === 'ShieldFence'
        && a.isConstructed && b.isConstructed && this.addBodyToWorld) {
      const wall = new ShieldWall(a, b);
      this.shieldWalls.set(conn.id, wall);
      this.addBodyToWorld(wall.body);
    }

    return conn;
  }

  /** Remove a specific connection and its shield wall (if any). */
  public disconnect(conn: Connection): void {
    this.connections = this.connections.filter(c => c !== conn);
    this.removeFromAdj(conn.nodeA.id, conn);
    this.removeFromAdj(conn.nodeB.id, conn);
    this.topologyDirty = true;

    // Remove associated shield wall
    const wall = this.shieldWalls.get(conn.id);
    if (wall && this.removeBodyFromWorld) {
      this.removeBodyFromWorld(wall.body);
      this.shieldWalls.delete(conn.id);
    }
  }

  /** Remove all connections to a structure (e.g., when it's destroyed). */
  public removeStructure(structure: Structure): void {
    const conns = this.adjacency.get(structure.id);
    if (conns) {
      // Copy to avoid mutating while iterating
      for (const conn of [...conns]) {
        this.disconnect(conn);
      }
    }
    this.adjacency.delete(structure.id);
    this.topologyDirty = true;
  }

  /** Register a structure in the adjacency map (no connections yet). */
  public registerStructure(structure: Structure): void {
    if (!this.adjacency.has(structure.id)) {
      this.adjacency.set(structure.id, []);
      this.topologyDirty = true;
    }
  }

  // ── Topology / connected components ────────────────────────────────────

  /** Rebuild connected components via BFS. Only runs when topology has changed. */
  private rebuildComponents(allStructures: Structure[]): void {
    if (!this.topologyDirty) return;
    this.topologyDirty = false;
    this.componentOf.clear();
    this.components.clear();
    this.routeCache.clear();

    let componentId = 0;
    for (const structure of allStructures) {
      if (this.componentOf.has(structure.id)) continue;

      // BFS from this structure
      const queue: Structure[] = [structure];
      const members: Structure[] = [];
      this.componentOf.set(structure.id, componentId);

      while (queue.length > 0) {
        const current = queue.shift()!;
        members.push(current);
        // Only traverse through constructed structures — unconstructed ones are
        // reachable as destinations but cannot relay resources/power further.
        if (!current.isConstructed) continue;
        const conns = this.adjacency.get(current.id) ?? [];
        for (const conn of conns) {
          const neighbor = conn.getOtherNode(current);
          if (!this.componentOf.has(neighbor.id)) {
            this.componentOf.set(neighbor.id, componentId);
            queue.push(neighbor);
          }
        }
      }

      this.components.set(componentId, members);
      componentId++;
    }
  }

  /** Are two structures on the same grid? */
  public onSameGrid(a: Structure, b: Structure): boolean {
    const ca = this.componentOf.get(a.id);
    const cb = this.componentOf.get(b.id);
    return ca !== undefined && ca === cb;
  }

  /** Return all structures on the same grid as the given structure. */
  public getGridMembers(structure: Structure): Structure[] {
    const cid = this.componentOf.get(structure.id);
    if (cid === undefined) return [structure];
    return this.components.get(cid) ?? [structure];
  }

  // ── Power aggregation (instant, unlimited throughput) ──────────────────

  /** Aggregate power stats across the entire connected grid containing this structure. */
  public getGridPowerSummary(structure: Structure, allStructures: Structure[]): GridPowerSummary {
    this.rebuildComponents(allStructures);
    const members = this.getGridMembers(structure);
    let totalPowerOutput = 0;
    let totalPowerConsumption = 0;
    let totalCapacity = 0;
    let usedCapacity = 0;
    for (const s of members) {
      if (s.team !== structure.team) continue;
      totalPowerOutput += s.getPowerOutput();
      totalPowerConsumption += s.getPowerConsumption();
      totalCapacity += s.getStorageCapacity();
      usedCapacity += s.getInventoryTotal();
    }
    return {
      totalPowerOutput,
      totalPowerConsumption,
      netPower: totalPowerOutput - totalPowerConsumption,
      powerEfficiency: totalPowerConsumption > 0 ? Math.min(1, totalPowerOutput / totalPowerConsumption) : 1,
      totalCapacity,
      usedCapacity,
    };
  }

  // ── A* pathfinding ─────────────────────────────────────────────────────

  /** Find a route between two structures using A* with hop-count heuristic. */
  public findRoute(from: Structure, to: Structure): CachedRoute | null {
    const cacheKey = `${from.id}->${to.id}`;
    if (this.routeCache.has(cacheKey)) return this.routeCache.get(cacheKey)!;

    if (!this.onSameGrid(from, to)) {
      this.routeCache.set(cacheKey, null);
      return null;
    }

    // A* with hop count (all edges cost 1)
    const gScore = new Map<string, number>();
    const fScore = new Map<string, number>();
    const cameFrom = new Map<string, { node: Structure; conn: Connection }>();
    const openSet = new Set<string>();

    gScore.set(from.id, 0);
    fScore.set(from.id, this.heuristic(from, to));
    openSet.add(from.id);

    // We need a structure lookup by ID for reconstruction
    const structureById = new Map<string, Structure>();
    const members = this.getGridMembers(from);
    for (const m of members) structureById.set(m.id, m);

    while (openSet.size > 0) {
      // Pick node in openSet with lowest fScore
      let currentId: string | null = null;
      let bestF = Infinity;
      for (const id of openSet) {
        const f = fScore.get(id) ?? Infinity;
        if (f < bestF) { bestF = f; currentId = id; }
      }
      if (!currentId) break;

      if (currentId === to.id) {
        // Reconstruct path
        const path: Structure[] = [to];
        const connections: Connection[] = [];
        let cur = to.id;
        while (cameFrom.has(cur)) {
          const entry = cameFrom.get(cur)!;
          path.unshift(entry.node);
          connections.unshift(entry.conn);
          cur = entry.node.id;
        }
        const route: CachedRoute = { path, connections };
        this.routeCache.set(cacheKey, route);
        return route;
      }

      openSet.delete(currentId);
      const current = structureById.get(currentId)!;

      // Unconstructed structures can be destinations but cannot relay — don't expand
      if (!current.isConstructed && currentId !== to.id) continue;

      const conns = this.adjacency.get(currentId) ?? [];

      for (const conn of conns) {
        const neighbor = conn.getOtherNode(current);
        const tentativeG = (gScore.get(currentId) ?? Infinity) + 1;
        if (tentativeG < (gScore.get(neighbor.id) ?? Infinity)) {
          cameFrom.set(neighbor.id, { node: current, conn });
          gScore.set(neighbor.id, tentativeG);
          fScore.set(neighbor.id, tentativeG + this.heuristic(neighbor, to));
          openSet.add(neighbor.id);
        }
      }
    }

    this.routeCache.set(cacheKey, null);
    return null;
  }

  /** Euclidean distance heuristic (admissible for hop-count since hop ≥ 1). */
  private heuristic(a: Structure, b: Structure): number {
    const dx = a.body.position.x - b.body.position.x;
    const dy = a.body.position.y - b.body.position.y;
    // Normalize by CONNECTION_MAX_RANGE so the heuristic ≤ actual hop count
    return Math.sqrt(dx * dx + dy * dy) / CONNECTION_MAX_RANGE;
  }

  // ── Per-frame update ───────────────────────────────────────────────────

  /** Call every frame. Rebuilds topology if needed, processes transfer pulses. */
  public update(deltaTimeMs: number, allStructures: Structure[]): void {
    this.rebuildComponents(allStructures);

    // Manage shield wall stun state — reactivate walls whose stun has expired
    this.updateShieldWallStuns();

    // Create/remove shield walls based on fence construction + power state
    this.updateShieldWallActivation(allStructures);

    // Pulse-based resource transfer + construction/repair + generation
    const now = Date.now();
    if (now - this.lastPulseTime >= TRANSFER_PULSE_MS) {
      this.lastPulseTime = now;
      this.processRefining(allStructures);
      this.processResourceDistribution(allStructures);
      this.processConstructionPulse(allStructures);
    }

    // Suppress unused warning — deltaTimeMs reserved for future tick-rate-independent logic
    void deltaTimeMs;
  }

  /** Reactivate stunned shield walls whose cooldown has expired. */
  private updateShieldWallStuns(): void {
    const now = Date.now();
    for (const wall of this.shieldWalls.values()) {
      if (wall.isStunned && now >= wall.stunUntil) {
        wall.isStunned = false;
        // Only re-add body if the wall is powered — updateShieldWallActivation
        // will handle re-adding when power is restored if currently unpowered.
        if (wall.isPowered && this.addBodyToWorld) {
          this.addBodyToWorld(wall.body);
        }
      }
    }
  }

  /**
   * Create/remove shield walls based on fence construction and power state.
   * Walls only exist when BOTH fence posts are constructed.
   * Walls go offline (body removed) when grid netPower ≤ 0.
   */
  private updateShieldWallActivation(allStructures: Structure[]): void {
    for (const conn of this.connections) {
      const a = conn.nodeA;
      const b = conn.nodeB;
      if (a.type !== 'ShieldFence' || b.type !== 'ShieldFence') continue;

      const shouldExist = a.isConstructed && b.isConstructed;
      const exists = this.shieldWalls.has(conn.id);

      if (shouldExist && !exists && this.addBodyToWorld) {
        // Both posts just finished construction — spawn the wall
        const wall = new ShieldWall(a, b);
        this.shieldWalls.set(conn.id, wall);
        // Check power before adding body — don't add if unpowered
        const summary = this.getGridPowerSummary(a, allStructures);
        if (summary.netPower > 0) {
          this.addBodyToWorld(wall.body);
          wall.isPowered = true;
        } else {
          wall.isPowered = false;
        }
      } else if (!shouldExist && exists) {
        // One post was un-constructed (shouldn't normally happen, but defensive)
        const wall = this.shieldWalls.get(conn.id)!;
        if (this.removeBodyFromWorld && wall.isPowered && !wall.isStunned) {
          this.removeBodyFromWorld(wall.body);
        }
        this.shieldWalls.delete(conn.id);
      } else if (exists) {
        // Wall exists — check power state
        const wall = this.shieldWalls.get(conn.id)!;
        if (wall.isStunned) continue; // Stun takes priority, handled by updateShieldWallStuns

        const summary = this.getGridPowerSummary(a, allStructures);
        const hasPower = summary.netPower > 0;

        if (wall.isPowered && !hasPower) {
          // Power lost — take wall offline
          wall.isPowered = false;
          if (this.removeBodyFromWorld) {
            this.removeBodyFromWorld(wall.body);
          }
        } else if (!wall.isPowered && hasPower) {
          // Power restored — bring wall back online
          wall.isPowered = true;
          if (this.addBodyToWorld) {
            this.addBodyToWorld(wall.body);
          }
        }
      }
    }
  }

  /**
   * Resolve damage against a shield wall using the grid's power system.
   *
   * Step 1: If damage ≤ grid netPower → fully absorbed, no effect.
   * Step 2: If damage > netPower → excess drains Battery storedResources.
   * Step 3: If damage > netPower + battery reserves → wall is stunned.
   *
   * All damage applies a temporary power spike to the fence posts, stressing the grid.
   */
  public resolveShieldWallDamage(wall: ShieldWall, damage: number, allStructures: Structure[]): void {
    if (wall.isStunned) return;

    // Apply power spike to both fence posts — stresses the grid for the spike duration.
    // Multiple simultaneous hits stack, potentially pushing netPower negative and
    // browning out turrets / other consumers.
    wall.postA.applyPowerSpike(damage, SHIELD_WALL_POWER_SPIKE_MS);
    wall.postB.applyPowerSpike(damage, SHIELD_WALL_POWER_SPIKE_MS);

    const summary = this.getGridPowerSummary(wall.postA, allStructures);

    // Step 1: grid generation absorbs the hit entirely
    const netPower = Math.max(0, summary.netPower);
    if (damage <= netPower) return;

    // Step 2: excess drains Battery structures across the grid
    let excess = damage - netPower;
    const members = this.getGridMembers(wall.postA);

    for (const s of members) {
      if (s.team !== wall.team) continue;
      if (s.type !== 'Battery') continue;
      if (s.getInventoryTotal() <= 0) continue;

      const drain = Math.min(excess, s.getInventoryTotal());
      s.removeAnyMaterials(drain);
      excess -= drain;
      if (excess <= 0) break;
    }

    // Step 3: if batteries couldn't absorb the remainder, stun the wall
    if (excess > 0) {
      wall.stun();
      // Remove the wall body from physics so things pass through
      if (this.removeBodyFromWorld) {
        this.removeBodyFromWorld(wall.body);
      }
    }
  }

  /**
   * Automatically deliver materials to structures under construction or in need of repair.
   * Runs once per pulse alongside the regular transfer pulse.
   * Construction consumes specific materials per recipe; repair consumes any available materials.
   */
  private processConstructionPulse(allStructures: Structure[]): void {
    for (const structure of allStructures) {
      const isBuilding = structure.needsConstruction();
      const isRepairing = structure.needsRepair();
      if (!isBuilding && !isRepairing) continue;

      const members = this.getGridMembers(structure);

      if (isBuilding) {
        const recipe = structure.definition.constructionRecipe;
        if (!recipe) continue;

        const wasUnbuilt = !structure.isConstructed;
        let budgetRemaining = CONSTRUCTION_RATE_KG;

        // For each material in the recipe, pull what's still needed from grid sources
        for (const [material, recipeAmount] of Object.entries(recipe) as [MaterialType, number][]) {
          const stillNeeded = structure.getConstructionRemaining(material);
          if (stillNeeded <= 0) continue;
          const toDeliver = Math.min(stillNeeded, budgetRemaining);
          if (toDeliver <= 0) continue;

          let delivered = 0;
          for (const source of members) {
            if (source === structure) continue;
            if (source.team !== structure.team) continue;
            if (!source.isConstructed) continue;
            const sourceHas = source.getInventoryAmount(material);
            if (sourceHas <= 0) continue;
            const route = this.findRoute(source, structure);
            if (!route) continue;
            const bottleneck = Math.min(...route.connections.map(c => c.throughput));
            const pull = Math.min(toDeliver - delivered, sourceHas, bottleneck);
            if (pull <= 0) continue;
            source.removeFromInventory(material, pull);
            delivered += pull;
            for (let ci = 0; ci < route.connections.length; ci++) route.connections[ci].flashWithFlow(material, ci * 50);
            if (delivered >= toDeliver) break;
          }

          if (delivered > 0) {
            structure.deliverConstructionMaterial(material, delivered);
            budgetRemaining -= delivered;
          }
          void recipeAmount; // used via getConstructionRemaining
        }

        if (wasUnbuilt && structure.isConstructed) {
          this.topologyDirty = true;
        }
      } else {
        // Repair: deliver up to REPAIR_RATE_KG of any materials per pulse
        for (const source of members) {
          if (source === structure) continue;
          if (source.getInventoryTotal() <= 0) continue;
          if (source.team !== structure.team) continue;
          const route = this.findRoute(source, structure);
          if (!route) continue;
          const bottleneck = Math.min(...route.connections.map(c => c.throughput));
          const available = Math.min(REPAIR_RATE_KG, source.getInventoryTotal(), bottleneck);
          if (available <= 0) continue;
          const consumed = structure.applyRepairResources(available);
          if (consumed > 0) {
            source.removeAnyMaterials(consumed);
            for (let ci = 0; ci < route.connections.length; ci++) route.connections[ci].flashWithFlow(null, ci * 50);
          }
          break; // one source per pulse for repair
        }
      }
    }
  }

  /**
   * Move produced materials from producer structures (Refinery, Recycler)
   * into storage hubs (Core, Battery) across the grid.
   * Only producers push — storage hubs never redistribute their own inventory,
   * preventing infinite ping-pong between structures with capacity.
   */
  private processResourceDistribution(allStructures: Structure[]): void {
    for (const source of allStructures) {
      // Only producers should push their output into storage
      if (source.type !== 'Refinery' && source.type !== 'Recycler') continue;
      if (source.getInventoryTotal() <= 0) continue;
      if (!source.isConstructed || source.isDestroyed()) continue;

      const members = this.getGridMembers(source);

      for (const [material, sourceAmount] of source.getInventoryItems()) {
        if (sourceAmount <= 0) continue;
        let remaining = sourceAmount;

        for (const dest of members) {
          if (dest === source) continue;
          if (dest.team !== source.team) continue;
          if (!dest.isConstructed || dest.isDestroyed()) continue;
          if (dest.getStorageCapacity() <= 0) continue;

          const destSpace = dest.getStorageCapacity() - dest.getInventoryTotal();
          if (destSpace <= 0) continue;

          const route = this.findRoute(source, dest);
          if (!route) continue;

          const bottleneck = Math.min(...route.connections.map(c => c.throughput));
          const transfer = Math.min(remaining, destSpace, bottleneck);
          if (transfer <= 0) continue;

          const removed = source.removeFromInventory(material, transfer);
          if (removed > 0) {
            dest.addToInventory(material, removed);
            remaining -= removed;
            for (let ci = 0; ci < route.connections.length; ci++) route.connections[ci].flashWithFlow(material, ci * 50);
          }

          if (remaining <= 0) break;
        }
        if (source.getInventoryTotal() <= 0) break;
      }
    }
  }

  /**
   * Process ore in Refinery structures into refined materials via loot tables.
   * Runs once per pulse. Power-gated.
   * 80% of processed ore becomes waste. 20% is split among drops by chance percentage.
   */
  private processRefining(allStructures: Structure[]): void {
    for (const s of allStructures) {
      if (s.type !== 'Refinery') continue;
      if (!s.isConstructed || s.isDestroyed()) continue;

      const summary = this.getGridPowerSummary(s, allStructures);
      if (summary.powerEfficiency <= 0) continue;

      // Find ore in this refinery's inventory
      const oreTypes: OreType[] = ['CarbonaceousOre', 'SilicateOre', 'MetallicOre'];
      for (const oreType of oreTypes) {
        const oreAmount = s.getInventoryAmount(oreType);
        if (oreAmount <= 0) continue;

        const processAmount = Math.min(oreAmount, REFINERY_PROCESS_RATE_KG * summary.powerEfficiency);
        s.removeFromInventory(oreType, processAmount);

        // 80% waste, 20% yield
        const table = REFINING_TABLES[oreType];
        const yieldAmount = processAmount * (1 - table.wasteFraction);

        for (const drop of table.drops) {
          const produced = yieldAmount * (drop.dropChancePct / 100);
          if (produced > 0) {
            s.addToInventory(drop.material, produced);
          }
        }
        break; // process one ore type per pulse
      }
    }
  }

  // ── Accessors ──────────────────────────────────────────────────────────

  public getConnections(): Connection[] {
    return this.connections;
  }

  /** Return all active shield walls. */
  public getShieldWalls(): ShieldWall[] {
    return Array.from(this.shieldWalls.values());
  }

  /** Force topology rebuild on next update (e.g., after external structure removal). */
  public markTopologyDirty(): void {
    this.topologyDirty = true;
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  private getOrCreateAdj(id: string): Connection[] {
    let arr = this.adjacency.get(id);
    if (!arr) {
      arr = [];
      this.adjacency.set(id, arr);
    }
    return arr;
  }

  private removeFromAdj(id: string, conn: Connection): void {
    const arr = this.adjacency.get(id);
    if (!arr) return;
    const idx = arr.indexOf(conn);
    if (idx >= 0) arr.splice(idx, 1);
  }
}
