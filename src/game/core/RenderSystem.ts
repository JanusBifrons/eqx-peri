import * as PIXI from 'pixi.js';
import * as Matter from 'matter-js';
import Stats from 'stats.js';
import { IRenderer } from '../rendering/IRenderer';
import { Viewport } from '../rendering/Viewport';

export class RenderSystem {
  private readonly app: PIXI.Application;
  private renderers: IRenderer[] = [];
  private viewport: Viewport;
  private rafId: number = 0;
  private running: boolean = false;
  private readonly stats: Stats;
  private readonly getBounds: () => Matter.Bounds;

  // Optional physics debug overlay
  private debugRender: Matter.Render | null = null;
  private debugOnly: boolean = false;

  constructor(
    container: HTMLElement,
    matterCanvas: HTMLCanvasElement,
    getBounds: () => Matter.Bounds,
    stats: Stats,
  ) {
    this.getBounds = getBounds;
    this.stats = stats;

    this.app = new PIXI.Application({
      width: matterCanvas.width,
      height: matterCanvas.height,
      backgroundColor: 0x000011,
      backgroundAlpha: 1,
      antialias: true,
      autoStart: false,
      powerPreference: 'high-performance',
    });

    // Overlay the PIXI canvas above the Matter.js canvas
    const pixiCanvas = this.app.view as HTMLCanvasElement;
    pixiCanvas.style.position = 'absolute';
    pixiCanvas.style.top = '0';
    pixiCanvas.style.left = '0';
    pixiCanvas.style.pointerEvents = 'none';

    // Ensure container can host absolutely-positioned children
    const containerPosition = getComputedStyle(container).position;
    if (containerPosition === 'static') {
      container.style.position = 'relative';
    }

    // The Matter.js canvas stays for mouse-event handling and camera bounds.
    // Make it invisible so only the PIXI canvas is shown.
    matterCanvas.style.position = 'absolute';
    matterCanvas.style.top = '0';
    matterCanvas.style.left = '0';
    matterCanvas.style.opacity = '0';

    container.appendChild(pixiCanvas);

    // Use the PIXI canvas dimensions for viewport transforms
    this.viewport = new Viewport(getBounds(), pixiCanvas);
  }

  public register(renderer: IRenderer): void {
    renderer.init(this.app.stage);
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
    this.app.destroy(true);
  }

  private loop(timestamp: number): void {
    if (!this.running) return;

    // Sync viewport bounds from the Matter.Render instance each frame
    this.viewport.bounds = this.getBounds();

    // Sync debug overlay bounds if active
    if (this.debugRender) {
      Matter.Render.lookAt(this.debugRender, this.viewport.bounds);
    }

    this.stats.begin();

    if (!this.debugOnly) {
      for (const renderer of this.renderers) {
        renderer.render(this.viewport, timestamp);
      }
    }

    this.app.renderer.render(this.app.stage);
    this.stats.end();

    this.rafId = requestAnimationFrame((ts) => this.loop(ts));
  }

  /**
   * Enable or disable the physics wireframe debug overlay.
   */
  public setDebugPhysics(
    enabled: boolean,
    debugOnly: boolean = false,
    engine?: Matter.Engine,
    container?: HTMLElement,
  ): void {
    if (enabled && engine && container) {
      this.debugOnly = debugOnly;
      if (this.debugRender) return;

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
