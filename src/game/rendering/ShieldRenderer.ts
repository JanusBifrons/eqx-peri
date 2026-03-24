import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';

export class ShieldRenderer implements IRenderer {
  readonly renderPriority = 40;
  readonly renderSpace = 'world' as const;

  private graphics!: PIXI.Graphics;

  constructor(private readonly getAssemblies: () => Assembly[]) {}

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
  }

  render(viewport: Viewport, timestamp: number): void {
    this.graphics.clear();

    const { bounds } = viewport;
    const scale = viewport.scale;
    const now = Date.now();

    for (const assembly of this.getAssemblies()) {
      const s = assembly.shieldState;
      if (!s) continue;

      const bubbles = assembly.getShieldBubbles();
      if (bubbles.length === 0) continue;

      for (const bubble of bubbles) {
        if (
          bubble.x < bounds.min.x - bubble.radius || bubble.x > bounds.max.x + bubble.radius ||
          bubble.y < bounds.min.y - bubble.radius || bubble.y > bounds.max.y + bubble.radius
        ) continue;

        // Draw in world coords — WorldContainer handles transform
        if (s.isActive && s.currentHp > 0) {
          const hpRatio = s.currentHp / Math.max(1, s.maxHp);
          const timeSinceHit = now - s.lastHitTime;
          const hitFlash = Math.max(0, 1 - timeSinceHit / 300);
          const isRegen = s.currentHp < s.maxHp && timeSinceHit >= 3000;
          const regenPulse = isRegen ? (Math.sin(timestamp / 150) * 0.15 + 0.85) : 1;
          const baseAlpha = hpRatio * 0.28 + 0.07;
          const alpha = Math.min(1, (baseAlpha + hitFlash * 0.35) * regenPulse);

          // Approximate radial gradient with concentric filled circles (outer→inner)
          this.graphics.lineStyle(0);
          this.graphics.beginFill(0x1e50dc, alpha * 0.6);
          this.graphics.drawCircle(bubble.x, bubble.y, bubble.radius);
          this.graphics.endFill();
          this.graphics.beginFill(0x3c82ff, alpha * 0.25);
          this.graphics.drawCircle(bubble.x, bubble.y, bubble.radius * 0.7);
          this.graphics.endFill();
          this.graphics.beginFill(0x64b4ff, alpha * 0.15);
          this.graphics.drawCircle(bubble.x, bubble.y, bubble.radius * 0.4);
          this.graphics.endFill();

          // Rim — ensure minimum 1 screen pixel width
          const rimAlpha = Math.min(1, 0.5 + hitFlash * 0.5);
          const rimWidth = Math.max(1 / scale, 2) * (1 + hitFlash * 0.5);
          this.graphics.lineStyle(rimWidth, 0x78c8ff, rimAlpha);
          this.graphics.drawCircle(bubble.x, bubble.y, bubble.radius);

        } else if (!s.isActive) {
          const timeLeft = s.cooldownUntil - now;
          if (timeLeft > 0) {
            const pulse = Math.sin(timestamp / 400) * 0.3 + 0.4;
            this.graphics.lineStyle(Math.max(1 / scale, 1.5), 0x3c50a0, pulse * 0.4);
            this.graphics.drawCircle(bubble.x, bubble.y, bubble.radius);
          }
        }
      }
    }
  }
}
