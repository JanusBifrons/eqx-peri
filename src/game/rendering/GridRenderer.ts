import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { GRID_SIZE } from '../../types/GameTypes';

const ZOOM_THRESHOLDS = [0.1, 0.25, 0.5, 1, 2, 4, 8, 16];

const MINOR_COLOR = 0x1a1f33;
const MAJOR_COLOR = 0x253048;

export class GridRenderer implements IRenderer {
  readonly renderPriority = 10;
  readonly renderSpace = 'world' as const;

  private graphics!: PIXI.Graphics;

  constructor(private readonly getVisible: () => boolean) {}

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
  }

  render(viewport: Viewport, _timestamp: number): void {
    this.graphics.clear();
    if (!this.getVisible()) return;

    const { bounds } = viewport;
    const scale = viewport.scale;

    const viewportWidth = bounds.max.x - bounds.min.x;
    const viewportHeight = bounds.max.y - bounds.min.y;
    const rawZoomLevel = Math.min(viewportWidth, viewportHeight) / 1000;

    let clampedZoomLevel = ZOOM_THRESHOLDS[0];
    for (const threshold of ZOOM_THRESHOLDS) {
      if (rawZoomLevel >= threshold) clampedZoomLevel = threshold;
      else break;
    }

    const baseMinorGridSize = GRID_SIZE * 5 * clampedZoomLevel;
    const baseMajorGridSize = GRID_SIZE * 15 * clampedZoomLevel;

    const startXMajor = Math.floor(bounds.min.x / baseMajorGridSize) * baseMajorGridSize;
    const endXMajor   = Math.ceil(bounds.max.x / baseMajorGridSize) * baseMajorGridSize;
    const startYMajor = Math.floor(bounds.min.y / baseMajorGridSize) * baseMajorGridSize;
    const endYMajor   = Math.ceil(bounds.max.y / baseMajorGridSize) * baseMajorGridSize;

    const startXMinor = Math.floor(bounds.min.x / baseMinorGridSize) * baseMinorGridSize;
    const endXMinor   = Math.ceil(bounds.max.x / baseMinorGridSize) * baseMinorGridSize;
    const startYMinor = Math.floor(bounds.min.y / baseMinorGridSize) * baseMinorGridSize;
    const endYMinor   = Math.ceil(bounds.max.y / baseMinorGridSize) * baseMinorGridSize;

    const baseOpacity = Math.min(1, Math.max(0.1, 2 / clampedZoomLevel));

    // Line width: 1 screen pixel = 1/scale world units
    const lw = 1 / scale;

    // Minor grid lines — draw in world coords, WorldContainer handles transform
    this.graphics.lineStyle(lw, MINOR_COLOR, baseOpacity * 0.28);
    for (let x = startXMinor; x <= endXMinor; x += baseMinorGridSize) {
      if (x % baseMajorGridSize !== 0) {
        this.graphics.moveTo(x, bounds.min.y);
        this.graphics.lineTo(x, bounds.max.y);
      }
    }
    for (let y = startYMinor; y <= endYMinor; y += baseMinorGridSize) {
      if (y % baseMajorGridSize !== 0) {
        this.graphics.moveTo(bounds.min.x, y);
        this.graphics.lineTo(bounds.max.x, y);
      }
    }

    // Major grid lines
    this.graphics.lineStyle(lw, MAJOR_COLOR, baseOpacity * 0.50);
    for (let x = startXMajor; x <= endXMajor; x += baseMajorGridSize) {
      this.graphics.moveTo(x, bounds.min.y);
      this.graphics.lineTo(x, bounds.max.y);
    }
    for (let y = startYMajor; y <= endYMajor; y += baseMajorGridSize) {
      this.graphics.moveTo(bounds.min.x, y);
      this.graphics.lineTo(bounds.max.x, y);
    }
  }
}
