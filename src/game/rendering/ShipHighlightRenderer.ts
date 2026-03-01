import * as Matter from 'matter-js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';

interface BoxStyle {
  color: string;
  alpha: number;
  lineWidth: number;
  dashPattern: number[];
}

export class ShipHighlightRenderer implements IRenderer {
  readonly renderPriority = 50;

  constructor(
    private readonly getPlayerAssembly: () => Assembly | null,
    private readonly getHoveredAssembly: () => Assembly | null,
    private readonly getSelectedAssembly: () => Assembly | null,
    private readonly getLockedTargets: (assembly: Assembly) => Assembly[],
  ) {}

  render(ctx: CanvasRenderingContext2D, viewport: Viewport, timestamp: number): void {
    const { bounds, canvas } = viewport;

    // Hover box
    const hovered = this.getHoveredAssembly();
    if (hovered && !hovered.destroyed) {
      this.renderBoundingBox(ctx, hovered, bounds, canvas, {
        color: '#ffff00', alpha: 0.3, lineWidth: 2, dashPattern: [5, 5],
      });
    }

    // Selected box
    const selected = this.getSelectedAssembly();
    if (selected && !selected.destroyed) {
      this.renderBoundingBox(ctx, selected, bounds, canvas, {
        color: '#00ffff', alpha: 0.6, lineWidth: 3, dashPattern: [],
      });
      const pulse = Math.sin(timestamp / 300) * 0.3 + 0.7;
      this.renderBoundingBox(ctx, selected, bounds, canvas, {
        color: '#ffffff', alpha: pulse * 0.2, lineWidth: 1, dashPattern: [],
      });
    }

    // Locked targets for player
    const player = this.getPlayerAssembly();
    if (player && !player.destroyed) {
      const lockedTargets = this.getLockedTargets(player);
      for (const target of lockedTargets) {
        if (target.destroyed) continue;
        const isEnemy = target.team !== player.team;
        const targetColor = isEnemy ? '#ff4444' : '#44ff44';

        this.renderTargetSquare(ctx, target, bounds, canvas, targetColor);

        if (player.primaryTarget?.id === target.id) {
          this.renderBoundingBox(ctx, target, bounds, canvas, {
            color: targetColor, alpha: 0.8, lineWidth: 4, dashPattern: [10, 5],
          });
          const primaryPulse = Math.sin(timestamp / 200) * 0.4 + 0.6;
          this.renderBoundingBox(ctx, target, bounds, canvas, {
            color: '#ffffff', alpha: primaryPulse * 0.3, lineWidth: 2, dashPattern: [],
          });
        }
      }
    }
  }

  private renderBoundingBox(
    ctx: CanvasRenderingContext2D,
    assembly: Assembly,
    bounds: Matter.Bounds,
    canvas: HTMLCanvasElement,
    style: BoxStyle,
  ): void {
    if (assembly.entities.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const entity of assembly.entities) {
      if (entity.destroyed) continue;
      const b = entity.body.bounds;
      minX = Math.min(minX, b.min.x);
      minY = Math.min(minY, b.min.y);
      maxX = Math.max(maxX, b.max.x);
      maxY = Math.max(maxY, b.max.y);
    }
    if (minX === Infinity) return;

    const pad = 20;
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const toSX = (wx: number) => (wx - bounds.min.x) / bw * canvas.width;
    const toSY = (wy: number) => (wy - bounds.min.y) / bh * canvas.height;

    ctx.globalAlpha = style.alpha;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.lineWidth;
    ctx.setLineDash(style.dashPattern);
    ctx.beginPath();
    ctx.rect(
      toSX(minX - pad),
      toSY(minY - pad),
      toSX(maxX + pad) - toSX(minX - pad),
      toSY(maxY + pad) - toSY(minY - pad),
    );
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  private renderTargetSquare(
    ctx: CanvasRenderingContext2D,
    target: Assembly,
    bounds: Matter.Bounds,
    canvas: HTMLCanvasElement,
    color: string,
  ): void {
    if (target.entities.length === 0) return;

    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const centerPos = target.rootBody.position;
    const screenX = (centerPos.x - bounds.min.x) / bw * canvas.width;
    const screenY = (centerPos.y - bounds.min.y) / bh * canvas.height;

    const squareSize = 20;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;

    ctx.beginPath();
    ctx.rect(screenX - squareSize / 2, screenY - squareSize / 2, squareSize, squareSize);
    ctx.stroke();

    const bracketSize = 8;
    const bracketOffset = squareSize / 2 + 2;
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(screenX - bracketOffset, screenY - bracketOffset + bracketSize);
    ctx.lineTo(screenX - bracketOffset, screenY - bracketOffset);
    ctx.lineTo(screenX - bracketOffset + bracketSize, screenY - bracketOffset);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(screenX + bracketOffset - bracketSize, screenY - bracketOffset);
    ctx.lineTo(screenX + bracketOffset, screenY - bracketOffset);
    ctx.lineTo(screenX + bracketOffset, screenY - bracketOffset + bracketSize);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(screenX - bracketOffset, screenY + bracketOffset - bracketSize);
    ctx.lineTo(screenX - bracketOffset, screenY + bracketOffset);
    ctx.lineTo(screenX - bracketOffset + bracketSize, screenY + bracketOffset);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(screenX + bracketOffset - bracketSize, screenY + bracketOffset);
    ctx.lineTo(screenX + bracketOffset, screenY + bracketOffset);
    ctx.lineTo(screenX + bracketOffset, screenY + bracketOffset - bracketSize);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(target.shipName, screenX, screenY + bracketOffset + 15);
    ctx.globalAlpha = 1;
  }
}
