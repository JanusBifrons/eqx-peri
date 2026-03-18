import { CONNECTION_MAX_RANGE, GridPowerSummary, TRANSFER_PULSE_MS, CONSTRUCTION_PULSE_AMOUNT, REPAIR_PULSE_AMOUNT } from '../../types/GameTypes';
import { Structure } from './Structure';
import { Connection } from './Connection';

/** A resource transfer request queued for the next pulse. */
interface TransferRequest {
  destination: Structure;
  amount: number;
}

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
  private transferQueue: TransferRequest[] = [];
  private lastPulseTime: number = 0;

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

  /** Check whether two structures can be linked. */
  public canConnect(a: Structure, b: Structure): boolean {
    if (a === b) return false;
    if (this.areConnected(a, b)) return false;
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
    return conn;
  }

  /** Remove a specific connection. */
  public disconnect(conn: Connection): void {
    this.connections = this.connections.filter(c => c !== conn);
    this.removeFromAdj(conn.nodeA.id, conn);
    this.removeFromAdj(conn.nodeB.id, conn);
    this.topologyDirty = true;
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
      usedCapacity += s.storedResources;
    }
    return {
      totalPowerOutput,
      totalPowerConsumption,
      netPower: totalPowerOutput - totalPowerConsumption,
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

  // ── Resource transfer (pulse-based) ────────────────────────────────────

  /** Queue a resource transfer request. Processed on the next pulse. */
  public requestTransfer(destination: Structure, amount: number): void {
    this.transferQueue.push({ destination, amount });
  }

  /**
   * Process queued transfers on a pulse. Called from update().
   * Returns true if any transfers occurred (for sound/effects).
   */
  private processPulse(_allStructures: Structure[]): boolean {
    if (this.transferQueue.length === 0) return false;

    let anyTransferred = false;

    for (const request of this.transferQueue) {
      const dest = request.destination;
      const destCap = dest.getStorageCapacity();
      const destSpace = destCap - dest.storedResources;
      if (destSpace <= 0) continue;

      const wanted = Math.min(request.amount, destSpace);

      // Find sources on the same grid with available resources
      const members = this.getGridMembers(dest);
      let remaining = wanted;

      for (const source of members) {
        if (source === dest) continue;
        if (source.storedResources <= 0) continue;
        if (source.team !== dest.team) continue;

        const route = this.findRoute(source, dest);
        if (!route) continue;

        // Bottleneck = minimum throughput along the route
        const bottleneck = Math.min(...route.connections.map(c => c.throughput));
        const transferAmount = Math.min(remaining, source.storedResources, bottleneck);
        if (transferAmount <= 0) continue;

        source.storedResources -= transferAmount;
        dest.storedResources += transferAmount;
        remaining -= transferAmount;
        anyTransferred = true;

        // Flash connections along the route
        for (const conn of route.connections) {
          conn.flash();
        }

        if (remaining <= 0) break;
      }
    }

    this.transferQueue = [];
    return anyTransferred;
  }

  // ── Per-frame update ───────────────────────────────────────────────────

  /** Call every frame. Rebuilds topology if needed, processes transfer pulses. */
  public update(deltaTimeMs: number, allStructures: Structure[]): void {
    this.rebuildComponents(allStructures);

    // Pulse-based resource transfer + construction/repair
    const now = Date.now();
    if (now - this.lastPulseTime >= TRANSFER_PULSE_MS) {
      this.lastPulseTime = now;
      this.processPulse(allStructures);
      this.processConstructionPulse(allStructures);
    }

    // Suppress unused warning — deltaTimeMs reserved for future tick-rate-independent logic
    void deltaTimeMs;
  }

  /**
   * Automatically deliver resources to structures under construction or in need of repair.
   * Runs once per pulse alongside the regular transfer pulse.
   */
  private processConstructionPulse(allStructures: Structure[]): void {
    for (const structure of allStructures) {
      const isBuilding = structure.needsConstruction();
      const isRepairing = structure.needsRepair();
      if (!isBuilding && !isRepairing) continue;

      const pulseAmount = isBuilding ? CONSTRUCTION_PULSE_AMOUNT : REPAIR_PULSE_AMOUNT;

      // Find grid members that have stored resources
      const members = this.getGridMembers(structure);
      let remaining = pulseAmount;

      for (const source of members) {
        if (source === structure) continue;
        if (source.storedResources <= 0) continue;
        if (source.team !== structure.team) continue;

        const route = this.findRoute(source, structure);
        if (!route) continue;

        // Bottleneck throughput along the route
        const bottleneck = Math.min(...route.connections.map(c => c.throughput));
        const available = Math.min(remaining, source.storedResources, bottleneck);
        if (available <= 0) continue;

        // Deliver resources
        const consumed = isBuilding
          ? structure.applyConstructionResources(available)
          : structure.applyRepairResources(available);

        if (consumed > 0) {
          source.storedResources -= consumed;
          remaining -= consumed;

          // Flash connections along the route
          for (const conn of route.connections) {
            conn.flash();
          }
        }

        if (remaining <= 0) break;
      }
    }
  }

  // ── Accessors ──────────────────────────────────────────────────────────

  public getConnections(): Connection[] {
    return this.connections;
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
