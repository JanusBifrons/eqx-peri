import * as Matter from 'matter-js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';
import { BlockPickupSystem } from '../systems/BlockPickupSystem';

export class BlockPickupRenderer implements IRenderer {
  readonly renderPriority = 70;

  constructor(
    private readonly pickupSystem: BlockPickupSystem,
    private readonly getPlayerAssembly: () => Assembly | null,
  ) {}

  render(ctx: CanvasRenderingContext2D, viewport: Viewport, _timestamp: number): void {
    if (!this.pickupSystem.isHolding()) return;
    const bounds: Matter.Bounds = viewport.bounds;
    this.pickupSystem.renderOverlay(ctx, bounds, this.getPlayerAssembly());
  }
}
