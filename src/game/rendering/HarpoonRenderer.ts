import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { ActiveHarpoon } from '../weapons/HarpoonSystem';

/** Minimal assembly interface for rendering tether endpoints. */
interface RenderAssembly {
  rootBody: { position: { x: number; y: number }; angle: number };
  destroyed: boolean;
  id: string;
}

/**
 * Renders harpoon projectiles in flight and tether lines between connected assemblies.
 * World-space renderer — priority 44 (between shield and beam).
 */
export class HarpoonRenderer implements IRenderer {
  readonly renderPriority = 44;
  readonly renderSpace = 'world' as const;

  private graphics!: PIXI.Graphics;
  private readonly getHarpoons: () => ActiveHarpoon[];
  private readonly getAssemblies: () => RenderAssembly[];

  constructor(
    getHarpoons: () => ActiveHarpoon[],
    getAssemblies: () => RenderAssembly[],
  ) {
    this.getHarpoons = getHarpoons;
    this.getAssemblies = getAssemblies;
  }

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
  }

  render(viewport: Viewport, timestamp: number): void {
    const g = this.graphics;
    g.clear();

    const scale = viewport.scale;
    const harpoons = this.getHarpoons();
    const assemblies = this.getAssemblies();

    for (const h of harpoons) {
      if (h.destroyed) continue;

      // Draw in-flight or reeling projectile
      if (h.projectileBody) {
        const pos = h.projectileBody.position;
        const angle = h.projectileBody.angle;
        const len = 10;
        const hw = 3;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        // Draw as a small dart shape
        const dartColor = h.state === 'reeling' ? 0x886644 : 0xcc8844;
        const dartAlpha = h.state === 'reeling' ? 0.6 : 1.0;
        g.beginFill(dartColor, dartAlpha);
        g.moveTo(pos.x + cos * len * 0.6, pos.y + sin * len * 0.6);
        g.lineTo(pos.x - cos * len * 0.4 + sin * hw, pos.y - sin * len * 0.4 - cos * hw);
        g.lineTo(pos.x - cos * len * 0.4 - sin * hw, pos.y - sin * len * 0.4 + cos * hw);
        g.closePath();
        g.endFill();

        // White tip
        const tipSize = Math.max(1 / scale, 1.2);
        g.beginFill(0xffffff, dartAlpha * 0.8);
        g.drawCircle(pos.x + cos * len * 0.6, pos.y + sin * len * 0.6, tipSize);
        g.endFill();

        // Draw faint cable from weapon muzzle (source anchor) to projectile.
        // Prefer the entity part body for rotation-correct tracking.
        const source = assemblies.find(a => a.id === h.sourceAssemblyId);
        if (source && !source.destroyed) {
          let sx: number, sy: number;
          if (h.sourcePartBody) {
            const pB = h.sourcePartBody;
            const eOff = h.sourceEntityOffset;
            const eCos = Math.cos(pB.angle), eSin = Math.sin(pB.angle);
            sx = pB.position.x + eOff.x * eCos - eOff.y * eSin;
            sy = pB.position.y + eOff.x * eSin + eOff.y * eCos;
          } else {
            const sBody = source.rootBody;
            const pA = h.sourceLocalAnchor;
            const sCos = Math.cos(sBody.angle), sSin = Math.sin(sBody.angle);
            sx = sBody.position.x + pA.x * sCos - pA.y * sSin;
            sy = sBody.position.y + pA.x * sSin + pA.y * sCos;
          }
          const cableAlpha = h.state === 'reeling' ? 0.5 : 0.25;
          const lineWidth = Math.max(1 / scale, 1);
          g.lineStyle(lineWidth, 0x886644, cableAlpha);
          g.moveTo(sx, sy);
          g.lineTo(pos.x, pos.y);
          g.lineStyle(0);
        }
      }

      // Draw tether line
      if (h.state === 'tethered' && h.targetAssemblyId) {
        const source = assemblies.find(a => a.id === h.sourceAssemblyId);
        const target = assemblies.find(a => a.id === h.targetAssemblyId);
        if (source && target && !source.destroyed && !target.destroyed) {
          // Compute anchor world positions — prefer entity part bodies for rotation-correct tracking.
          let sx: number, sy: number;
          if (h.sourcePartBody) {
            const eOff = h.sourceEntityOffset;
            const eCos = Math.cos(h.sourcePartBody.angle), eSin = Math.sin(h.sourcePartBody.angle);
            sx = h.sourcePartBody.position.x + eOff.x * eCos - eOff.y * eSin;
            sy = h.sourcePartBody.position.y + eOff.x * eSin + eOff.y * eCos;
          } else {
            const sBody = source.rootBody;
            const pA = h.sourceLocalAnchor;
            const sCos = Math.cos(sBody.angle), sSin = Math.sin(sBody.angle);
            sx = sBody.position.x + pA.x * sCos - pA.y * sSin;
            sy = sBody.position.y + pA.x * sSin + pA.y * sCos;
          }

          let tx: number, ty: number;
          if (h.targetPartBody) {
            const eOff = h.targetEntityOffset;
            const eCos = Math.cos(h.targetPartBody.angle), eSin = Math.sin(h.targetPartBody.angle);
            tx = h.targetPartBody.position.x + eOff.x * eCos - eOff.y * eSin;
            ty = h.targetPartBody.position.y + eOff.x * eSin + eOff.y * eCos;
          } else {
            const tBody = target.rootBody;
            const pB = h.targetLocalAnchor;
            const tCos = Math.cos(tBody.angle), tSin = Math.sin(tBody.angle);
            tx = tBody.position.x + pB.x * tCos - pB.y * tSin;
            ty = tBody.position.y + pB.x * tSin + pB.y * tCos;
          }

          // Pulsing line width
          const pulse = 0.7 + 0.3 * Math.sin(timestamp * 0.005);
          const lineWidth = Math.max(1.5 / scale, 2) * pulse;

          // Draw tether as a slightly wavy line
          g.lineStyle(lineWidth, 0xcc8844, 0.8);
          g.moveTo(sx, sy);

          // Rope sag: droops more when slack (dist < tetherLength), tight when taut
          const midX = (sx + tx) / 2;
          const midY = (sy + ty) / 2;
          const dx = tx - sx;
          const dy = ty - sy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const slackRatio = h.tetherLength > 0 ? Math.max(0, 1 - dist / h.tetherLength) : 0;
          // Droop downward (positive Y = down in screen space) proportional to slack
          const sagAmount = slackRatio * Math.min(h.tetherLength * 0.3, 80);
          const perpX = 0;
          const perpY = sagAmount;

          g.quadraticCurveTo(midX + perpX, midY + perpY, tx, ty);
          g.lineStyle(0);

          // Draw small nodes at connection points
          const nodeSize = Math.max(2 / scale, 2.5);
          g.beginFill(0xffcc88, 0.9);
          g.drawCircle(sx, sy, nodeSize);
          g.drawCircle(tx, ty, nodeSize);
          g.endFill();
        }
      }
    }
  }

  dispose(): void {
    this.graphics.destroy();
  }
}
