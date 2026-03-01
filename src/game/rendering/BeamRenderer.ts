import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { ActiveBeam, BeamSystem } from '../weapons/BeamSystem';
import { BEAM_DISPLAY_DURATION_MS } from '../../types/GameTypes';

// Visual configuration per weapon type
const BEAM_STYLES: Record<string, { coreColor: string; glowColor: string; coreWidth: number; glowWidth: number }> = {
  Beam: {
    coreColor: '#ffffff',
    glowColor: '#00ddff',
    coreWidth: 2,
    glowWidth: 8,
  },
  LargeBeam: {
    coreColor: '#ffffff',
    glowColor: '#4488ff',
    coreWidth: 4,
    glowWidth: 14,
  },
};

const DEFAULT_STYLE = BEAM_STYLES['Beam'];

export class BeamRenderer implements IRenderer {
  readonly renderPriority = 45;

  constructor(private readonly beamSystem: BeamSystem) {}

  render(ctx: CanvasRenderingContext2D, viewport: Viewport, _timestamp: number): void {
    const { bounds, canvas } = viewport;
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const sx = (wx: number) => (wx - bounds.min.x) / bw * canvas.width;
    const sy = (wy: number) => (wy - bounds.min.y) / bh * canvas.height;
    const scale = canvas.width / bw;
    const now = Date.now();

    for (const beam of this.beamSystem.getActiveBeams()) {
      // Rough culling — skip if entirely off-screen
      if (
        Math.max(beam.startX, beam.endX) < bounds.min.x - 50 ||
        Math.min(beam.startX, beam.endX) > bounds.max.x + 50 ||
        Math.max(beam.startY, beam.endY) < bounds.min.y - 50 ||
        Math.min(beam.startY, beam.endY) > bounds.max.y + 50
      ) continue;

      const age = now - beam.lastUpdatedAt;
      // Fade out over the last half of the display duration
      const fadeStart = BEAM_DISPLAY_DURATION_MS * 0.5;
      const alpha = age < fadeStart
        ? 1.0
        : 1.0 - (age - fadeStart) / (BEAM_DISPLAY_DURATION_MS - fadeStart);

      if (alpha <= 0) continue;

      this.drawBeam(ctx, viewport, sx, sy, scale, beam, alpha);
    }
  }

  private drawBeam(
    ctx: CanvasRenderingContext2D,
    _viewport: Viewport,
    sx: (wx: number) => number,
    sy: (wy: number) => number,
    scale: number,
    beam: ActiveBeam,
    alpha: number,
  ): void {
    const x1 = sx(beam.startX);
    const y1 = sy(beam.startY);
    const x2 = sx(beam.endX);
    const y2 = sy(beam.endY);

    const style = BEAM_STYLES[beam.weaponType] ?? DEFAULT_STYLE;

    // --- Outer glow ---
    ctx.globalAlpha = alpha * 0.35;
    ctx.strokeStyle = style.glowColor;
    ctx.lineWidth = style.glowWidth * scale * 0.25;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // --- Mid glow ---
    ctx.globalAlpha = alpha * 0.6;
    ctx.strokeStyle = style.glowColor;
    ctx.lineWidth = (style.glowWidth * 0.5) * scale * 0.25;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // --- Bright core ---
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = style.coreColor;
    ctx.lineWidth = style.coreWidth * scale * 0.25;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // --- Impact flash at hit point ---
    if (beam.hit) {
      const flashRadius = style.glowWidth * scale * 0.25;
      ctx.globalAlpha = alpha * 0.7;
      ctx.fillStyle = style.coreColor;
      ctx.beginPath();
      ctx.arc(x2, y2, flashRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = alpha * 0.4;
      ctx.fillStyle = style.glowColor;
      ctx.beginPath();
      ctx.arc(x2, y2, flashRadius * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }
}
