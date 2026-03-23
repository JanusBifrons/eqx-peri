import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';
import { AIOrder } from '../../types/GameTypes';

/** Radius of the endpoint dots (screen pixels). */
const DOT_RADIUS = 4;
/** Line colour — friendly green. */
const ORDER_COLOR = 0x44ff44;
/** Line alpha. */
const ORDER_ALPHA = 0.6;
/** Dot alpha. */
const DOT_ALPHA = 0.85;

/**
 * Renders active AI orders as visual indicators in world space.
 * Move orders: green line from the assembly's cockpit to the target position,
 * with a dot at each end.
 *
 * Priority 52 — drawn just above ShipHighlightRenderer (50).
 */
export class OrderRenderer implements IRenderer {
  readonly renderPriority = 52;

  private gfx!: PIXI.Graphics;
  private getActiveOrders: () => Array<{ assembly: Assembly; order: AIOrder }>;

  constructor(
    getActiveOrders: () => Array<{ assembly: Assembly; order: AIOrder }>,
  ) {
    this.getActiveOrders = getActiveOrders;
  }

  init(stage: PIXI.Container): void {
    this.gfx = new PIXI.Graphics();
    stage.addChild(this.gfx);
  }

  render(viewport: Viewport, _timestamp: number): void {
    this.gfx.clear();

    const orders = this.getActiveOrders();
    for (const { assembly, order } of orders) {
      if (order.type === 'move') {
        this.renderMoveOrder(viewport, assembly, order.targetPosition);
      }
    }
  }

  private renderMoveOrder(
    viewport: Viewport,
    assembly: Assembly,
    target: { x: number; y: number },
  ): void {
    // Origin: assembly cockpit (control center) world position
    const origin = assembly.rootBody.position;
    const from = viewport.worldToScreen(origin.x, origin.y);
    const to = viewport.worldToScreen(target.x, target.y);

    // Line
    this.gfx.lineStyle(1.5, ORDER_COLOR, ORDER_ALPHA);
    this.gfx.moveTo(from.x, from.y);
    this.gfx.lineTo(to.x, to.y);
    this.gfx.lineStyle(0);

    // Origin dot
    this.gfx.beginFill(ORDER_COLOR, DOT_ALPHA);
    this.gfx.drawCircle(from.x, from.y, DOT_RADIUS);
    this.gfx.endFill();

    // Target dot
    this.gfx.beginFill(ORDER_COLOR, DOT_ALPHA);
    this.gfx.drawCircle(to.x, to.y, DOT_RADIUS);
    this.gfx.endFill();
  }

  dispose(): void {
    this.gfx.destroy();
  }
}
