import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { BlockPickupSystem } from '../systems/BlockPickupSystem';

export class BlockPickupRenderer implements IRenderer {
  readonly renderPriority = 70;

  private graphics!: PIXI.Graphics;

  constructor(
    private readonly pickupSystem: BlockPickupSystem,
  ) {}

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
  }

  render(viewport: Viewport, _timestamp: number): void {
    this.graphics.clear();
    if (!this.pickupSystem.isHolding()) return;
    this.pickupSystem.renderOverlay(this.graphics, viewport);
  }
}
