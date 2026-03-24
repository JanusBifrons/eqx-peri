// pathfinding is a CJS module; Vite may place exports under .default.
// Use a default import + fallback to handle both ESM interop patterns.
import PFModule from 'pathfinding';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PF: typeof PFModule = (PFModule as any).default ?? PFModule;
import * as Matter from 'matter-js';
import { Vector2 } from '../../types/GameTypes';

/**
 * Grid cell size in world units.  80 is coarse enough for real-time performance
 * but fine enough to navigate around structures (200–800 units wide) and large
 * asteroids.  Ships are ~50–80 units across so 80-unit cells leave comfortable
 * clearance.
 */
const CELL_SIZE = 30;

/**
 * Extra margin (world units) added around the start→end bounding box when
 * building the local pathfinding grid.  Gives A* room to route around
 * obstacles near the corridor edges.
 */
const GRID_MARGIN = 3000;

/**
 * Minimum inflation radius (world units) added around each obstacle.
 * Actual inflation = max(this, assemblyRadius) so larger ships get wider clearance.
 */
const MIN_OBSTACLE_INFLATION = 20;

/** Maximum number of times to retry with a larger grid when no path is found. */
const MAX_GRID_RETRIES = 3;

/** Factor to expand the margin by on each retry. */
const RETRY_MARGIN_FACTOR = 1.5;

/**
 * Lightweight pathfinding wrapper over pathfinding.js.
 *
 * Builds a local A* grid on demand (not every frame) covering the corridor
 * between start and end positions, marks cells occupied by static bodies
 * (structures, asteroids, shield walls), solves the path, and returns
 * world-coordinate waypoints.
 *
 * Instantiated by GameEngine; NOT a singleton.
 */
/** Snapshot of the last A* grid for debug rendering. */
export interface PathfindingDebugData {
  originX: number;
  originY: number;
  cellSize: number;
  width: number;
  height: number;
  /** Flat row-major boolean array: true = blocked. */
  blocked: boolean[];
  /** The solved path as world-coordinate waypoints (including start). */
  path: Vector2[];
}

export class PathfindingSystem {
  private getStaticBodies: () => Matter.Body[];
  /** Last grid snapshot for debug visualization (null until first findPath call). */
  public lastDebugData: PathfindingDebugData | null = null;

  constructor(getStaticBodies: () => Matter.Body[]) {
    this.getStaticBodies = getStaticBodies;
  }

  /**
   * Compute a path from `start` to `end`, navigating around static obstacles.
   * Returns an array of world-coordinate waypoints.  If no obstacles block the
   * direct line, returns just `[end]` (single waypoint = go straight).
   * If no path is found (completely blocked), returns `[end]` as a fallback
   * so the AI still attempts the move.
   */
  findPath(start: Vector2, end: Vector2, assemblyRadius: number = 0): Vector2[] {
    const inflation = Math.max(MIN_OBSTACLE_INFLATION, assemblyRadius);
    let margin = GRID_MARGIN;

    for (let attempt = 0; attempt <= MAX_GRID_RETRIES; attempt++) {
      const result = this.tryFindPath(start, end, inflation, margin);
      if (result) return result;
      // Expand margin and retry
      margin = Math.ceil(margin * RETRY_MARGIN_FACTOR);
      console.log(`[Pathfinding] Retrying with expanded margin ${margin} (attempt ${attempt + 2})`);
    }

    // All retries exhausted — fall back to direct
    console.log('[Pathfinding] All retries exhausted — falling back to direct');
    return [end];
  }

  private tryFindPath(
    start: Vector2, end: Vector2, inflation: number, margin: number,
  ): Vector2[] | null {
    const minX = Math.min(start.x, end.x) - margin;
    const minY = Math.min(start.y, end.y) - margin;
    const maxX = Math.max(start.x, end.x) + margin;
    const maxY = Math.max(start.y, end.y) + margin;

    const width  = Math.ceil((maxX - minX) / CELL_SIZE);
    const height = Math.ceil((maxY - minY) / CELL_SIZE);

    // Sanity cap — don't create enormous grids
    if (width > 800 || height > 800) {
      return null;
    }

    const grid = new PF.Grid(width, height);

    // Mark cells blocked by static obstacles
    const bodies = this.getStaticBodies();
    let blockedCells = 0;
    for (const body of bodies) {
      this.markBodyOnGrid(grid, body, minX, minY, width, height, inflation);
    }
    // Build blocked bitmap for debug + count
    const blocked: boolean[] = new Array(width * height);
    for (let gy = 0; gy < height; gy++) {
      for (let gx = 0; gx < width; gx++) {
        const isBlocked = !grid.isWalkableAt(gx, gy);
        blocked[gy * width + gx] = isBlocked;
        if (isBlocked) blockedCells++;
      }
    }
    console.log(`[Pathfinding] grid=${width}x${height}, bodies=${bodies.length}, blocked=${blockedCells}, inflation=${inflation.toFixed(0)}, margin=${margin}`);

    // Store debug snapshot now (before A*) so the overlay always renders
    this.lastDebugData = { originX: minX, originY: minY, cellSize: CELL_SIZE, width, height, blocked, path: [] };

    // Convert start/end to grid coordinates
    const startGX = Math.floor((start.x - minX) / CELL_SIZE);
    const startGY = Math.floor((start.y - minY) / CELL_SIZE);
    const endGX   = Math.floor((end.x - minX) / CELL_SIZE);
    const endGY   = Math.floor((end.y - minY) / CELL_SIZE);

    const sx = Math.max(0, Math.min(width - 1, startGX));
    const sy = Math.max(0, Math.min(height - 1, startGY));
    const ex = Math.max(0, Math.min(width - 1, endGX));
    const ey = Math.max(0, Math.min(height - 1, endGY));

    grid.setWalkableAt(sx, sy, true);
    grid.setWalkableAt(ex, ey, true);

    const finder = new PF.AStarFinder({
      diagonalMovement: PF.DiagonalMovement.IfAtMostOneObstacle,
    });

    const rawPath = finder.findPath(sx, sy, ex, ey, grid);
    console.log(`[Pathfinding] start=(${sx},${sy}) end=(${ex},${ey}) rawPath.length=${rawPath.length}`);

    if (rawPath.length === 0) {
      return null;
    }

    // Convert raw path to world coordinates (skip first point — ship is already there)
    const worldPath: Vector2[] = [];
    for (let i = 1; i < rawPath.length; i++) {
      worldPath.push({
        x: rawPath[i][0] * CELL_SIZE + minX + CELL_SIZE / 2,
        y: rawPath[i][1] * CELL_SIZE + minY + CELL_SIZE / 2,
      });
    }

    if (worldPath.length === 0) {
      return [end];
    }

    // Simplify: remove collinear waypoints (keep only turning points)
    const waypoints: Vector2[] = [worldPath[0]];
    for (let i = 1; i < worldPath.length - 1; i++) {
      const prev = worldPath[i - 1];
      const curr = worldPath[i];
      const next = worldPath[i + 1];
      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;
      // Keep this waypoint if direction changes
      if (Math.abs(dx1 * dy2 - dy1 * dx2) > 0.01) {
        waypoints.push(curr);
      }
    }

    // Replace the last waypoint with the exact target (not grid-snapped)
    waypoints[waypoints.length - 1] = end;

    // Update debug snapshot with the solved path
    if (this.lastDebugData) {
      const fullPath: Vector2[] = [start];
      for (const wp of rawPath) {
        fullPath.push({
          x: wp[0] * CELL_SIZE + minX + CELL_SIZE / 2,
          y: wp[1] * CELL_SIZE + minY + CELL_SIZE / 2,
        });
      }
      this.lastDebugData.path = fullPath;
    }

    console.log(`[Pathfinding] Final waypoints: ${waypoints.length}`, waypoints.map(w => `(${Math.round(w.x)},${Math.round(w.y)})`).join(' → '));
    return waypoints;
  }

  /**
   * Mark grid cells occupied by a Matter.js body as unwalkable.
   * Uses AABB to narrow candidates, then tests each cell centre against the
   * inflated convex hull of the body's vertices for accurate shape coverage.
   * Handles compound bodies (multiple parts) by testing each part separately.
   */
  private markBodyOnGrid(
    grid: InstanceType<typeof PF.Grid>,
    body: Matter.Body,
    originX: number,
    originY: number,
    gridW: number,
    gridH: number,
    inflation: number,
  ): void {
    // Compound bodies: parts[0] is the root (skip it), parts[1..N] are the real shapes.
    // Simple bodies: parts[0] === body itself, so we use it directly.
    const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
    for (const part of parts) {
      this.markPartOnGrid(grid, part.vertices, originX, originY, gridW, gridH, inflation);
    }
  }

  private markPartOnGrid(
    grid: InstanceType<typeof PF.Grid>,
    verts: Matter.Vector[],
    originX: number,
    originY: number,
    gridW: number,
    gridH: number,
    inflation: number,
  ): void {
    const inflated = inflatePolygon(verts, inflation);

    // AABB of inflated polygon for candidate narrowing
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    for (const v of inflated) {
      if (v.x < bMinX) bMinX = v.x;
      if (v.y < bMinY) bMinY = v.y;
      if (v.x > bMaxX) bMaxX = v.x;
      if (v.y > bMaxY) bMaxY = v.y;
    }

    const cellMinX = Math.max(0, Math.floor((bMinX - originX) / CELL_SIZE));
    const cellMinY = Math.max(0, Math.floor((bMinY - originY) / CELL_SIZE));
    const cellMaxX = Math.min(gridW - 1, Math.ceil((bMaxX - originX) / CELL_SIZE));
    const cellMaxY = Math.min(gridH - 1, Math.ceil((bMaxY - originY) / CELL_SIZE));

    for (let gx = cellMinX; gx <= cellMaxX; gx++) {
      for (let gy = cellMinY; gy <= cellMaxY; gy++) {
        const wx = originX + (gx + 0.5) * CELL_SIZE;
        const wy = originY + (gy + 0.5) * CELL_SIZE;
        if (pointInConvexPolygon(wx, wy, inflated)) {
          grid.setWalkableAt(gx, gy, false);
        }
      }
    }
  }
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

/**
 * Inflate a convex polygon outward by `radius` along each edge normal.
 * Assumes CCW winding (Matter.js convention).
 */
function inflatePolygon(verts: Matter.Vector[], radius: number): Matter.Vector[] {
  const n = verts.length;
  const offsets: Array<{ nx: number; ny: number; d: number }> = [];
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.sqrt(ex * ex + ey * ey);
    if (len < 1e-6) continue;
    // Outward normal for CCW winding: rotate edge 90° CW → (ey, -ex)
    const nx = ey / len;
    const ny = -ex / len;
    offsets.push({ nx, ny, d: nx * a.x + ny * a.y + radius });
  }

  if (offsets.length < 3) {
    return verts.map(v => ({ x: v.x, y: v.y }));
  }

  const result: Matter.Vector[] = [];
  for (let i = 0; i < offsets.length; i++) {
    const l1 = offsets[i];
    const l2 = offsets[(i + 1) % offsets.length];
    const det = l1.nx * l2.ny - l1.ny * l2.nx;
    if (Math.abs(det) < 1e-10) {
      const v = verts[(i + 1) % n];
      result.push({ x: v.x + l1.nx * radius, y: v.y + l1.ny * radius });
    } else {
      result.push({
        x: (l1.d * l2.ny - l2.d * l1.ny) / det,
        y: (l2.d * l1.nx - l1.d * l2.nx) / det,
      });
    }
  }
  return result;
}

/**
 * Point-in-convex-polygon test. Assumes CCW winding (Matter.js convention).
 * For CCW, a point inside has all cross products ≥ 0.
 */
function pointInConvexPolygon(px: number, py: number, verts: Matter.Vector[]): boolean {
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    // Cross product of edge AB × AP — negative means outside for CCW winding
    if ((b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x) < 0) {
      return false;
    }
  }
  return true;
}
