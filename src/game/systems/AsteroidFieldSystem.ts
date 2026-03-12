import * as Matter from 'matter-js';

// ── Biome / zone constants ─────────────────────────────────────────────────
/**
 * Side length of a sector cell.  Each sector may contain one zone centre.
 * Smaller = denser fields, less empty space between them.
 */
const SECTOR_SIZE      = 30_000;
/** Probability that a given sector contains a zone (excluding guaranteed zones). */
const ZONE_PROBABILITY = 0.65;
const ZONE_MIN_RADIUS  =  5_000;
const ZONE_MAX_RADIUS  = 12_000;

// ── Chunk streaming constants ──────────────────────────────────────────────
/** Fine streaming grid side length. */
const CHUNK_SIZE    = 2_000;
/** Load chunks whose centre is within this distance of the camera. */
const LOAD_RADIUS   = 10_000;
/** Unload chunks beyond this (hysteresis gap prevents thrashing). */
const UNLOAD_RADIUS = 14_000;

// ── Asteroid generation constants ──────────────────────────────────────────
/** Max number of asteroid candidates per chunk (fewer actually spawn based on influence). */
const SLOTS_PER_CHUNK       = 6;
/** Spawn probability at peak influence (zone centre). */
const MAX_SPAWN_CHANCE      = 0.90;
/** Radius of the smallest asteroid (zone edges). */
const ASTEROID_MIN_RADIUS   = 40;
/** Radius of the largest asteroid (zone centre). */
const ASTEROID_MAX_RADIUS   = 800;
/** Number of candidate points fed into the convex hull to shape each asteroid. */
const HULL_CANDIDATE_POINTS = 16;

// ── Render appearance ──────────────────────────────────────────────────────
// All colors must be 6-digit hex — PIXI.Graphics.beginFill rejects 8-digit (alpha) hex.
const ASTEROID_FILL_COLORS   = ['#3a3530', '#3d3833', '#2e2b28', '#423933', '#352f2b'] as const;
const ASTEROID_STROKE_COLORS = ['#6b5e52', '#7a6a5c', '#58504a', '#7d6d60'] as const;

// ── Seeded PRNG (mulberry32) ────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic seed from a pair of signed integer grid coordinates. */
function gridSeed(a: number, b: number): number {
  return ((a * 73856093) ^ (b * 19349663)) | 0;
}

// ── Convex hull (monotone chain, CCW output) ───────────────────────────────

interface Vec2 { x: number; y: number }

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Monotone-chain convex hull.  Returns points in counter-clockwise order.
 * Guarantees the output polygon is strictly convex — no collinear points are
 * included (cross product ≤ 0 check eliminates them).
 */
function convexHull(pts: Vec2[]): Vec2[] {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);

  const lower: Vec2[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Vec2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// ── Zone descriptor ─────────────────────────────────────────────────────────

interface ZoneInfo {
  x:      number;
  y:      number;
  radius: number;
}

// ── AsteroidFieldSystem ─────────────────────────────────────────────────────

export class AsteroidFieldSystem {
  /** chunk key (`"cx,cy"`) → asteroid bodies currently in the world */
  private readonly activeChunks = new Map<string, Matter.Body[]>();

  constructor(
    private readonly addBodyToWorld:      (body: Matter.Body) => void,
    private readonly removeBodyFromWorld: (body: Matter.Body) => void,
  ) {}

  /**
   * Call every game loop frame.  Streams asteroid chunks in and out around the
   * camera centre.
   *
   * @param viewportHalfDiag  Half-diagonal of the visible viewport in world
   *   units (distance from camera centre to a screen corner).  When the player
   *   zooms out the viewport grows, so we extend the load radius to match —
   *   preventing chunks that are on-screen from being unloaded and popping out.
   */
  public update(cameraCenter: Vec2, viewportHalfDiag: number = 0): void {
    const { x: cx, y: cy } = cameraCenter;

    // Grow with the viewport so on-screen chunks aren't culled, but cap hard
    // to bound the total body count.  Beyond the cap, far-edge asteroids may
    // pop in/out slightly — acceptable given they'll show as icons anyway.
    const MAX_LOAD   = LOAD_RADIUS   * 2;   // hard ceiling = 20 000 units → ≤ ~314 chunks
    const MAX_UNLOAD = UNLOAD_RADIUS * 2;
    const effectiveLoad   = Math.min(MAX_LOAD,   Math.max(LOAD_RADIUS,   viewportHalfDiag * 1.20));
    const effectiveUnload = Math.min(MAX_UNLOAD, Math.max(UNLOAD_RADIUS, viewportHalfDiag * 1.50));

    const chunkRadius = Math.ceil(effectiveLoad / CHUNK_SIZE);
    const camChunkX   = Math.floor(cx / CHUNK_SIZE);
    const camChunkY   = Math.floor(cy / CHUNK_SIZE);

    // ── Desired chunk set ────────────────────────────────────────────────
    const desired = new Set<string>();
    for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
      for (let dy = -chunkRadius; dy <= chunkRadius; dy++) {
        const ccx = camChunkX + dx;
        const ccy = camChunkY + dy;
        const centreX = (ccx + 0.5) * CHUNK_SIZE;
        const centreY = (ccy + 0.5) * CHUNK_SIZE;
        if (Math.hypot(cx - centreX, cy - centreY) <= effectiveLoad) {
          desired.add(`${ccx},${ccy}`);
        }
      }
    }

    // ── Load new chunks ──────────────────────────────────────────────────
    for (const key of desired) {
      if (!this.activeChunks.has(key)) {
        const [ccxStr, ccyStr] = key.split(',');
        this.loadChunk(parseInt(ccxStr, 10), parseInt(ccyStr, 10));
      }
    }

    // ── Unload distant chunks (hysteresis) ────────────────────────────────
    for (const [key, bodies] of this.activeChunks) {
      if (desired.has(key)) continue;
      const [ccxStr, ccyStr] = key.split(',');
      const centreX = (parseInt(ccxStr, 10) + 0.5) * CHUNK_SIZE;
      const centreY = (parseInt(ccyStr, 10) + 0.5) * CHUNK_SIZE;
      if (Math.hypot(cx - centreX, cy - centreY) > effectiveUnload) {
        this.unloadChunk(key, bodies);
      }
    }
  }

  /** Returns a flat list of every asteroid body currently loaded in the world. */
  public getAllBodies(): Matter.Body[] {
    const result: Matter.Body[] = [];
    for (const bodies of this.activeChunks.values()) {
      for (const b of bodies) result.push(b);
    }
    return result;
  }

  /** Remove all asteroid bodies from the world (call on scene teardown). */
  public dispose(): void {
    for (const [key, bodies] of this.activeChunks) {
      this.unloadChunk(key, bodies);
    }
  }

  // ── Biome / zone lookup ───────────────────────────────────────────────────

  /**
   * Returns the zone info for sector (sx, sy), or null if that sector is empty.
   * Deterministic — same sector always returns the same result.
   *
   * Sector (0,0) always contains a zone so the player starts inside a field.
   */
  private getZoneForSector(sx: number, sy: number): ZoneInfo | null {
    if (sx === 0 && sy === 0) {
      // Guaranteed spawn-area zone close to the origin.
      return { x: 2_500, y: 1_800, radius: ZONE_MAX_RADIUS };
    }
    const rng = mulberry32(gridSeed(sx, sy) ^ 0xdeadbeef);
    if (rng() > ZONE_PROBABILITY) return null;
    return {
      x:      sx * SECTOR_SIZE + rng() * SECTOR_SIZE,
      y:      sy * SECTOR_SIZE + rng() * SECTOR_SIZE,
      radius: ZONE_MIN_RADIUS + rng() * (ZONE_MAX_RADIUS - ZONE_MIN_RADIUS),
    };
  }

  /**
   * Returns the strongest zone influence [0–1] at world position (wx, wy).
   * Checks the 3×3 neighbourhood of sectors around the point.
   * Linear falloff: influence = clamp(1 − dist/zoneRadius, 0, 1)
   * This produces a gradual entry/exit to each field rather than the harsh
   * t⁴ formula that made fields nearly invisible outside their exact centre.
   */
  private getZoneInfluence(wx: number, wy: number): number {
    const sx = Math.floor(wx / SECTOR_SIZE);
    const sy = Math.floor(wy / SECTOR_SIZE);
    let maxInfluence = 0;

    for (let dsx = -1; dsx <= 1; dsx++) {
      for (let dsy = -1; dsy <= 1; dsy++) {
        const zone = this.getZoneForSector(sx + dsx, sy + dsy);
        if (!zone) continue;
        const dist      = Math.hypot(wx - zone.x, wy - zone.y);
        const influence = Math.max(0, 1 - dist / zone.radius);
        if (influence > maxInfluence) maxInfluence = influence;
      }
    }

    return maxInfluence;
  }

  // ── Chunk lifecycle ────────────────────────────────────────────────────────

  private loadChunk(cx: number, cy: number): void {
    const key  = `${cx},${cy}`;
    const rng  = mulberry32(gridSeed(cx, cy));
    const bodies: Matter.Body[] = [];

    for (let i = 0; i < SLOTS_PER_CHUNK; i++) {
      const wx = cx * CHUNK_SIZE + rng() * CHUNK_SIZE;
      const wy = cy * CHUNK_SIZE + rng() * CHUNK_SIZE;

      const influence   = this.getZoneInfluence(wx, wy);
      const spawnChance = influence * MAX_SPAWN_CHANCE;   // linear: gentle edges, dense core
      if (rng() >= spawnChance) continue;

      // Radius scales linearly with influence: small at edges, huge at core.
      const radius = ASTEROID_MIN_RADIUS + influence * (ASTEROID_MAX_RADIUS - ASTEROID_MIN_RADIUS);

      const body = this.generateAsteroidBody(wx, wy, radius, rng);
      if (body) {
        this.addBodyToWorld(body);
        bodies.push(body);
      }
    }

    this.activeChunks.set(key, bodies);
  }

  private unloadChunk(key: string, bodies: Matter.Body[]): void {
    for (const body of bodies) {
      this.removeBodyFromWorld(body);
    }
    this.activeChunks.delete(key);
  }

  // ── Asteroid body generation ───────────────────────────────────────────────

  /**
   * Generates a guaranteed-convex asteroid body via a convex-hull pass over
   * random candidate points in an annulus.  The convex hull eliminates any
   * interior or concave points, so the resulting polygon is always valid for
   * Matter.js without needing poly-decomp.
   */
  private generateAsteroidBody(
    wx:     number,
    wy:     number,
    radius: number,
    rng:    () => number,
  ): Matter.Body | null {
    // Generate candidate points scattered in an annulus [50%–100%] of radius.
    const candidates: Vec2[] = [];
    for (let i = 0; i < HULL_CANDIDATE_POINTS; i++) {
      const angle = rng() * Math.PI * 2;
      const r     = radius * (0.50 + rng() * 0.50);
      candidates.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }

    const hull = convexHull(candidates);
    if (hull.length < 3) return null;

    const fillColor   = ASTEROID_FILL_COLORS[Math.floor(rng() * ASTEROID_FILL_COLORS.length)];
    const strokeColor = ASTEROID_STROKE_COLORS[Math.floor(rng() * ASTEROID_STROKE_COLORS.length)];

    const body = Matter.Body.create({
      isStatic:    true,
      friction:    0,
      frictionAir: 0,
      restitution: 0.25,
      label:       'asteroid',
      render: {
        fillStyle:   fillColor,
        strokeStyle: strokeColor,
        lineWidth:   2,
      },
    });

    // setVertices recentres around centroid (relative to current body.position = {0,0}),
    // then setPosition translates the body + vertices to world coords.
    Matter.Body.setVertices(body, hull);
    Matter.Body.setPosition(body, { x: wx, y: wy });

    return body;
  }
}
