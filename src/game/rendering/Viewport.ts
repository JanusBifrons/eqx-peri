import * as Matter from 'matter-js';

export class Viewport {
  constructor(
    public bounds: Matter.Bounds,
    public canvas: HTMLCanvasElement,
  ) {}

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const bw = this.bounds.max.x - this.bounds.min.x;
    const bh = this.bounds.max.y - this.bounds.min.y;
    return {
      x: (wx - this.bounds.min.x) / bw * this.canvas.width,
      y: (wy - this.bounds.min.y) / bh * this.canvas.height,
    };
  }

  get scale(): number {
    return this.canvas.width / (this.bounds.max.x - this.bounds.min.x);
  }
}
