import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { GRID_SIZE } from '../../types/GameTypes';

const ZOOM_THRESHOLDS = [0.1, 0.25, 0.5, 1, 2, 4, 8, 16];

export class GridRenderer implements IRenderer {
  readonly renderPriority = 10;

  constructor(private readonly getVisible: () => boolean) {}

  render(ctx: CanvasRenderingContext2D, viewport: Viewport, _timestamp: number): void {
    if (!this.getVisible()) return;

    const { bounds, canvas } = viewport;

    const viewportWidth = bounds.max.x - bounds.min.x;
    const viewportHeight = bounds.max.y - bounds.min.y;
    const rawZoomLevel = Math.min(viewportWidth, viewportHeight) / 1000;

    // Clamp zoom to discrete levels to prevent constant grid movement
    let clampedZoomLevel = ZOOM_THRESHOLDS[0];
    for (const threshold of ZOOM_THRESHOLDS) {
      if (rawZoomLevel >= threshold) {
        clampedZoomLevel = threshold;
      } else {
        break;
      }
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

    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const sx = (wx: number) => (wx - bounds.min.x) / bw * canvas.width;
    const sy = (wy: number) => (wy - bounds.min.y) / bh * canvas.height;

    const baseOpacity = Math.min(1, Math.max(0.1, 2 / clampedZoomLevel));

    // Minor grid lines
    ctx.strokeStyle = '#444477';
    ctx.lineWidth = 1;
    ctx.globalAlpha = baseOpacity * 0.4;

    for (let x = startXMinor; x <= endXMinor; x += baseMinorGridSize) {
      if (x % baseMajorGridSize !== 0) {
        ctx.beginPath();
        ctx.moveTo(sx(x), 0);
        ctx.lineTo(sx(x), canvas.height);
        ctx.stroke();
      }
    }
    for (let y = startYMinor; y <= endYMinor; y += baseMinorGridSize) {
      if (y % baseMajorGridSize !== 0) {
        ctx.beginPath();
        ctx.moveTo(0, sy(y));
        ctx.lineTo(canvas.width, sy(y));
        ctx.stroke();
      }
    }

    // Major grid lines
    ctx.strokeStyle = '#7788aa';
    ctx.lineWidth = 2;
    ctx.globalAlpha = baseOpacity * 0.8;

    for (let x = startXMajor; x <= endXMajor; x += baseMajorGridSize) {
      ctx.beginPath();
      ctx.moveTo(sx(x), 0);
      ctx.lineTo(sx(x), canvas.height);
      ctx.stroke();
    }
    for (let y = startYMajor; y <= endYMajor; y += baseMajorGridSize) {
      ctx.beginPath();
      ctx.moveTo(0, sy(y));
      ctx.lineTo(canvas.width, sy(y));
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }
}
