import { Viewport } from './Viewport';

export interface IRenderer {
  readonly renderPriority: number;
  render(ctx: CanvasRenderingContext2D, viewport: Viewport, timestamp: number): void;
  dispose?(): void;
}
