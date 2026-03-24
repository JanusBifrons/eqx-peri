import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';

export class BlockFrillsRenderer implements IRenderer {
  readonly renderPriority = 30;
  readonly renderSpace = 'world' as const;

  private graphics!: PIXI.Graphics;

  constructor(
    private readonly getAssemblies: () => Assembly[],
    private readonly getHeldAssembly: () => Assembly | null,
  ) {}

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
  }

  render(viewport: Viewport, _timestamp: number): void {
    this.graphics.clear();

    const { bounds } = viewport;
    const held = this.getHeldAssembly();
    const allAssemblies = held ? [...this.getAssemblies(), held] : this.getAssemblies();

    for (const assembly of allAssemblies) {
      const assemblyAngle = assembly.rootBody.angle;
      for (const entity of assembly.entities) {
        if (entity.destroyed) continue;
        const pos = entity.body.position;
        if (
          pos.x < bounds.min.x - 100 || pos.x > bounds.max.x + 100 ||
          pos.y < bounds.min.y - 100 || pos.y > bounds.max.y + 100
        ) continue;
        entity.drawBlockFrills(this.graphics, viewport, assemblyAngle);
      }
    }
  }
}
