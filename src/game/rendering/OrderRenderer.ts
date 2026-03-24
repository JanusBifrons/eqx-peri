import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';
import { AIOrder, MoveOrder } from '../../types/GameTypes';

/** Line colour — friendly green. */
const ORDER_COLOR = 0x44ff44;
/** Line alpha. */
const ORDER_ALPHA = 0.6;
/** Dot alpha. */
const DOT_ALPHA = 0.85;
/** Intermediate waypoint alpha (dimmer than endpoints). */
const WAYPOINT_ALPHA = 0.4;

/**
 * Renders active AI orders as visual indicators in world space.
 * Move orders: green polyline from ship through waypoints to target,
 * with dots at the ship, each waypoint, and the final target.
 *
 * Priority 52 — drawn just above ShipHighlightRenderer (50).
 */
export class OrderRenderer implements IRenderer {
  readonly renderPriority = 52;
  readonly renderSpace = 'world' as const;

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
        this.renderMoveOrder(viewport, assembly, order);
      }
    }
  }

  private renderMoveOrder(
    viewport: Viewport,
    assembly: Assembly,
    order: MoveOrder,
  ): void {
    const origin = assembly.rootBody.position;
    const { waypoints, currentWaypointIndex } = order;
    const scale = viewport.scale;

    // Radius of endpoint/waypoint dots in world units (fixed screen size)
    const dotRadius = 4 / scale;
    const waypointDotRadius = 2.5 / scale;

    // Draw line through remaining waypoints
    this.gfx.lineStyle(1.5 / scale, ORDER_COLOR, ORDER_ALPHA);
    this.gfx.moveTo(origin.x, origin.y);

    for (let i = currentWaypointIndex; i < waypoints.length; i++) {
      const wp = waypoints[i];
      this.gfx.lineTo(wp.x, wp.y);
    }
    this.gfx.lineStyle(0);

    // Origin dot
    this.gfx.beginFill(ORDER_COLOR, DOT_ALPHA);
    this.gfx.drawCircle(origin.x, origin.y, dotRadius);
    this.gfx.endFill();

    // Intermediate waypoint dots (dimmer, smaller)
    for (let i = currentWaypointIndex; i < waypoints.length - 1; i++) {
      const wp = waypoints[i];
      this.gfx.beginFill(ORDER_COLOR, WAYPOINT_ALPHA);
      this.gfx.drawCircle(wp.x, wp.y, waypointDotRadius);
      this.gfx.endFill();
    }

    // Final target dot (bright, full size)
    const last = waypoints[waypoints.length - 1];
    this.gfx.beginFill(ORDER_COLOR, DOT_ALPHA);
    this.gfx.drawCircle(last.x, last.y, dotRadius);
    this.gfx.endFill();
  }

  dispose(): void {
    this.gfx.destroy();
  }
}
