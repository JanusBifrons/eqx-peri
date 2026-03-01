import * as Matter from 'matter-js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';

export class BlockBodyRenderer implements IRenderer {
  readonly renderPriority = 20;

  constructor(
    private readonly getAssemblies: () => Assembly[],
    private readonly getWorld: () => Matter.World,
  ) {}

  render(ctx: CanvasRenderingContext2D, viewport: Viewport, _timestamp: number): void {
    const scale = viewport.scale;
    const assemblies = this.getAssemblies();

    // Collect entity body IDs so we can skip them during the world-body pass
    const entityBodyIds = new Set<number>();
    for (const assembly of assemblies) {
      for (const entity of assembly.entities) {
        entityBodyIds.add(entity.body.id);
      }
    }

    // --- Render entity bodies (ship blocks) ---
    for (const assembly of assemblies) {
      for (const entity of assembly.entities) {
        if (entity.destroyed || entity.body.render?.visible === false) continue;
        this.renderBodyVertices(ctx, viewport, entity.body, scale);
      }
    }

    // --- Render non-entity bodies (bullets, missiles, etc.) ---
    // Filter to top-level bodies only (parent === body), skipping compound sub-bodies
    const worldBodies = Matter.Composite.allBodies(this.getWorld());
    for (const body of worldBodies) {
      if (body.render?.visible === false) continue;
      // Skip entity bodies already rendered above
      if (entityBodyIds.has(body.id)) continue;
      // Skip compound sub-bodies — their parent compound is the top-level entry
      if (body.parent !== body) continue;

      // Compound body: render each part individually
      if (body.parts.length > 1) {
        for (let i = 1; i < body.parts.length; i++) {
          const part = body.parts[i];
          if (part.render?.visible === false) continue;
          this.renderBodyVertices(ctx, viewport, part, scale);
        }
      } else {
        this.renderBodyVertices(ctx, viewport, body, scale);
      }
    }
  }

  private renderBodyVertices(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    body: Matter.Body,
    scale: number,
  ): void {
    const verts = body.vertices;
    if (!verts || verts.length === 0) return;

    ctx.beginPath();
    const first = viewport.worldToScreen(verts[0].x, verts[0].y);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < verts.length; i++) {
      const p = viewport.worldToScreen(verts[i].x, verts[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();

    ctx.fillStyle = body.render.fillStyle || '#5e5e5e';
    ctx.strokeStyle = body.render.strokeStyle || '#303030';
    ctx.lineWidth = (body.render.lineWidth || 3) * scale;
    ctx.fill();
    ctx.stroke();
  }
}
