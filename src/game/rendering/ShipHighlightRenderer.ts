import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';

interface BracketStyle {
  color: number;
  alpha: number;
  lineWidth: number;
}

type AssemblyStatus = 'player' | 'friendly' | 'hostile' | 'neutral';

const STATUS_COLORS: Record<AssemblyStatus, number> = {
  player:   0x00ffff,
  friendly: 0x44ff44,
  hostile:  0xff4444,
  neutral:  0xaaaaaa,
};

const STATUS_LABELS: Record<AssemblyStatus, string> = {
  player:   'PLAYER',
  friendly: 'FRIENDLY',
  hostile:  'HOSTILE',
  neutral:  'NEUTRAL',
};

const SCREEN_PAD = 12;
const CORNER_FRAC = 0.30;
const MIN_HALF_SIZE = 20;

const TOOLTIP_STYLE = new PIXI.TextStyle({ fontFamily: 'monospace', fontSize: 10, fill: '#ffffff' });
const LABEL_STYLE   = new PIXI.TextStyle({ fontFamily: 'Arial', fontSize: 12, fill: '#ffffff' });

export class ShipHighlightRenderer implements IRenderer {
  readonly renderPriority = 50;

  private graphics!: PIXI.Graphics;
  private tooltipContainer!: PIXI.Container;
  private labelPool: PIXI.Text[] = [];

  constructor(
    private readonly getPlayerAssembly:   () => Assembly | null,
    private readonly getHoveredAssembly:  () => Assembly | null,
    private readonly getSelectedAssembly: () => Assembly | null,
    private readonly getLockedTargets:    (assembly: Assembly) => Assembly[],
  ) {}

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
    this.tooltipContainer = new PIXI.Container();
    stage.addChild(this.tooltipContainer);
  }

  render(viewport: Viewport, timestamp: number): void {
    this.graphics.clear();
    // Clear tooltip children for this frame
    for (const child of this.tooltipContainer.children) {
      (child as PIXI.Text).visible = false;
    }
    this.labelPool.forEach(t => { t.visible = false; });

    const { bounds, canvas } = viewport;
    const bw = bounds.max.x - bounds.min.x;
    const screenScale = canvas.width / bw;
    const player = this.getPlayerAssembly();

    // Hover brackets
    const hovered = this.getHoveredAssembly();
    if (hovered && !hovered.destroyed && hovered !== player) {
      this.renderBrackets(hovered, bounds, canvas, { color: 0xffff00, alpha: 0.9, lineWidth: 1.5 });
      this.renderTooltip(hovered, bounds, canvas, player);
    }

    // Selected brackets
    const selected = this.getSelectedAssembly();
    if (selected && !selected.destroyed) {
      this.renderBrackets(selected, bounds, canvas, { color: 0x00ffff, alpha: 0.9, lineWidth: 2 });
      const pulse = Math.sin(timestamp / 300) * 0.3 + 0.7;
      this.renderBrackets(selected, bounds, canvas, { color: 0xffffff, alpha: pulse * 0.35, lineWidth: 1 });
    }

    // Locked targets
    if (player && !player.destroyed) {
      for (const target of this.getLockedTargets(player)) {
        if (target.destroyed) continue;
        const isEnemy = target.team !== player.team;
        const color = isEnemy ? 0xff4444 : 0x44ff44;

        this.renderTargetSquare(target, bounds, canvas, color, screenScale);

        if (player.primaryTarget?.id === target.id) {
          this.renderBrackets(target, bounds, canvas, { color, alpha: 0.9, lineWidth: 3 });
          const pulse = Math.sin(timestamp / 200) * 0.4 + 0.6;
          this.renderBrackets(target, bounds, canvas, { color: 0xffffff, alpha: pulse * 0.3, lineWidth: 1.5 });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------

  private halfSize(assembly: Assembly, screenScale: number): number {
    return Math.max(MIN_HALF_SIZE, assembly.getShieldRadius() * screenScale) + SCREEN_PAD;
  }

  private centerOnScreen(
    assembly: Assembly,
    bounds: { min: { x: number; y: number }; max: { x: number; y: number } },
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

  private getStatus(assembly: Assembly, player: Assembly | null): AssemblyStatus {
    if (player && assembly.id === player.id) return 'player';
    if (!assembly.hasControlCenter()) return 'neutral';
    if (player) return assembly.team === player.team ? 'friendly' : 'hostile';
    return assembly.team === 0 ? 'friendly' : 'hostile';
  }

  private renderBrackets(
    assembly: Assembly,
    bounds: { min: { x: number; y: number }; max: { x: number; y: number } },
    canvas: HTMLCanvasElement,
    style: BracketStyle,
  ): void {
    const { cx, cy } = this.centerOnScreen(assembly, bounds, canvas);
    const screenScale = canvas.width / (bounds.max.x - bounds.min.x);
    const hs = this.halfSize(assembly, screenScale);
    const arm = Math.max(8, hs * CORNER_FRAC);
    const l = cx - hs, r = cx + hs, t = cy - hs, b = cy + hs;

    this.graphics.lineStyle(style.lineWidth, style.color, style.alpha);
    // Top-left
    this.graphics.moveTo(l, t + arm); this.graphics.lineTo(l, t); this.graphics.lineTo(l + arm, t);
    // Top-right
    this.graphics.moveTo(r - arm, t); this.graphics.lineTo(r, t); this.graphics.lineTo(r, t + arm);
    // Bottom-right
    this.graphics.moveTo(r, b - arm); this.graphics.lineTo(r, b); this.graphics.lineTo(r - arm, b);
    // Bottom-left
    this.graphics.moveTo(l + arm, b); this.graphics.lineTo(l, b); this.graphics.lineTo(l, b - arm);
  }

  private renderTooltip(
    assembly: Assembly,
    bounds: { min: { x: number; y: number }; max: { x: number; y: number } },
    canvas: HTMLCanvasElement,
    player: Assembly | null,
  ): void {
    const { cx, cy } = this.centerOnScreen(assembly, bounds, canvas);
    const screenScale = canvas.width / (bounds.max.x - bounds.min.x);
    const hs = this.halfSize(assembly, screenScale);
    const topSY = cy - hs;
    const botSY = cy + hs;

    const status = this.getStatus(assembly, player);
    const statusColor = STATUS_COLORS[status];
    const statusText  = `[${STATUS_LABELS[status]}]`;
    const nameText    = assembly.shipName;
    const blockCount  = assembly.entities.filter(e => !e.destroyed).length;
    const infoText    = `${blockCount} block${blockCount !== 1 ? 's' : ''}`;

    const PADDING = 8;
    const LINE_H  = 14;

    const statusMeasure = PIXI.TextMetrics.measureText(statusText, TOOLTIP_STYLE);
    const nameMeasure   = PIXI.TextMetrics.measureText(nameText,   TOOLTIP_STYLE);
    const infoMeasure   = PIXI.TextMetrics.measureText(infoText,   TOOLTIP_STYLE);

    const contentW  = Math.max(statusMeasure.width + 4 + nameMeasure.width, infoMeasure.width);
    const tooltipW  = contentW + PADDING * 2;
    const tooltipH  = LINE_H * 2 + PADDING;
    const tooltipY  = topSY - tooltipH - 4 > 4 ? topSY - tooltipH - 4 : botSY + 4;
    const tooltipX  = Math.max(4, Math.min(canvas.width - tooltipW - 4, cx - tooltipW / 2));

    // Background
    this.graphics.lineStyle(1, statusColor, 0.7);
    this.graphics.beginFill(0x000814, 0.88);
    this.graphics.drawRect(tooltipX, tooltipY, tooltipW, tooltipH);
    this.graphics.endFill();

    // Text items
    this.getPooledText(statusText, { ...TOOLTIP_STYLE, fill: `#${statusColor.toString(16).padStart(6, '0')}`, fontWeight: 'bold' } as PIXI.TextStyle,
      tooltipX + PADDING, tooltipY + LINE_H);
    this.getPooledText(nameText, TOOLTIP_STYLE,
      tooltipX + PADDING + statusMeasure.width + 4, tooltipY + LINE_H);
    this.getPooledText(infoText, { ...TOOLTIP_STYLE, fill: '#888888' } as PIXI.TextStyle,
      tooltipX + PADDING, tooltipY + LINE_H * 2 + 2);
  }

  private renderTargetSquare(
    target: Assembly,
    bounds: { min: { x: number; y: number }; max: { x: number; y: number } },
    canvas: HTMLCanvasElement,
    color: number,
    screenScale: number,
  ): void {
    if (target.entities.length === 0) return;
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const pos = target.rootBody.position;
    const screenX = (pos.x - bounds.min.x) / bw * canvas.width;
    const screenY = (pos.y - bounds.min.y) / bh * canvas.height;
    const sq = 20;
    const bo = sq / 2 + 2;
    const bs = 8;

    this.graphics.lineStyle(2, color, 0.8);
    this.graphics.drawRect(screenX - sq / 2, screenY - sq / 2, sq, sq);
    this.graphics.lineStyle(3, color, 0.8);
    // TL
    this.graphics.moveTo(screenX - bo, screenY - bo + bs); this.graphics.lineTo(screenX - bo, screenY - bo); this.graphics.lineTo(screenX - bo + bs, screenY - bo);
    // TR
    this.graphics.moveTo(screenX + bo - bs, screenY - bo); this.graphics.lineTo(screenX + bo, screenY - bo); this.graphics.lineTo(screenX + bo, screenY - bo + bs);
    // BL
    this.graphics.moveTo(screenX - bo, screenY + bo - bs); this.graphics.lineTo(screenX - bo, screenY + bo); this.graphics.lineTo(screenX - bo + bs, screenY + bo);
    // BR
    this.graphics.moveTo(screenX + bo - bs, screenY + bo); this.graphics.lineTo(screenX + bo, screenY + bo); this.graphics.lineTo(screenX + bo, screenY + bo - bs);

    // Name label
    void screenScale;
    const label = this.getPooledText(
      target.shipName,
      { ...LABEL_STYLE, fill: `#${color.toString(16).padStart(6, '0')}` } as PIXI.TextStyle,
      screenX, screenY + bo + 15,
    );
    label.anchor.set(0.5, 0);
  }

  /** Reuse / create a PIXI.Text from the pool. Returns the text object so callers can adjust anchor etc. */
  private getPooledText(content: string, style: PIXI.TextStyle, x: number, y: number): PIXI.Text {
    // Find an unused (invisible) text object
    let text = this.labelPool.find(t => !t.visible);
    if (!text) {
      text = new PIXI.Text('', style);
      this.tooltipContainer.addChild(text);
      this.labelPool.push(text);
    }
    text.style = style;
    text.text  = content;
    text.x = x;
    text.y = y;
    text.anchor.set(0, 0.5);
    text.visible = true;
    return text;
  }
}
