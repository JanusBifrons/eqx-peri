import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';

/** Line colour — hostile red. */
const ENGAGE_COLOR = 0xff4444;
/** Line alpha. */
const ENGAGE_ALPHA = 0.5;
/** Endpoint dot alpha. */
const DOT_ALPHA = 0.7;

export interface EngagementTarget {
  assembly: Assembly;
  target: Assembly;
}

/**
 * Renders a red line from a selected AI ship to its current combat target.
 * Similar to OrderRenderer's green move-order line but for engagement.
 *
 * Priority 53 — drawn just above OrderRenderer (52).
 */
export class EngagementRenderer implements IRenderer {
  readonly renderPriority = 53;
  readonly renderSpace = 'world' as const;

  private gfx!: PIXI.Graphics;
  private getEngagements: () => EngagementTarget[];

  constructor(
    getEngagements: () => EngagementTarget[],
  ) {
    this.getEngagements = getEngagements;
  }

  init(stage: PIXI.Container): void {
    this.gfx = new PIXI.Graphics();
    stage.addChild(this.gfx);
  }

  render(viewport: Viewport, _timestamp: number): void {
    this.gfx.clear();

    const engagements = this.getEngagements();
    for (const { assembly, target } of engagements) {
      this.renderEngagementLine(viewport, assembly, target);
    }
  }

  private renderEngagementLine(
    viewport: Viewport,
    assembly: Assembly,
    target: Assembly,
  ): void {
    const origin = assembly.rootBody.position;
    const dest = target.rootBody.position;
    const scale = viewport.scale;

    const dotRadius = 4 / scale;

    // Draw line from ship to target
    this.gfx.lineStyle(1.5 / scale, ENGAGE_COLOR, ENGAGE_ALPHA);
    this.gfx.moveTo(origin.x, origin.y);
    this.gfx.lineTo(dest.x, dest.y);
    this.gfx.lineStyle(0);

    // Origin dot (on the ship)
    this.gfx.beginFill(ENGAGE_COLOR, DOT_ALPHA);
    this.gfx.drawCircle(origin.x, origin.y, dotRadius);
    this.gfx.endFill();

    // Target dot
    this.gfx.beginFill(ENGAGE_COLOR, DOT_ALPHA);
    this.gfx.drawCircle(dest.x, dest.y, dotRadius);
    this.gfx.endFill();
  }

  dispose(): void {
    this.gfx.destroy();
  }
}
