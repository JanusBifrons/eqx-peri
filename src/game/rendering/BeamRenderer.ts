import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { ActiveBeam, BeamSystem } from '../weapons/BeamSystem';
import { BEAM_DISPLAY_DURATION_MS } from '../../types/GameTypes';

interface BeamStyle {
  coreColor: number;
  glowColor: number;
  coreWidth: number;
  glowWidth: number;
}

const BEAM_STYLES: Record<string, BeamStyle> = {
  Beam:      { coreColor: 0xffffff, glowColor: 0x00ddff, coreWidth: 2, glowWidth: 8 },
  LargeBeam: { coreColor: 0xffffff, glowColor: 0x4488ff, coreWidth: 4, glowWidth: 14 },
};

const DEFAULT_STYLE = BEAM_STYLES['Beam'];

export class BeamRenderer implements IRenderer {
  readonly renderPriority = 45;

  private graphics!: PIXI.Graphics;

  constructor(private readonly beamSystem: BeamSystem) {}

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
  }

  render(viewport: Viewport, _timestamp: number): void {
    this.graphics.clear();

    const { bounds, canvas } = viewport;
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const sx = (wx: number) => (wx - bounds.min.x) / bw * canvas.width;
    const sy = (wy: number) => (wy - bounds.min.y) / bh * canvas.height;
    const scale = canvas.width / bw;
    const now = Date.now();

    for (const beam of this.beamSystem.getActiveBeams()) {
      if (
        Math.max(beam.startX, beam.endX) < bounds.min.x - 50 ||
        Math.min(beam.startX, beam.endX) > bounds.max.x + 50 ||
        Math.max(beam.startY, beam.endY) < bounds.min.y - 50 ||
        Math.min(beam.startY, beam.endY) > bounds.max.y + 50
      ) continue;

      const age = now - beam.lastUpdatedAt;
      const fadeStart = BEAM_DISPLAY_DURATION_MS * 0.5;
      const alpha = age < fadeStart
        ? 1.0
        : 1.0 - (age - fadeStart) / (BEAM_DISPLAY_DURATION_MS - fadeStart);
      if (alpha <= 0) continue;

      this.drawBeam(sx, sy, scale, beam, alpha);
    }
  }

  private drawBeam(
    sx: (wx: number) => number,
    sy: (wy: number) => number,
    scale: number,
    beam: ActiveBeam,
    alpha: number,
  ): void {
    const x1 = sx(beam.startX), y1 = sy(beam.startY);
    const x2 = sx(beam.endX),   y2 = sy(beam.endY);
    const style = BEAM_STYLES[beam.weaponType] ?? DEFAULT_STYLE;
    const sf = scale * 0.25;

    this.graphics.lineStyle(style.glowWidth * sf,       style.glowColor, alpha * 0.35);
    this.graphics.moveTo(x1, y1); this.graphics.lineTo(x2, y2);

    this.graphics.lineStyle(style.glowWidth * 0.5 * sf, style.glowColor, alpha * 0.6);
    this.graphics.moveTo(x1, y1); this.graphics.lineTo(x2, y2);

    this.graphics.lineStyle(style.coreWidth * sf,       style.coreColor, alpha);
    this.graphics.moveTo(x1, y1); this.graphics.lineTo(x2, y2);

    if (beam.hit) {
      const r = style.glowWidth * sf;
      this.graphics.lineStyle(0);
      this.graphics.beginFill(style.coreColor, alpha * 0.7);
      this.graphics.drawCircle(x2, y2, r);
      this.graphics.endFill();
      this.graphics.beginFill(style.glowColor, alpha * 0.4);
      this.graphics.drawCircle(x2, y2, r * 2.5);
      this.graphics.endFill();
    }
  }
}
