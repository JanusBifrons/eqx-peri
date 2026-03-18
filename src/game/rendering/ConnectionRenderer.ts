import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Connection } from '../structures/Connection';

const FLASH_DURATION_MS = 300;

export class ConnectionRenderer implements IRenderer {
  readonly renderPriority = 13;

  private graphics!: PIXI.Graphics;

  constructor(private readonly getConnections: () => Connection[]) {}

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
  }

  render(viewport: Viewport): void {
    this.graphics.clear();

    const { bounds, canvas } = viewport;
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const sx = (wx: number): number => (wx - bounds.min.x) / bw * canvas.width;
    const sy = (wy: number): number => (wy - bounds.min.y) / bh * canvas.height;
    const scale = canvas.width / bw;
    const now = Date.now();

    for (const conn of this.getConnections()) {
      const ax = sx(conn.nodeA.body.position.x);
      const ay = sy(conn.nodeA.body.position.y);
      const bx = sx(conn.nodeB.body.position.x);
      const by = sy(conn.nodeB.body.position.y);

      // Viewport culling — skip if both endpoints are off-screen with margin
      const margin = 20;
      if (
        (ax < -margin && bx < -margin) ||
        (ax > canvas.width + margin && bx > canvas.width + margin) ||
        (ay < -margin && by < -margin) ||
        (ay > canvas.height + margin && by > canvas.height + margin)
      ) continue;

      // Flash state
      const flashing = now < conn.flashUntil;
      const flashProgress = flashing
        ? 1 - (conn.flashUntil - now) / FLASH_DURATION_MS
        : 1;

      // Line style
      const lineWidth = Math.max(1, (flashing ? 2.5 : 1) * scale);
      const color = flashing ? 0x44ddff : 0x4488aa;
      const alpha = flashing ? 0.9 - flashProgress * 0.5 : 0.3;

      this.graphics.lineStyle(lineWidth, color, alpha);
      this.graphics.moveTo(ax, ay);
      this.graphics.lineTo(bx, by);

      // Flash glow — thicker semi-transparent line on top
      if (flashing) {
        const glowAlpha = (1 - flashProgress) * 0.3;
        const glowWidth = lineWidth * 3;
        this.graphics.lineStyle(glowWidth, 0x88eeff, glowAlpha);
        this.graphics.moveTo(ax, ay);
        this.graphics.lineTo(bx, by);
      }
    }
  }
}
