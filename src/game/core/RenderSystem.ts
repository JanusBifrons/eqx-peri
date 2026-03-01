import * as Matter from 'matter-js';
import Stats from 'stats.js';
import { IRenderer } from '../rendering/IRenderer';
import { Viewport } from '../rendering/Viewport';

export class RenderSystem {
  private renderers: IRenderer[] = [];
  private viewport: Viewport;
  private rafId: number = 0;
  private running: boolean = false;
  private readonly stats: Stats;
  private readonly getBounds: () => Matter.Bounds;

  // Optional physics debug overlay
  private debugRender: Matter.Render | null = null;
  private debugOnly: boolean = false;

  constructor(canvas: HTMLCanvasElement, getBounds: () => Matter.Bounds, stats: Stats) {
    this.getBounds = getBounds;
    this.stats = stats;
    this.viewport = new Viewport(getBounds(), canvas);
  }

  public register(renderer: IRenderer): void {
    this.renderers.push(renderer);
    this.renderers.sort((a, b) => a.renderPriority - b.renderPriority);
  }

  public unregister(renderer: IRenderer): void {
    const idx = this.renderers.indexOf(renderer);
    if (idx !== -1) {
      this.renderers.splice(idx, 1);
      renderer.dispose?.();
    }
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.rafId = requestAnimationFrame((ts) => this.loop(ts));
  }

  public stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.renderers.forEach(r => r.dispose?.());
    this.setDebugPhysics(false);
  }

  private loop(timestamp: number): void {
    if (!this.running) return;

    // Sync viewport bounds from the Matter.Render instance each frame
    this.viewport.bounds = this.getBounds();

    // Sync debug overlay bounds if active
    if (this.debugRender) {
      Matter.Render.lookAt(this.debugRender, this.viewport.bounds);
    }

    const canvas = this.viewport.canvas;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      this.stats.begin();

      // Always clear to background colour (avoids stale content in wireframes-only mode)
      ctx.fillStyle = '#000011';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Skip game renderers when showing wireframes only
      if (!this.debugOnly) {
        for (const renderer of this.renderers) {
          ctx.save();
          renderer.render(ctx, this.viewport, timestamp);
          ctx.restore();
        }
      }

      this.stats.end();
    }

    this.rafId = requestAnimationFrame((ts) => this.loop(ts));
  }

  /**
   * Enable or disable the physics wireframe debug overlay.
   * When enabled, creates a second Matter.Render canvas (wireframes, transparent background)
   * overlaid on top of the game canvas via absolute positioning.
   */
  public setDebugPhysics(enabled: boolean, debugOnly: boolean = false, engine?: Matter.Engine, container?: HTMLElement): void {
    if (enabled && engine && container) {
      this.debugOnly = debugOnly;
      if (this.debugRender) return; // Already active

      this.debugRender = Matter.Render.create({
        element: container,
        engine,
        options: {
          width: this.viewport.canvas.width,
          height: this.viewport.canvas.height,
          wireframes: true,
          background: 'transparent',
          wireframeBackground: 'transparent',
        },
      });

      // Position the debug canvas directly over the game canvas
      this.debugRender.canvas.style.position = 'absolute';
      this.debugRender.canvas.style.top = '0';
      this.debugRender.canvas.style.left = '0';
      this.debugRender.canvas.style.pointerEvents = 'none';
      this.debugRender.canvas.style.zIndex = '500';

      Matter.Render.run(this.debugRender);
    } else {
      this.debugOnly = false;
      if (this.debugRender) {
        Matter.Render.stop(this.debugRender);
        this.debugRender.canvas.remove();
        this.debugRender = null;
      }
    }
  }
}
