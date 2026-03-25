import * as PIXI from 'pixi.js';
import { GlowFilter, AdvancedBloomFilter } from 'pixi-filters';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { ActiveBeam, BeamSystem } from '../weapons/BeamSystem';
import { BEAM_DISPLAY_DURATION_MS } from '../../types/GameTypes';

interface BeamStyle {
  coreColor: number;
  glowColor: number;
  arcColor: number;
  coreWidth: number;
  glowWidth: number;
  arcCount: number;
}

const BEAM_STYLES: Record<string, BeamStyle> = {
  Beam:        { coreColor: 0xffffff, glowColor: 0x00ddff, arcColor: 0x88ffff, coreWidth: 2, glowWidth: 8,  arcCount: 3 },
  LargeBeam:   { coreColor: 0xffffff, glowColor: 0x4488ff, arcColor: 0x99ccff, coreWidth: 4, glowWidth: 14, arcCount: 5 },
  MiningLaser:  { coreColor: 0xffcccc, glowColor: 0xcc3333, arcColor: 0xff6666, coreWidth: 1.5, glowWidth: 6,  arcCount: 1 },
  TractorBeam:  { coreColor: 0xaaffcc, glowColor: 0x22aa55, arcColor: 0x44cc77, coreWidth: 1.5, glowWidth: 6,  arcCount: 0 },
};

const DEFAULT_STYLE = BEAM_STYLES['Beam'];

// How often (ms) the electrical arc pattern regenerates — gives the "alive wire" flicker
const ARC_FLICKER_MS = 70;

// Seeded pseudo-random generator so arcs are deterministic per weapon+tick
function seededRng(seed: number): () => number {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  return (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s = s >>> 0;
    return s / 0x100000000;
  };
}

// Stable hash for a string (used to derive per-weapon arc seed)
function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export class BeamRenderer implements IRenderer {
  readonly renderPriority = 45;
  readonly renderSpace = 'world' as const;

  private beamContainer!: PIXI.Container;
  private graphics!: PIXI.Graphics;
  private glowFilter!: GlowFilter;
  private bloomFilter!: AdvancedBloomFilter;

  constructor(private readonly beamSystem: BeamSystem) {}

  init(stage: PIXI.Container): void {
    this.beamContainer = new PIXI.Container();
    // ADD blend mode: overlapping bright beam layers compound instead of averaging,
    // giving an intense energy-weapon look against the dark space background.
    // @ts-expect-error PIXI v7 types omit blendMode on Container but it exists at runtime
    this.beamContainer.blendMode = PIXI.BLEND_MODES.ADD;

    this.graphics = new PIXI.Graphics();
    this.beamContainer.addChild(this.graphics);

    // GlowFilter: wide electric halo around every drawn pixel
    this.glowFilter = new GlowFilter({
      distance:      22,
      outerStrength: 3.0,
      innerStrength: 0.4,
      color:         0x0099ff,
      quality:       0.3,
    });

    // AdvancedBloomFilter: bright-pixel bloom/bleed for the "hot plasma" look
    this.bloomFilter = new AdvancedBloomFilter({
      threshold:  0.25,
      bloomScale: 1.4,
      brightness: 1.3,
      blur:       8,
      quality:    4,
    });

    this.beamContainer.filters = [this.glowFilter, this.bloomFilter];
    stage.addChild(this.beamContainer);
  }

  render(viewport: Viewport, timestamp: number): void {
    this.graphics.clear();

    const { bounds } = viewport;
    const scale = viewport.scale;
    const now = Date.now();

    // Adjust filter parameters for zoom so they remain consistent in screen pixels.
    // GlowFilter.distance is immutable after construction, so scale outerStrength instead.
    this.glowFilter.outerStrength = 3.0 / scale;
    this.bloomFilter.blur = 8 / scale;

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

      if (beam.coneHalfAngle != null && beam.beamAngle != null) {
        this.drawTractorCone(beam, alpha, timestamp);
      } else {
        this.drawBeam(beam, alpha, timestamp);
      }
    }
  }

  /**
   * Draw a tractor beam as a wide translucent cone/fan shape.
   */
  private drawTractorCone(beam: ActiveBeam, alpha: number, _timestamp: number): void {
    const x1 = beam.startX, y1 = beam.startY;
    const angle = beam.beamAngle!;
    const halfAngle = beam.coneHalfAngle!;
    const dx = beam.endX - x1, dy = beam.endY - y1;
    const range = Math.sqrt(dx * dx + dy * dy);
    if (range < 5) return;

    const style = BEAM_STYLES['TractorBeam'] ?? DEFAULT_STYLE;

    const leftAngle = angle - halfAngle;
    const rightAngle = angle + halfAngle;

    // Single subtle translucent cone fill
    const arcSteps = 10;
    this.graphics.beginFill(style.glowColor, alpha * 0.035);
    this.graphics.moveTo(x1, y1);
    for (let s = 0; s <= arcSteps; s++) {
      const a = leftAngle + (rightAngle - leftAngle) * (s / arcSteps);
      this.graphics.lineTo(x1 + Math.cos(a) * range, y1 + Math.sin(a) * range);
    }
    this.graphics.closePath();
    this.graphics.endFill();

    // Faint edge lines
    const edgeWidth = Math.max(0.5, 1);
    this.graphics.lineStyle(edgeWidth, style.coreColor, alpha * 0.15);
    this.graphics.moveTo(x1, y1);
    this.graphics.lineTo(x1 + Math.cos(leftAngle) * range, y1 + Math.sin(leftAngle) * range);
    this.graphics.moveTo(x1, y1);
    this.graphics.lineTo(x1 + Math.cos(rightAngle) * range, y1 + Math.sin(rightAngle) * range);

    // Thin center line
    this.graphics.lineStyle(edgeWidth * 0.5, style.coreColor, alpha * 0.1);
    this.graphics.moveTo(x1, y1);
    this.graphics.lineTo(beam.endX, beam.endY);
  }

  private drawBeam(
    beam: ActiveBeam,
    alpha: number,
    timestamp: number,
  ): void {
    const x1 = beam.startX, y1 = beam.startY;
    const x2 = beam.endX,   y2 = beam.endY;
    const style = BEAM_STYLES[beam.weaponType as string] ?? DEFAULT_STYLE;
    // Scale factor for beam widths — widths are in world units
    const sf = 0.25;

    // --- Four-layer beam: outermost halo → tight glow → inner glow → white core ---
    this.graphics.lineStyle(style.glowWidth * sf * 2.5, style.glowColor, alpha * 0.10);
    this.graphics.moveTo(x1, y1); this.graphics.lineTo(x2, y2);

    this.graphics.lineStyle(style.glowWidth * sf * 1.4, style.glowColor, alpha * 0.28);
    this.graphics.moveTo(x1, y1); this.graphics.lineTo(x2, y2);

    this.graphics.lineStyle(style.glowWidth * sf * 0.6, style.glowColor, alpha * 0.65);
    this.graphics.moveTo(x1, y1); this.graphics.lineTo(x2, y2);

    this.graphics.lineStyle(style.coreWidth * sf, style.coreColor, alpha);
    this.graphics.moveTo(x1, y1); this.graphics.lineTo(x2, y2);

    // --- Electrical arc offshoots ---
    const flickerTick = Math.floor(timestamp / ARC_FLICKER_MS);
    const arcSeed = hashString(beam.weaponId) ^ (flickerTick * 0x9e3779b9);
    this.drawArcs(x1, y1, x2, y2, style, sf, alpha, arcSeed);

    // --- Impact flash (three concentric circles at hit point) ---
    if (beam.hit) {
      const r = style.glowWidth * sf;
      this.graphics.lineStyle(0);

      this.graphics.beginFill(style.coreColor, alpha * 0.9);
      this.graphics.drawCircle(x2, y2, r * 0.6);
      this.graphics.endFill();

      this.graphics.beginFill(style.glowColor, alpha * 0.55);
      this.graphics.drawCircle(x2, y2, r * 1.8);
      this.graphics.endFill();

      this.graphics.beginFill(style.glowColor, alpha * 0.18);
      this.graphics.drawCircle(x2, y2, r * 4.0);
      this.graphics.endFill();
    }
  }

  /**
   * Draws procedural electrical arc branches that flicker every ARC_FLICKER_MS.
   */
  private drawArcs(
    x1: number, y1: number,
    x2: number, y2: number,
    style: BeamStyle,
    sf: number,
    alpha: number,
    seed: number,
  ): void {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 20) return;

    // Unit vectors: ux/uy along beam, nx/ny perpendicular
    const ux = dx / len, uy = dy / len;
    const nx = -uy,      ny = ux;

    const rng = seededRng(seed);

    for (let i = 0; i < style.arcCount; i++) {
      const t = 0.15 + rng() * 0.70;
      let cx = x1 + ux * len * t;
      let cy = y1 + uy * len * t;

      const side = rng() > 0.5 ? 1 : -1;
      const spread = len * (0.04 + rng() * 0.05);
      const nSegs = 2 + Math.floor(rng() * 2);

      this.graphics.lineStyle(sf * 0.7, style.arcColor, alpha * (0.35 + rng() * 0.35));
      this.graphics.moveTo(cx, cy);

      for (let s = 0; s < nSegs; s++) {
        const forwardJitter = (rng() - 0.4) * spread * 0.25;
        const perpStep      = side * (0.4 + rng() * 0.6) * spread / nSegs;
        cx += ux * forwardJitter + nx * perpStep;
        cy += uy * forwardJitter + ny * perpStep;
        this.graphics.lineTo(cx, cy);
      }
    }
  }

  dispose(): void {
    this.beamContainer.destroy({ children: true });
  }
}
