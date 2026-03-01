import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';

export class BlockFrillsRenderer implements IRenderer {
  readonly renderPriority = 30;

  constructor(private readonly getAssemblies: () => Assembly[]) {}

  render(ctx: CanvasRenderingContext2D, viewport: Viewport, _timestamp: number): void {
    const { bounds, canvas } = viewport;

    for (const assembly of this.getAssemblies()) {
      // Use the compound root's live angle — individual part body .angle values are frozen
      // at construction time and are not updated by the physics engine during rotation.
      const assemblyAngle = assembly.rootBody.angle;
      for (const entity of assembly.entities) {
        if (entity.destroyed) continue;
        const pos = entity.body.position;
        if (pos.x < bounds.min.x - 100 || pos.x > bounds.max.x + 100 ||
            pos.y < bounds.min.y - 100 || pos.y > bounds.max.y + 100) continue;
        entity.drawBlockFrills(ctx, bounds, canvas, assemblyAngle);
      }
    }
  }
}
