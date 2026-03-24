import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';
import { AIOrder, MoveOrder } from '../../types/GameTypes';

/** Radius of the endpoint dots (screen pixels). */
const DOT_RADIUS = 4;
/** Radius of intermediate waypoint dots. */
const WAYPOINT_DOT_RADIUS = 2.5;
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

    // Build the screen-space polyline: ship → remaining waypoints
    const from = viewport.worldToScreen(origin.x, origin.y);

    // Draw line through remaining waypoints
    this.gfx.lineStyle(1.5, ORDER_COLOR, ORDER_ALPHA);
    this.gfx.moveTo(from.x, from.y);

    for (let i = currentWaypointIndex; i < waypoints.length; i++) {
      const wp = waypoints[i];
      const s = viewport.worldToScreen(wp.x, wp.y);
      this.gfx.lineTo(s.x, s.y);
    }
    this.gfx.lineStyle(0);

    // Origin dot
    this.gfx.beginFill(ORDER_COLOR, DOT_ALPHA);
    this.gfx.drawCircle(from.x, from.y, DOT_RADIUS);
    this.gfx.endFill();

    // Intermediate waypoint dots (dimmer, smaller)
    for (let i = currentWaypointIndex; i < waypoints.length - 1; i++) {
      const wp = waypoints[i];
      const s = viewport.worldToScreen(wp.x, wp.y);
      this.gfx.beginFill(ORDER_COLOR, WAYPOINT_ALPHA);
      this.gfx.drawCircle(s.x, s.y, WAYPOINT_DOT_RADIUS);
      this.gfx.endFill();
    }

    // Final target dot (bright, full size)
    const last = waypoints[waypoints.length - 1];
    const to = viewport.worldToScreen(last.x, last.y);
    this.gfx.beginFill(ORDER_COLOR, DOT_ALPHA);
    this.gfx.drawCircle(to.x, to.y, DOT_RADIUS);
    this.gfx.endFill();
  }

  dispose(): void {
    this.gfx.destroy();
  }
}
