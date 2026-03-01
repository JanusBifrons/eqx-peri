import * as Matter from 'matter-js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';

export class ShieldRenderer implements IRenderer {
  readonly renderPriority = 40;

  constructor(private readonly getAssemblies: () => Assembly[]) {}

  render(ctx: CanvasRenderingContext2D, viewport: Viewport, timestamp: number): void {
    const { bounds, canvas } = viewport;
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const sx = (wx: number) => (wx - bounds.min.x) / bw * canvas.width;
    const sy = (wy: number) => (wy - bounds.min.y) / bh * canvas.height;
    const scale = canvas.width / bw;
    const now = Date.now();

    for (const assembly of this.getAssemblies()) {
      const s = assembly.shieldState;
      if (!s) continue;

      // The shield circle part tracks its world position in rootBody.parts (maintained by
      // Matter.js). Fall back to rootBody.position if the shield part is not present.
      const shieldPart = assembly.rootBody.parts.find((p: Matter.Body) => (p as any).isShieldPart);
      const pos = shieldPart ? shieldPart.position : assembly.rootBody.position;

      // Rough culling
      if (pos.x < bounds.min.x - 400 || pos.x > bounds.max.x + 400 ||
          pos.y < bounds.min.y - 400 || pos.y > bounds.max.y + 400) continue;

      const screenX = sx(pos.x);
      const screenY = sy(pos.y);
      const radius = assembly.getShieldRadius() * scale;

      if (s.isActive && s.currentHp > 0) {
        const hpRatio = s.currentHp / Math.max(1, s.maxHp);
        const timeSinceHit = now - s.lastHitTime;
        const hitFlash = Math.max(0, 1 - timeSinceHit / 300);

        const isRegen = s.currentHp < s.maxHp && timeSinceHit >= 3000;
        const regenPulse = isRegen ? (Math.sin(timestamp / 150) * 0.15 + 0.85) : 1;

        const baseAlpha = hpRatio * 0.28 + 0.07;
        const alpha = Math.min(1, (baseAlpha + hitFlash * 0.35) * regenPulse);

        const gradient = ctx.createRadialGradient(screenX, screenY, radius * 0.6, screenX, screenY, radius);
        gradient.addColorStop(0, `rgba(100, 180, 255, ${alpha * 0.15})`);
        gradient.addColorStop(0.7, `rgba(60, 130, 255, ${alpha * 0.25})`);
        gradient.addColorStop(1, `rgba(30, 80, 220, ${alpha * 0.6})`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
        ctx.fill();

        const rimAlpha = Math.min(1, 0.5 + hitFlash * 0.5);
        ctx.strokeStyle = `rgba(120, 200, 255, ${rimAlpha})`;
        ctx.lineWidth = Math.max(1, scale * 2) * (1 + hitFlash * 0.5);
        ctx.beginPath();
        ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
        ctx.stroke();

      } else if (!s.isActive) {
        const timeLeft = s.cooldownUntil - now;
        if (timeLeft > 0) {
          const pulse = Math.sin(timestamp / 400) * 0.3 + 0.4;
          ctx.strokeStyle = `rgba(60, 80, 160, ${pulse * 0.4})`;
          ctx.lineWidth = Math.max(1, scale * 1.5);
          ctx.setLineDash([Math.max(3, scale * 6), Math.max(4, scale * 8)]);
          ctx.beginPath();
          ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }
}
