import * as PIXI from 'pixi.js';
import * as Matter from 'matter-js';
import { GlowFilter } from 'pixi-filters';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';

const GLOW_DISTANCE    = 15;
const GLOW_OUTER       = 2.5;
const GLOW_INNER       = 0.5;
const GLOW_COLOR       = 0xffffff;
const GLOW_QUALITY     = 0.1;

export class BlockBodyRenderer implements IRenderer {
  readonly renderPriority = 20;

  private blockGraphics!:  PIXI.Graphics;
  private bulletGraphics!: PIXI.Graphics;

  constructor(
    private readonly getAssemblies: () => Assembly[],
    private readonly getWorld: () => Matter.World,
  ) {}

  init(stage: PIXI.Container): void {
    this.blockGraphics = new PIXI.Graphics();
    this.blockGraphics.filters = [new GlowFilter({
      distance:      GLOW_DISTANCE,
      outerStrength: GLOW_OUTER,
      innerStrength: GLOW_INNER,
      color:         GLOW_COLOR,
      quality:       GLOW_QUALITY,
    })];
    stage.addChild(this.blockGraphics);

    this.bulletGraphics = new PIXI.Graphics();
    stage.addChild(this.bulletGraphics);
  }

  render(viewport: Viewport, _timestamp: number): void {
    this.blockGraphics.clear();
    this.bulletGraphics.clear();
    const scale = viewport.scale;
    const assemblies = this.getAssemblies();

    // Collect entity body IDs to skip during the world-body pass
    const entityBodyIds = new Set<number>();
    for (const assembly of assemblies) {
      for (const entity of assembly.entities) {
        entityBodyIds.add(entity.body.id);
      }
    }

    // --- Entity bodies (ship blocks) ---
    for (const assembly of assemblies) {
      for (const entity of assembly.entities) {
        if (entity.destroyed || entity.body.render?.visible === false) continue;
        this.drawPolygon(this.blockGraphics, viewport, entity.body, scale);
      }
    }

    // --- Non-entity bodies (bullets, missiles, etc.) ---
    const worldBodies = Matter.Composite.allBodies(this.getWorld());
    for (const body of worldBodies) {
      if (body.render?.visible === false) continue;
      if (entityBodyIds.has(body.id)) continue;
      if (body.parent !== body) continue;

      if (body.parts.length > 1) {
        for (let i = 1; i < body.parts.length; i++) {
          const part = body.parts[i];
          if (part.render?.visible === false) continue;
          this.drawPolygon(this.bulletGraphics, viewport, part, scale);
        }
      } else {
        this.drawPolygon(this.bulletGraphics, viewport, body, scale);
      }
    }
  }

  private drawPolygon(gfx: PIXI.Graphics, viewport: Viewport, body: Matter.Body, scale: number): void {
    const verts = body.vertices;
    if (!verts || verts.length === 0) return;

    const fillColor   = this.cssColor(body.render.fillStyle,   0x5e5e5e);
    const strokeColor = this.cssColor(body.render.strokeStyle, 0x303030);
    const lineWidth   = (body.render.lineWidth || 3) * scale;

    gfx.lineStyle(lineWidth, strokeColor, 1);
    gfx.beginFill(fillColor, 1);

    const first = viewport.worldToScreen(verts[0].x, verts[0].y);
    gfx.moveTo(first.x, first.y);
    for (let i = 1; i < verts.length; i++) {
      const p = viewport.worldToScreen(verts[i].x, verts[i].y);
      gfx.lineTo(p.x, p.y);
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
