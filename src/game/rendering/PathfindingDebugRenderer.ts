import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { PathfindingDebugData } from '../systems/PathfindingSystem';

/** Colour for blocked cells (RGBA). */
const BLOCKED_R = 255, BLOCKED_G = 68, BLOCKED_B = 68, BLOCKED_A = 80;
/** Colour for the solved path cells (RGBA). */
const PATH_R = 68, PATH_G = 255, PATH_B = 68, PATH_A = 120;

/**
 * Debug overlay that visualises the last A* pathfinding grid.
 * Blocked cells are red, the solved path is bright green.
 * Walkable cells are left transparent to avoid visual noise.
 *
 * The grid is rasterised to a 1-pixel-per-cell offscreen canvas once when
 * the data changes, then drawn as a single scaled sprite each frame — no
 * per-cell PIXI.Graphics calls.
 *
 * Toggled via GameEngine.setDebugPathfinding().
 * Priority 61 — drawn above AimingDebugRenderer.
 */
export class PathfindingDebugRenderer implements IRenderer {
  readonly renderPriority = 61;

  private sprite!: PIXI.Sprite;
  private enabled = false;
  /** Reference-equality check to avoid re-rasterising the same data. */
  private cachedData: PathfindingDebugData | null = null;

  constructor(
    private readonly getDebugData: () => PathfindingDebugData | null,
  ) {}

  init(stage: PIXI.Container): void {
    this.sprite = new PIXI.Sprite();
    this.sprite.visible = false;
    stage.addChild(this.sprite);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.sprite.visible = false;
    }
  }

  render(viewport: Viewport): void {
    if (!this.enabled) {
      this.sprite.visible = false;
      return;
    }

    const data = this.getDebugData();
    if (!data) {
      this.sprite.visible = false;
      return;
    }

    // Re-rasterise only when data changes
    if (data !== this.cachedData) {
      this.cachedData = data;
      this.rasterise(data);
    }

    // Position and scale the sprite to match world coordinates
    const { originX, originY, cellSize } = data;
    const topLeft = viewport.worldToScreen(originX, originY);
    const scale = viewport.scale * cellSize; // pixels per cell on screen

    this.sprite.position.set(topLeft.x, topLeft.y);
    this.sprite.scale.set(scale, scale);
    this.sprite.visible = true;
  }

  /** Rasterise grid data to a 1px-per-cell ImageData, upload as PIXI texture. */
  private rasterise(data: PathfindingDebugData): void {
    const { width, height, blocked, path, cellSize, originX, originY } = data;

    // Build path cell lookup
    const pathCells = new Set<number>();
    for (const wp of path) {
      const gx = Math.floor((wp.x - originX) / cellSize);
      const gy = Math.floor((wp.y - originY) / cellSize);
      if (gx >= 0 && gx < width && gy >= 0 && gy < height) {
        pathCells.add(gy * width + gx);
      }
    }

    // Draw to an offscreen canvas (1 pixel per cell)
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(width, height);
    const pixels = imageData.data;

    for (let gy = 0; gy < height; gy++) {
      for (let gx = 0; gx < width; gx++) {
        const idx = gy * width + gx;
        const pIdx = idx * 4;
        const isPath = pathCells.has(idx);
        const isBlocked = blocked[idx];

        if (isPath) {
          pixels[pIdx]     = PATH_R;
          pixels[pIdx + 1] = PATH_G;
          pixels[pIdx + 2] = PATH_B;
          pixels[pIdx + 3] = PATH_A;
        } else if (isBlocked) {
          pixels[pIdx]     = BLOCKED_R;
          pixels[pIdx + 1] = BLOCKED_G;
          pixels[pIdx + 2] = BLOCKED_B;
          pixels[pIdx + 3] = BLOCKED_A;
        }
        // Walkable cells stay fully transparent
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Destroy old texture if any
    if (this.sprite.texture && this.sprite.texture !== PIXI.Texture.EMPTY) {
      this.sprite.texture.destroy(true);
    }
    this.sprite.texture = PIXI.Texture.from(canvas, { scaleMode: PIXI.SCALE_MODES.NEAREST });
  }

  dispose(): void {
    if (this.sprite.texture && this.sprite.texture !== PIXI.Texture.EMPTY) {
      this.sprite.texture.destroy(true);
    }
    this.sprite.destroy();
  }
}
