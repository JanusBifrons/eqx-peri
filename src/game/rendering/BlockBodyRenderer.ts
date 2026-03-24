import * as PIXI from 'pixi.js';
import * as Matter from 'matter-js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';

const GLOW_BLUR    = 50;
const GLOW_QUALITY = 4;
const GLOW_ALPHA   = 1.0;

export class BlockBodyRenderer implements IRenderer {
  readonly renderPriority = 20;
  readonly renderSpace = 'world' as const;

  private glowGraphics!:   PIXI.Graphics;
  private blockGraphics!:  PIXI.Graphics;
  private laserGraphics!: PIXI.Graphics;
  private blurFilter!: PIXI.BlurFilter;

  constructor(
    private readonly getAssemblies: () => Assembly[],
    private readonly getWorld: () => Matter.World,
  ) {}

  init(stage: PIXI.Container): void {
    // Glow layer: each block drawn in its fill colour, blurred with additive blending
    // ADD blend mode means the glow adds light on top of whatever is behind it
    this.glowGraphics = new PIXI.Graphics();
    this.blurFilter = new PIXI.BlurFilter(GLOW_BLUR, GLOW_QUALITY);
    this.glowGraphics.filters = [this.blurFilter];
    this.glowGraphics.blendMode = PIXI.BLEND_MODES.ADD;
    stage.addChild(this.glowGraphics);

    this.blockGraphics = new PIXI.Graphics();
    stage.addChild(this.blockGraphics);

    this.laserGraphics = new PIXI.Graphics();
    stage.addChild(this.laserGraphics);
  }

  render(viewport: Viewport, _timestamp: number): void {
    this.glowGraphics.clear();
    this.blockGraphics.clear();
    this.laserGraphics.clear();
    const scale = viewport.scale;

    // Adjust blur filter for zoom: blur is in local (world) units, so we need
    // to compensate for the container's scale to keep a consistent screen-pixel blur.
    this.blurFilter.blur = GLOW_BLUR / scale;

    const assemblies = this.getAssemblies();

    const entityBodyIds = new Set<number>();
    for (const assembly of assemblies) {
      for (const entity of assembly.entities) {
        entityBodyIds.add(entity.body.id);
      }
    }

    // --- Entity bodies (ship blocks) — draw at world coords ---
    for (const assembly of assemblies) {
      for (const entity of assembly.entities) {
        if (entity.destroyed || entity.body.render?.visible === false) continue;
        this.drawGlowPolygon(entity.body);
        this.drawPolygon(this.blockGraphics, entity.body);
      }
    }

    // --- Non-entity bodies (lasers, missiles, asteroids, etc.) ---
    const worldBodies = Matter.Composite.allBodies(this.getWorld());
    for (const body of worldBodies) {
      if (body.render?.visible === false) continue;
      if (entityBodyIds.has(body.id)) continue;
      if (body.parent !== body) continue;

      // Skip structure bodies — they are rendered by StructureRenderer
      if ((body as unknown as Record<string, unknown>).structure) continue;

      // Skip asteroids whose on-screen footprint is too small to see — they are
      // rendered as icons by StrategicIconRenderer at that zoom level.
      if (body.label === 'asteroid') {
        const bw = (body.bounds.max.x - body.bounds.min.x) * scale;
        if (bw < 2) continue;
      }

      if (body.parts.length > 1) {
        for (let i = 1; i < body.parts.length; i++) {
          const part = body.parts[i];
          if (part.render?.visible === false) continue;
          this.drawPolygon(this.laserGraphics, part);
        }
      } else {
        this.drawPolygon(this.laserGraphics, body);
      }
    }
  }

  /** Draws a filled polygon in the block's fill colour on the glow layer. */
  private drawGlowPolygon(body: Matter.Body): void {
    const verts = body.vertices;
    if (!verts || verts.length === 0) return;
    const color = this.cssColor(body.render.fillStyle, 0x5e5e5e);

    this.glowGraphics.lineStyle(0);
    this.glowGraphics.beginFill(color, GLOW_ALPHA);
    this.glowGraphics.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      this.glowGraphics.lineTo(verts[i].x, verts[i].y);
    }
    this.glowGraphics.closePath();
    this.glowGraphics.endFill();
  }

  private drawPolygon(gfx: PIXI.Graphics, body: Matter.Body): void {
    const verts = body.vertices;
    if (!verts || verts.length === 0) return;

    const fillColor   = this.cssColor(body.render.fillStyle,   0x5e5e5e);
    const strokeColor = this.cssColor(body.render.strokeStyle, 0x303030);
    // lineWidth is in world units — the container's scale handles screen sizing
    const lineWidth   = body.render.lineWidth || 3;

    gfx.lineStyle(lineWidth, strokeColor, 1);
    gfx.beginFill(fillColor, 1);

    gfx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      gfx.lineTo(verts[i].x, verts[i].y);
    }
    gfx.closePath();
    gfx.endFill();
  }

  /** Convert any CSS color string to a PIXI hex integer. */
  private cssColor(css: string | undefined, fallback: number): number {
    if (!css || css === 'transparent') return fallback;
    if (css.startsWith('#')) {
      const v = parseInt(css.slice(1), 16);
      return isNaN(v) ? fallback : v;
    }
    const m = css.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) return (parseInt(m[1]) << 16) | (parseInt(m[2]) << 8) | parseInt(m[3]);
    return fallback;
  }
}
