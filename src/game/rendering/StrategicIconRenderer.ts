import * as PIXI from 'pixi.js';
import * as Matter from 'matter-js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';

// ── Thresholds ──────────────────────────────────────────────────────────────

/**
 * Ships become icons when their bounding radius × viewport.scale < this value.
 * A high value means icons kick in early (low zoom).  The minimum world radius
 * below clamps small assemblies so tiny ships still icon near ~6× zoom.
 *
 * Target behaviour: icons appear around 6–8× zoom out.
 * At 6× zoom viewport.scale ≈ 0.21 (default 1.28 / 6).
 * With SHIP_MIN_WORLD_RADIUS = 180: icon when 180 × 0.21 = 37.8 < 40 ✓
 */
const SHIP_ICON_THRESHOLD_PX = 40;

/**
 * Minimum world radius used for ship icon threshold calculation.
 * Prevents tiny assemblies (bare cockpit) from iconising at 2× zoom.
 */
const SHIP_MIN_WORLD_RADIUS = 180;

/**
 * Asteroids use a smaller threshold so large rocks remain as geometry for
 * longer and only small/distant rocks collapse to dots.
 * asteroid_radius × scale < 12 → icon
 * e.g. radius-800 asteroid icons at scale < 0.015 (~85× zoom — basically never)
 *      radius-40 asteroid icons at scale < 0.30 (~4× zoom)
 */
const ASTEROID_ICON_THRESHOLD_PX = 12;

/**
 * Two icons within this many screen pixels are merged into a single group
 * badge showing a count.
 */
const GROUP_RADIUS_PX = 20;

// ── Colors ──────────────────────────────────────────────────────────────────

const COLOR_PLAYER:   number = 0x00ffff;
const COLOR_TEAM_0:   number = 0x0088ff;
const COLOR_TEAM_1:   number = 0xff4444;
const COLOR_DEBRIS:   number = 0x778899;
const COLOR_ASTEROID: number = 0x7a6a5c;

const TEAM_COLORS: Record<number, number> = {
  0: COLOR_TEAM_0,
  1: COLOR_TEAM_1,
};

// ── Internal types ───────────────────────────────────────────────────────────

interface Icon {
  sx:          number;
  sy:          number;
  color:       number;
  isAsteroid:  boolean;
  /** Merged cluster size — only meaningful after clustering pass. */
  count:       number;
}

const BADGE_STYLE = new PIXI.TextStyle({
  fontFamily: 'monospace',
  fontSize:   9,
  fill:       '#ffffff',
  fontWeight: 'bold',
});

// ── Renderer ─────────────────────────────────────────────────────────────────

/**
 * StrategicIconRenderer — priority 21 (just above BlockBodyRenderer at 20).
 *
 * Draws small icons in place of objects whose on-screen footprint has shrunk
 * below ICON_THRESHOLD_PX.  The body renderer still draws them at sub-pixel
 * scale but they are invisible noise; the icons give the player situational
 * awareness at any zoom level.
 *
 * Grouping: icons within GROUP_RADIUS_PX screen pixels of each other are
 * collapsed into a single icon showing a count badge, preventing clutter in
 * dense asteroid fields.
 */
export class StrategicIconRenderer implements IRenderer {
  readonly renderPriority = 21;

  private gfx!:       PIXI.Graphics;
  private textLayer!: PIXI.Container;
  private textPool:   PIXI.Text[] = [];

  constructor(
    private readonly getAssemblies:     () => Assembly[],
    private readonly getAsteroidBodies: () => Matter.Body[],
    private readonly getPlayerAssembly: () => Assembly | null,
  ) {}

  init(stage: PIXI.Container): void {
    this.gfx = new PIXI.Graphics();
    stage.addChild(this.gfx);
    this.textLayer = new PIXI.Container();
    stage.addChild(this.textLayer);
  }

  render(viewport: Viewport, _timestamp: number): void {
    this.gfx.clear();
    for (const t of this.textPool) t.visible = false;

    const scale  = viewport.scale;
    const player = this.getPlayerAssembly();
    const { canvas } = viewport;
    const W = canvas.width;
    const H = canvas.height;

    const icons: Icon[] = [];

    // ── Collect ship icons ───────────────────────────────────────────────
    for (const assembly of this.getAssemblies()) {
      if (assembly.destroyed || assembly.entities.length === 0) continue;

      const worldR = Math.max(SHIP_MIN_WORLD_RADIUS, assembly.getBoundingRadius());
      if (worldR * scale >= SHIP_ICON_THRESHOLD_PX) continue;  // still large enough — skip

      const pos = assembly.rootBody.position;
      const sp  = viewport.worldToScreen(pos.x, pos.y);
      if (sp.x < -32 || sp.x > W + 32 || sp.y < -32 || sp.y > H + 32) continue;

      let color = COLOR_DEBRIS;
      if (assembly.hasControlCenter()) {
        color = (player && assembly.id === player.id)
          ? COLOR_PLAYER
          : (TEAM_COLORS[assembly.team] ?? COLOR_DEBRIS);
      }

      icons.push({ sx: sp.x, sy: sp.y, color, isAsteroid: false, count: 1 });
    }

    // ── Collect asteroid icons ───────────────────────────────────────────
    for (const body of this.getAsteroidBodies()) {
      const worldR = bodyMaxRadius(body);
      if (worldR * scale >= ASTEROID_ICON_THRESHOLD_PX) continue;

      const sp = viewport.worldToScreen(body.position.x, body.position.y);
      if (sp.x < -16 || sp.x > W + 16 || sp.y < -16 || sp.y > H + 16) continue;

      icons.push({ sx: sp.x, sy: sp.y, color: COLOR_ASTEROID, isAsteroid: true, count: 1 });
    }

    if (icons.length === 0) return;

    // ── Cluster pass — greedy O(n²), fine for icon counts in practice ────
    const merged = new Uint8Array(icons.length);
    const GR2 = GROUP_RADIUS_PX * GROUP_RADIUS_PX;

    for (let i = 0; i < icons.length; i++) {
      if (merged[i]) continue;
      const base = icons[i];

      for (let j = i + 1; j < icons.length; j++) {
        if (merged[j]) continue;
        // Only merge same category (ships with ships, rocks with rocks)
        if (icons[j].isAsteroid !== base.isAsteroid) continue;
        const dx = icons[j].sx - base.sx;
        const dy = icons[j].sy - base.sy;
        if (dx * dx + dy * dy <= GR2) {
          base.count++;
          merged[j] = 1;
        }
      }
    }

    // ── Draw ─────────────────────────────────────────────────────────────
    for (let i = 0; i < icons.length; i++) {
      if (merged[i]) continue;
      const icon = icons[i];
      if (icon.isAsteroid) {
        this.drawAsteroidIcon(icon.sx, icon.sy, icon.color, icon.count);
      } else {
        this.drawShipIcon(icon.sx, icon.sy, icon.color, icon.count);
      }
    }
  }

  // ── Icon shapes ──────────────────────────────────────────────────────────

  /** Diamond ◆ — the classic RTS strategic unit icon. */
  private drawShipIcon(sx: number, sy: number, color: number, count: number): void {
    const s = 6;
    this.gfx.lineStyle(1.5, color, 1.0);
    this.gfx.beginFill(color, 0.30);
    this.gfx.moveTo(sx,     sy - s);
    this.gfx.lineTo(sx + s, sy);
    this.gfx.lineTo(sx,     sy + s);
    this.gfx.lineTo(sx - s, sy);
    this.gfx.closePath();
    this.gfx.endFill();

    if (count > 1) this.drawBadge(sx + s, sy - s, count, color);
  }

  /** Small filled circle — distinct from the diamond so ships and rocks are
   *  immediately differentiable at a glance. */
  private drawAsteroidIcon(sx: number, sy: number, color: number, count: number): void {
    const r = 3;
    this.gfx.lineStyle(0);
    this.gfx.beginFill(color, 0.85);
    this.gfx.drawCircle(sx, sy, r);
    this.gfx.endFill();

    if (count > 1) this.drawBadge(sx + r + 1, sy - r, count, color);
  }

  // ── Badge ────────────────────────────────────────────────────────────────

  private drawBadge(sx: number, sy: number, count: number, _color: number): void {
    const label = `×${count}`;
    const t = this.acquireText();
    t.style   = BADGE_STYLE;
    t.text    = label;
    t.x       = sx;
    t.y       = sy;
    t.anchor.set(0, 1);
    t.visible = true;
  }

  private acquireText(): PIXI.Text {
    const existing = this.textPool.find(t => !t.visible);
    if (existing) return existing;
    const t = new PIXI.Text('', BADGE_STYLE);
    this.textLayer.addChild(t);
    this.textPool.push(t);
    return t;
  }

  dispose(): void {
    this.gfx.destroy();
    this.textLayer.destroy({ children: true });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Max distance from body.position to any vertex — used as the body's bounding radius. */
function bodyMaxRadius(body: Matter.Body): number {
  const verts = body.vertices;
  if (!verts || verts.length === 0) return 10;
  const cx = body.position.x;
  const cy = body.position.y;
  let maxR = 0;
  for (const v of verts) {
    const r = Math.hypot(v.x - cx, v.y - cy);
    if (r > maxR) maxR = r;
  }
  return maxR;
}
