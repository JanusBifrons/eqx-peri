import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Missile } from '../weapons/Missile';

/**
 * Renders missiles as elongated arrow shapes with thrust trails.
 * World-space renderer — priority 23 (between particles and frills).
 */
export class MissileRenderer implements IRenderer {
  readonly renderPriority = 23;
  readonly renderSpace = 'world' as const;

  private graphics!: PIXI.Graphics;
  private readonly getMissiles: () => Missile[];

  constructor(getMissiles: () => Missile[]) {
    this.getMissiles = getMissiles;
  }

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
  }

  render(viewport: Viewport, _timestamp: number): void {
    const g = this.graphics;
    g.clear();

    const scale = viewport.scale;
    const missiles = this.getMissiles();

    for (const missile of missiles) {
      if (missile.destroyed) continue;

      const pos = missile.body.position;
      const angle = missile.body.angle;
      const vel = missile.body.velocity;
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);

      // Missile body color by variant
      let bodyColor: number;
      let trailColor: number;
      switch (missile.config.variant) {
        case 'tracking':  bodyColor = 0xff6600; trailColor = 0xff4400; break;
        case 'standard':  bodyColor = 0xff3300; trailColor = 0xff2200; break;
        case 'torpedo':   bodyColor = 0xffaa00; trailColor = 0xff8800; break;
      }

      // Size based on launcher
      let length: number;
      let halfWidth: number;
      switch (missile.config.launcherSize) {
        case 'small':   length = 12; halfWidth = 3; break;
        case 'large':   length = 16; halfWidth = 4; break;
        case 'capital':  length = 20; halfWidth = 5; break;
      }

      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      // Draw thrust trail (line behind missile)
      if (speed > 1 && missile.phase !== 'launch') {
        const trailLength = Math.min(speed * 3, 40);
        const lineWidth = Math.max(1 / scale, halfWidth * 0.8);
        g.lineStyle(lineWidth, trailColor, 0.6);
        g.moveTo(pos.x, pos.y);
        g.lineTo(pos.x - cos * trailLength, pos.y - sin * trailLength);
        g.lineStyle(0);
      }

      // Draw missile body as an elongated triangle/arrow
      const noseX = pos.x + cos * length * 0.6;
      const noseY = pos.y + sin * length * 0.6;
      const leftX = pos.x - cos * length * 0.4 + sin * halfWidth;
      const leftY = pos.y - sin * length * 0.4 - cos * halfWidth;
      const rightX = pos.x - cos * length * 0.4 - sin * halfWidth;
      const rightY = pos.y - sin * length * 0.4 + cos * halfWidth;

      g.beginFill(bodyColor, 1.0);
      g.moveTo(noseX, noseY);
      g.lineTo(leftX, leftY);
      g.lineTo(rightX, rightY);
      g.closePath();
      g.endFill();

      // White nose tip
      const tipSize = Math.max(1 / scale, 1.5);
      g.beginFill(0xffffff, 0.9);
      g.drawCircle(noseX, noseY, tipSize);
      g.endFill();
    }
  }

  dispose(): void {
    this.graphics.destroy();
  }
}
