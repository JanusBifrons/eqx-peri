import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';

/**
 * viewport.scale = canvas.width / viewport_world_width ≈ zoomLevel in this game.
 *
 * Tile sizes are chosen so that ~7 tiles/axis (≈121 tiles) are visible when
 * the layer is at peak visibility. Formula: tileSize ≈ canvas_width / (2 * peakScale * 3.5)
 * This keeps star count roughly constant (~500 stars/layer) throughout the zoom range.
 *
 * Scale windows per layer:
 *   fade starts at peakScale / 2, full brightness around peakScale, fades out at 2× peakScale.
 *   Adjacent layers overlap in crossfade bands so count stays consistent through transitions.
 */
interface StarLayer {
  readonly parallax: number;    // fraction of camera world-pos → background drift
  readonly tileSize: number;    // world units per tile (larger = for zoomed-out view)
  readonly starsPerTile: number;
  readonly radius: number;      // screen pixels
  readonly color: number;
  readonly baseAlpha: number;
  readonly seed: number;
  readonly fadeInAt: number;    // scale: below → alpha fading to 0 (zoom-out kills dim stars)
  readonly fullAt: number;      // scale: above → fully opaque
  readonly dimAt: number;       // scale: above → alpha starts falling
  readonly fadedAt: number;     // scale: above → alpha = 0
}

// Six layers. The first two cover the overview zoom range (scale < 0.5).
// Layers 3-6 cover the gameplay range (scale 0.5-5), one peaking per ~1 zoom step.
// Different tileSize + seed per layer = completely different star positions at each zoom.
const LAYERS: readonly StarLayer[] = [
  // ── OVERVIEW (zoomed far out) ─────────────────────────────────────────────
  // Sparse bright anchors: scale ≈ 0.02 peak  (T = 200/0.02 = 10 000)
  { parallax: 0.50, tileSize: 10000, starsPerTile: 4, radius: 1.8, color: 0xFFFFFF,
    baseAlpha: 0.90, seed: 10, fadeInAt: 0.010, fullAt: 0.018, dimAt: 0.060, fadedAt: 0.10 },
  // Medium overview:       scale ≈ 0.10 peak  (T = 200/0.10 = 2 000)
  { parallax: 0.25, tileSize:  2000, starsPerTile: 4, radius: 1.4, color: 0xEEEEFF,
    baseAlpha: 0.80, seed: 20, fadeInAt: 0.050, fullAt: 0.090, dimAt: 0.28,  fadedAt: 0.45 },

  // ── GAMEPLAY (scale 0.5 → 4, one layer per zoom step) ────────────────────
  // Zoom ≈ 0.5×:           scale ≈ 0.45 peak  (T = 200/0.45 ≈ 440)
  { parallax: 0.12, tileSize:   440, starsPerTile: 4, radius: 1.4, color: 0xEEF2FF,
    baseAlpha: 0.92, seed: 30, fadeInAt: 0.22, fullAt: 0.38, dimAt: 0.75,  fadedAt: 1.10 },
  // Zoom ≈ 1×:             scale ≈ 1.0  peak  (T = 200/1.0  = 200)
  { parallax: 0.07, tileSize:   200, starsPerTile: 4, radius: 1.1, color: 0xDDE8FF,
    baseAlpha: 0.88, seed: 40, fadeInAt: 0.50, fullAt: 0.85, dimAt: 1.60,  fadedAt: 2.20 },
  // Zoom ≈ 2×:             scale ≈ 2.0  peak  (T = 200/2.0  = 100)
  { parallax: 0.04, tileSize:   100, starsPerTile: 4, radius: 0.85, color: 0xCCDAF5,
    baseAlpha: 0.80, seed: 50, fadeInAt: 1.00, fullAt: 1.65, dimAt: 3.10,  fadedAt: 4.30 },
  // Zoom ≈ 3-4×:           scale ≈ 3.5  peak  (T = 200/3.5  ≈ 57)
  { parallax: 0.02, tileSize:    57, starsPerTile: 4, radius: 0.60, color: 0xBBCCEE,
    baseAlpha: 0.70, seed: 60, fadeInAt: 1.80, fullAt: 2.80, dimAt: 5.50,  fadedAt: 7.00 },
];

// Safety cap: max tile half-range per axis. Prevents runaway iteration if a layer
// is evaluated at a scale far outside its intended window.
const MAX_TILE_HALF = 9;

/**
 * Fast deterministic hash of four integers → float in [0, 1).
 * 32-bit Murmur-style mixing via Math.imul.
 */
function fract(a: number, b: number, c: number, d: number): number {
  let h = Math.imul(a, 0x9e3779b9) ^ Math.imul(b, 0x6c62272e);
  h = Math.imul(h ^ c, 0x46295a8b) ^ Math.imul(d, 0x7feb352d);
  h = Math.imul(h ^ (h >>> 16), 0x8b76b8c3);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/**
 * Infinitely tiling parallax star field with zoom-based LOD.
 *
 * Each layer has world-space tiles sized for its zoom window so that tile
 * count stays roughly constant (~121 tiles/layer) at peak visibility.
 * Different seeds + tile sizes mean adjacent zoom levels show completely
 * different star patterns — no star persists across a layer transition.
 *
 * Screen projection:
 *   bgPos   = cameraWorldPos × parallaxFactor
 *   screenX = canvasMid + (starBgX − bgPosX) × viewport.scale
 */
export class StarfieldRenderer implements IRenderer {
  readonly renderPriority = 5; // Before GridRenderer (10)

  private graphics!: PIXI.Graphics;

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
  }

  render(viewport: Viewport, _timestamp: number): void {
    this.graphics.clear();

    const { bounds, canvas } = viewport;
    const scale = viewport.scale;
    const cx = (bounds.min.x + bounds.max.x) * 0.5;
    const cy = (bounds.min.y + bounds.max.y) * 0.5;
    const hw = canvas.width  / (2 * scale); // half-viewport in world units
    const hh = canvas.height / (2 * scale);
    const scx = canvas.width  * 0.5;
    const scy = canvas.height * 0.5;

    for (const layer of LAYERS) {
      const { parallax: p, tileSize: T, starsPerTile: N, radius: r,
              color, baseAlpha, seed, fadeInAt, fullAt, dimAt, fadedAt } = layer;

      // Fast-reject: entirely outside this layer's scale window
      if (scale <= fadeInAt || scale >= fadedAt) continue;

      // Smooth fade at both ends of the window
      const fadeIn  = Math.min(1, (scale  - fadeInAt) / (fullAt  - fadeInAt));
      const fadeOut = Math.min(1, (fadedAt - scale)   / (fadedAt - dimAt));
      const layerAlpha = baseAlpha * Math.min(fadeIn, fadeOut);
      if (layerAlpha <= 0) continue;

      // Background-space camera centre (world pos × parallax factor)
      const bgCx = cx * p;
      const bgCy = cy * p;

      // Tile range centred on camera, capped for safety
      const cTX   = Math.round(bgCx / T);
      const cTY   = Math.round(bgCy / T);
      const halfX = Math.min(MAX_TILE_HALF, Math.ceil(hw / T) + 1);
      const halfY = Math.min(MAX_TILE_HALF, Math.ceil(hh / T) + 1);

      // Batch entire layer into one PIXI fill call
      this.graphics.beginFill(color, layerAlpha);
      for (let atx = cTX - halfX; atx <= cTX + halfX; atx++) {
        for (let aty = cTY - halfY; aty <= cTY + halfY; aty++) {
          for (let i = 0; i < N; i++) {
            const sx = (atx + fract(atx, aty, seed, i * 2    )) * T;
            const sy = (aty + fract(atx, aty, seed, i * 2 + 1)) * T;
            this.graphics.drawCircle(
              scx + (sx - bgCx) * scale,
              scy + (sy - bgCy) * scale,
              r,
            );
          }
        }
      }
      this.graphics.endFill();
    }
  }

  dispose(): void {
    this.graphics.destroy();
  }
}
