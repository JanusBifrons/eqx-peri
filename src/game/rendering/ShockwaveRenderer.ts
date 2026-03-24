import * as PIXI from 'pixi.js';
import { ShockwaveFilter } from 'pixi-filters';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';

// How fast the ring expands — scales with entity count.
// Physical pixel radius at end of lifetime = speed * (DURATION_MS / 1000).
const SHOCKWAVE_DURATION_MS = 900;
const SHOCKWAVE_BASE_SPEED = 200;         // px/s for a 1-block assembly
const SHOCKWAVE_SPEED_PER_ENTITY = 15;    // additional px/s per entity
const SHOCKWAVE_MAX_SPEED = 600;          // cap for capital ships

// ShockwaveFilter shader parameters
const SHOCKWAVE_AMPLITUDE = 28;    // max pixel displacement at the ring edge
const SHOCKWAVE_WAVELENGTH = 80;   // width of the distortion band in px
const SHOCKWAVE_BRIGHTNESS = 1.4;  // brief brightness burst as the ring passes

// Cap simultaneous filter passes to avoid stacking costs in large battles
const MAX_SIMULTANEOUS = 4;

interface ActiveShockwave {
  worldX: number;
  worldY: number;
  startTime: number;   // Date.now() in ms
  filter: ShockwaveFilter;
}

/**
 * Renders assembly-destruction shockwaves using pixi-filters' ShockwaveFilter.
 *
 * The filter is applied directly to the PIXI stage, so the expanding ring
 * physically distorts all rendered content (ships, beams, grid lines, etc.)
 * as it passes through — no hand-drawn geometry needed for the distortion itself.
 *
 * A brief additive centre flash (PIXI.Graphics) accompanies the distortion for
 * impact feedback in the first 20 % of the lifetime.
 *
 * Filter API used:
 *   center     – ring origin in screen-pixel coords (shader divides by filterArea.xy)
 *   time       – elapsed seconds; ring radius = time * speed  (set manually each frame)
 *   speed      – px/s expansion rate
 *   amplitude  – max pixel displacement at the ring edge
 *   wavelength – band width in pixels
 *   brightness – colour boost as ring passes
 *   radius     – maximum ring radius in px; after this the shader passes through unchanged
 */
export class ShockwaveRenderer implements IRenderer {
  readonly renderPriority = 46;

  private graphics!: PIXI.Graphics;  // centre flash only
  private filterStage!: PIXI.Container;
  private filterAreaRect!: PIXI.Rectangle;
  private shockwaves: ActiveShockwave[] = [];

  /** @param getStage Returns the PIXI app.stage — filters must be applied there for full-scene distortion. */
  constructor(private readonly getStage: () => PIXI.Container) {}

  init(stage: PIXI.Container): void {
    this.filterStage = this.getStage();
    this.filterAreaRect = new PIXI.Rectangle(0, 0, 1, 1); // sized correctly in render()
    this.graphics = new PIXI.Graphics();
    this.graphics.blendMode = PIXI.BLEND_MODES.ADD;
    stage.addChild(this.graphics);
  }

  /**
   * Spawn a shockwave at a world position.
   * @param entityCount - entities the assembly had before destruction; scales ring size.
   */
  addShockwave(worldX: number, worldY: number, entityCount: number): void {
    // Drop the oldest if we're at the cap
    if (this.shockwaves.length >= MAX_SIMULTANEOUS) {
      const oldest = this.shockwaves.shift()!;
      this.removeFilter(oldest.filter);
    }

    const speed = Math.min(
      SHOCKWAVE_BASE_SPEED + entityCount * SHOCKWAVE_SPEED_PER_ENTITY,
      SHOCKWAVE_MAX_SPEED,
    );
    // Ring should reach maxRadius exactly when the effect expires
    const maxRadius = speed * (SHOCKWAVE_DURATION_MS / 1000);

    // center is updated every frame; start at [0,0] until first render()
    const filter = new ShockwaveFilter([0, 0], {
      amplitude: SHOCKWAVE_AMPLITUDE,
      wavelength: SHOCKWAVE_WAVELENGTH,
      brightness: SHOCKWAVE_BRIGHTNESS,
      speed,
      radius: maxRadius,
    }, 0 /* initial time = 0 */);

    this.shockwaves.push({ worldX, worldY, startTime: Date.now(), filter });
    this.filterStage.filters = [...(this.filterStage.filters ?? []), filter];
  }

  render(viewport: Viewport, _timestamp: number): void {
    this.graphics.clear();
    const now = Date.now();

    // Expire finished waves
    const expired = this.shockwaves.filter(s => now - s.startTime >= SHOCKWAVE_DURATION_MS);
    if (expired.length > 0) {
      expired.forEach(s => this.removeFilter(s.filter));
      this.shockwaves = this.shockwaves.filter(s => now - s.startTime < SHOCKWAVE_DURATION_MS);
    }

    if (this.shockwaves.length === 0) return;

    const { bounds, canvas } = viewport;
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const toScreenX = (wx: number) => (wx - bounds.min.x) / bw * canvas.width;
    const toScreenY = (wy: number) => (wy - bounds.min.y) / bh * canvas.height;

    // Pin the filter area to the full canvas so pixel-space `center` values are correct.
    // The shader does `center / filterArea.xy` to get normalized UV coords.
    this.filterAreaRect.width = canvas.width;
    this.filterAreaRect.height = canvas.height;
    this.filterStage.filterArea = this.filterAreaRect;

    for (const wave of this.shockwaves) {
      const elapsedSec = (now - wave.startTime) / 1000;
      const cx = toScreenX(wave.worldX);
      const cy = toScreenY(wave.worldY);

      // Update the filter each frame — center tracks camera movement,
      // time drives the ring expansion in the shader.
      wave.filter.center = [cx, cy];
      wave.filter.time = elapsedSec;

      // Brief additive centre flash in the first 20 % of lifetime
      const t = elapsedSec / (SHOCKWAVE_DURATION_MS / 1000);
      if (t < 0.2) {
        const flashAlpha = (1 - t / 0.2) * 0.7;
        const currentRingRadius = elapsedSec * wave.filter.speed;
        const flashRadius = currentRingRadius * 0.3;
        this.graphics.lineStyle(0);
        this.graphics.beginFill(0xffffff, flashAlpha);
        this.graphics.drawCircle(cx, cy, flashRadius);
        this.graphics.endFill();
        this.graphics.beginFill(0xff9944, flashAlpha * 0.45);
        this.graphics.drawCircle(cx, cy, flashRadius * 2.0);
        this.graphics.endFill();
      }
    }
  }

  private removeFilter(filter: ShockwaveFilter): void {
    if (!this.filterStage.filters) return;
    this.filterStage.filters = this.filterStage.filters.filter(f => f !== filter);
    if (this.filterStage.filters.length === 0) {
      this.filterStage.filters = null;
    }
  }

  dispose(): void {
    this.shockwaves.forEach(s => this.removeFilter(s.filter));
    this.shockwaves = [];
  }
}
