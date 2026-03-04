import * as Matter from 'matter-js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';

interface BracketStyle {
  color: string;
  alpha: number;
  lineWidth: number;
}

type AssemblyStatus = 'player' | 'friendly' | 'hostile' | 'neutral';

const STATUS_COLORS: Record<AssemblyStatus, string> = {
  player: '#00ffff',
  friendly: '#44ff44',
  hostile: '#ff4444',
  neutral: '#aaaaaa',
};

const STATUS_LABELS: Record<AssemblyStatus, string> = {
  player: 'PLAYER',
  friendly: 'FRIENDLY',
  hostile: 'HOSTILE',
  neutral: 'NEUTRAL',
};

/** Fixed screen-space padding added outside the world-radius when sizing brackets. */
const SCREEN_PAD = 12;
/** Fraction of the half-size used for each corner arm length. */
const CORNER_FRAC = 0.30;
/** Minimum bracket half-size in screen pixels (ensures visibility at any zoom). */
const MIN_HALF_SIZE = 20;

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
    const player = this.getPlayerAssembly();

    // Hover brackets + tooltip — skipped for the player's own ship
    const hovered = this.getHoveredAssembly();
    if (hovered && !hovered.destroyed && hovered !== player) {
      this.renderCornerBrackets(ctx, hovered, bounds, canvas, {
        color: '#ffff00', alpha: 0.9, lineWidth: 1.5,
      });
      this.renderHoverTooltip(ctx, hovered, bounds, canvas, player);
    }

    // Selected brackets
    const selected = this.getSelectedAssembly();
    if (selected && !selected.destroyed) {
      this.renderCornerBrackets(ctx, selected, bounds, canvas, {
        color: '#00ffff', alpha: 0.9, lineWidth: 2,
      });
      const pulse = Math.sin(timestamp / 300) * 0.3 + 0.7;
      this.renderCornerBrackets(ctx, selected, bounds, canvas, {
        color: '#ffffff', alpha: pulse * 0.35, lineWidth: 1,
      });
    }

    // Locked targets for player
    if (player && !player.destroyed) {
      const lockedTargets = this.getLockedTargets(player);
      for (const target of lockedTargets) {
        if (target.destroyed) continue;
        const isEnemy = target.team !== player.team;
        const targetColor = isEnemy ? '#ff4444' : '#44ff44';

        this.renderTargetSquare(ctx, target, bounds, canvas, targetColor);

        if (player.primaryTarget?.id === target.id) {
          this.renderCornerBrackets(ctx, target, bounds, canvas, {
            color: targetColor, alpha: 0.9, lineWidth: 3,
          });
          const primaryPulse = Math.sin(timestamp / 200) * 0.4 + 0.6;
          this.renderCornerBrackets(ctx, target, bounds, canvas, {
            color: '#ffffff', alpha: primaryPulse * 0.3, lineWidth: 1.5,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** World-space radius → screen-space half-size for brackets. Rotation-invariant. */
  private halfSize(assembly: Assembly, bounds: Matter.Bounds, canvas: HTMLCanvasElement): number {
    const screenScale = canvas.width / (bounds.max.x - bounds.min.x);
    return Math.max(MIN_HALF_SIZE, assembly.getShieldRadius() * screenScale) + SCREEN_PAD;
  }

  /** Assembly root-body world position → screen pixel coordinates. */
  private centerOnScreen(
    assembly: Assembly,
    bounds: Matter.Bounds,
    canvas: HTMLCanvasElement,
  ): { cx: number; cy: number } {
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const pos = assembly.rootBody.position;
    return {
      cx: (pos.x - bounds.min.x) / bw * canvas.width,
      cy: (pos.y - bounds.min.y) / bh * canvas.height,
    };
  }

  private getAssemblyStatus(assembly: Assembly, player: Assembly | null): AssemblyStatus {
    if (player && assembly.id === player.id) return 'player';
    if (!assembly.hasControlCenter()) return 'neutral';
    if (player) return assembly.team === player.team ? 'friendly' : 'hostile';
    return assembly.team === 0 ? 'friendly' : 'hostile';
  }

  // ---------------------------------------------------------------------------
  // Renderers
  // ---------------------------------------------------------------------------

  private renderCornerBrackets(
    ctx: CanvasRenderingContext2D,
    assembly: Assembly,
    bounds: Matter.Bounds,
    canvas: HTMLCanvasElement,
    style: BracketStyle,
  ): void {
    const { cx, cy } = this.centerOnScreen(assembly, bounds, canvas);
    const hs = this.halfSize(assembly, bounds, canvas);
    const arm = Math.max(8, hs * CORNER_FRAC);

    const l = cx - hs, r = cx + hs;
    const t = cy - hs, b = cy + hs;

    ctx.globalAlpha = style.alpha;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.lineWidth;
    ctx.setLineDash([]);
    ctx.lineCap = 'square';

    // Top-left
    ctx.beginPath();
    ctx.moveTo(l, t + arm);
    ctx.lineTo(l, t);
    ctx.lineTo(l + arm, t);
    ctx.stroke();

    // Top-right
    ctx.beginPath();
    ctx.moveTo(r - arm, t);
    ctx.lineTo(r, t);
    ctx.lineTo(r, t + arm);
    ctx.stroke();

    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(r, b - arm);
    ctx.lineTo(r, b);
    ctx.lineTo(r - arm, b);
    ctx.stroke();

    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(l + arm, b);
    ctx.lineTo(l, b);
    ctx.lineTo(l, b - arm);
    ctx.stroke();

    ctx.globalAlpha = 1;
  }

  private renderHoverTooltip(
    ctx: CanvasRenderingContext2D,
    assembly: Assembly,
    bounds: Matter.Bounds,
    canvas: HTMLCanvasElement,
    player: Assembly | null,
  ): void {
    const { cx, cy } = this.centerOnScreen(assembly, bounds, canvas);
    const hs = this.halfSize(assembly, bounds, canvas);
    const topSY = cy - hs;
    const botSY = cy + hs;

    const status = this.getAssemblyStatus(assembly, player);
    const statusColor = STATUS_COLORS[status];
    const statusText = `[${STATUS_LABELS[status]}]`;
    const name = assembly.shipName;
    const blockCount = assembly.entities.filter(e => !e.destroyed).length;
    const infoText = `${blockCount} block${blockCount !== 1 ? 's' : ''}`;

    ctx.save();
    ctx.font = 'bold 10px monospace';
    const statusW = ctx.measureText(statusText).width;
    ctx.font = '11px monospace';
    const nameW = ctx.measureText(name).width;
    ctx.font = '10px monospace';
    const infoW = ctx.measureText(infoText).width;

    const PADDING = 8;
    const LINE_H = 14;
    const contentW = Math.max(statusW + 6 + nameW, infoW);
    const tooltipW = contentW + PADDING * 2;
    const tooltipH = LINE_H * 2 + PADDING;

    const tooltipY = topSY - tooltipH - 4 > 4 ? topSY - tooltipH - 4 : botSY + 4;
    const tooltipX = Math.max(4, Math.min(canvas.width - tooltipW - 4, cx - tooltipW / 2));

    ctx.globalAlpha = 0.88;
    ctx.fillStyle = '#000814';
    ctx.fillRect(tooltipX, tooltipY, tooltipW, tooltipH);
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = statusColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(tooltipX, tooltipY, tooltipW, tooltipH);
    ctx.globalAlpha = 1;

    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = statusColor;
    ctx.textAlign = 'left';
    ctx.fillText(statusText, tooltipX + PADDING, tooltipY + LINE_H);

    ctx.font = '11px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, tooltipX + PADDING + statusW + 6, tooltipY + LINE_H);

    ctx.font = '10px monospace';
    ctx.fillStyle = '#888888';
    ctx.fillText(infoText, tooltipX + PADDING, tooltipY + LINE_H * 2 + 2);

    ctx.restore();
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
