import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';
import { Structure } from '../structures/Structure';
import { StructureTurret } from '../structures/StructureTurret';
import { GridPowerSummary } from '../../types/GameTypes';

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

const AI_STATE_COLORS: Record<string, number> = {
  'SIZING UP': 0x888888,
  'ENGAGE':    0xffcc00,
  'PURSUE':    0xff8800,
  'RETREAT':   0xff3333,
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

const TOOLTIP_STYLE      = new PIXI.TextStyle({ fontFamily: 'monospace', fontSize: 10, fill: '#ffffff' });
const TOOLTIP_BOLD_STYLE = new PIXI.TextStyle({ fontFamily: 'monospace', fontSize: 10, fill: '#ffffff', fontWeight: 'bold' });
const LABEL_STYLE        = new PIXI.TextStyle({ fontFamily: 'Arial', fontSize: 12, fill: '#ffffff' });

// ---------------------------------------------------------------------------
// Color gradient helpers
// ---------------------------------------------------------------------------

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (Math.round(ar + (br - ar) * t) << 16) |
         (Math.round(ag + (bg - ag) * t) << 8) |
          Math.round(ab + (bb - ab) * t);
}

function gradientColor(stops: Array<{ at: number; color: number }>, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (clamped <= stops[i].at) {
      const prev = stops[i - 1];
      const curr = stops[i];
      const local = (clamped - prev.at) / (curr.at - prev.at);
      return lerpColor(prev.color, curr.color, local);
    }
  }
  return stops[stops.length - 1].color;
}

function toHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Grey when still, cyan when moving, orange when fast, red at extreme velocity. */
function speedColor(speed: number): number {
  return gradientColor([
    { at: 0,    color: 0x556677 },
    { at: 0.25, color: 0x44ccff },
    { at: 0.6,  color: 0xff9900 },
    { at: 1.0,  color: 0xff3333 },
  ], speed / 5);
}

/** Red when no engines, yellow at modest thrust, bright green at high thrust. */
function thrustColor(thrust: number): number {
  return gradientColor([
    { at: 0,    color: 0xff3333 },
    { at: 0.15, color: 0xff9900 },
    { at: 0.4,  color: 0xffee44 },
    { at: 1.0,  color: 0x44ff88 },
  ], thrust / 32);
}

/** Red at 0%, yellow around 50%, green at full power. */
function powerColor(efficiency: number): number {
  return gradientColor([
    { at: 0,    color: 0xff3333 },
    { at: 0.35, color: 0xff9900 },
    { at: 0.65, color: 0xffee44 },
    { at: 1.0,  color: 0x44ff88 },
  ], efficiency);
}

/** Light cyan-white for nimble ships, muted blue for capital-scale mass. */
function massColor(mass: number): number {
  return gradientColor([
    { at: 0,   color: 0xaaddff },
    { at: 0.4, color: 0x6699cc },
    { at: 1.0, color: 0x3d6080 },
  ], mass / 20000);
}

function formatMass(mass: number): string {
  return mass >= 1000 ? `${(mass / 1000).toFixed(1)}k` : String(Math.round(mass));
}

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
    private readonly getAIStateLabel:     (assembly: Assembly) => string | null,
    private readonly getHoveredStructure?:  () => Structure | null,
    private readonly getSelectedStructure?: () => Structure | null,
    private readonly getStructureGridSummary?: (structure: Structure) => GridPowerSummary | null,
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
      const hoveredStateLabel = this.getAIStateLabel(hovered);
      this.renderTooltip(hovered, bounds, canvas, player, hoveredStateLabel);
    }

    // Selected brackets + AI state label
    const selected = this.getSelectedAssembly();
    if (selected && !selected.destroyed) {
      this.renderBrackets(selected, bounds, canvas, { color: 0x00ffff, alpha: 0.9, lineWidth: 2 });
      const pulse = Math.sin(timestamp / 300) * 0.3 + 0.7;
      this.renderBrackets(selected, bounds, canvas, { color: 0xffffff, alpha: pulse * 0.35, lineWidth: 1 });

      const stateLabel = this.getAIStateLabel(selected);
      if (stateLabel) {
        this.renderAIStateLabel(selected, bounds, canvas, stateLabel);
      }
    }

    // Structure hover
    const hoveredStruct = this.getHoveredStructure?.();
    if (hoveredStruct && !hoveredStruct.isDestroyed()) {
      this.renderStructureBrackets(hoveredStruct, bounds, canvas, { color: 0xffff00, alpha: 0.9, lineWidth: 1.5 });
      this.renderStructureTooltip(hoveredStruct, bounds, canvas);
    }

    // Structure selection
    const selectedStruct = this.getSelectedStructure?.();
    if (selectedStruct && !selectedStruct.isDestroyed()) {
      this.renderStructureBrackets(selectedStruct, bounds, canvas, { color: 0x00ffff, alpha: 0.9, lineWidth: 2 });
      const pulse = Math.sin(timestamp / 300) * 0.3 + 0.7;
      this.renderStructureBrackets(selectedStruct, bounds, canvas, { color: 0xffffff, alpha: pulse * 0.35, lineWidth: 1 });
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
    return Math.max(MIN_HALF_SIZE, assembly.getBoundingRadius() * screenScale) + SCREEN_PAD;
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
    aiStateLabel: string | null,
  ): void {
    const { cx, cy } = this.centerOnScreen(assembly, bounds, canvas);
    const screenScale = canvas.width / (bounds.max.x - bounds.min.x);
    const hs = this.halfSize(assembly, screenScale);
    const topSY = cy - hs;
    const botSY = cy + hs;

    const status      = this.getStatus(assembly, player);
    const statusColor = STATUS_COLORS[status];
    const statusText  = `[${STATUS_LABELS[status]}]`;
    const nameText    = assembly.shipName;

    // Gather stats
    const blockCount = assembly.entities.filter(e => !e.destroyed).length;
    const mass       = assembly.rootBody.mass;
    const speed      = assembly.getCurrentSpeed();
    const thrust     = assembly.getTotalThrust();
    const power      = assembly.getPowerEfficiency();

    interface StatRow { label: string; value: string; color: number; bold?: boolean }
    const rows: StatRow[] = [
      ...(aiStateLabel ? [{ label: 'AI',   value: aiStateLabel,                    color: AI_STATE_COLORS[aiStateLabel] ?? 0xffffff, bold: true }] : []),
      { label: 'BLK',  value: String(blockCount),                                  color: 0x778899 },
      { label: 'MASS', value: formatMass(mass),                                    color: massColor(mass) },
      { label: 'SPD',  value: speed.toFixed(1),                                    color: speedColor(speed) },
      { label: 'THR',  value: thrust > 0 ? thrust.toFixed(1) : '—',               color: thrustColor(thrust) },
      { label: 'PWR',  value: `${Math.round(power * 100)}%`,                      color: powerColor(power) },
    ];

    const PADDING    = 8;
    const LINE_H     = 14;
    const VALUE_GAP  = 8;
    const DIVIDER_H  = 8; // vertical space around the separator line

    // Use proper TextStyle instances for measurement (measureText needs toFontString()).
    // Color doesn't affect glyph metrics — only font-family/size/weight matter here.
    const dimLabelStyle = { ...TOOLTIP_STYLE, fill: '#445566' } as PIXI.TextStyle;
    const statusStyle   = { ...TOOLTIP_STYLE, fill: toHex(statusColor), fontWeight: 'bold' } as PIXI.TextStyle;

    // Measure label and value columns
    const labelW    = Math.max(...rows.map(r =>
      PIXI.TextMetrics.measureText(r.label, r.bold ? TOOLTIP_BOLD_STYLE : TOOLTIP_STYLE).width));
    const maxValueW = Math.max(...rows.map(r =>
      PIXI.TextMetrics.measureText(r.value, r.bold ? TOOLTIP_BOLD_STYLE : TOOLTIP_STYLE).width));

    const statusMeasure = PIXI.TextMetrics.measureText(statusText, TOOLTIP_BOLD_STYLE);
    const nameMeasure   = PIXI.TextMetrics.measureText(nameText,   TOOLTIP_STYLE);
    const headerW       = statusMeasure.width + 4 + nameMeasure.width;

    const contentW  = Math.max(headerW, labelW + VALUE_GAP + maxValueW);
    const tooltipW  = contentW + PADDING * 2;
    const tooltipH  = LINE_H + DIVIDER_H + rows.length * LINE_H + PADDING;
    const tooltipY  = topSY - tooltipH - 4 > 4 ? topSY - tooltipH - 4 : botSY + 4;
    const tooltipX  = Math.max(4, Math.min(canvas.width - tooltipW - 4, cx - tooltipW / 2));

    // Background
    this.graphics.lineStyle(1, statusColor, 0.6);
    this.graphics.beginFill(0x000814, 0.90);
    this.graphics.drawRect(tooltipX, tooltipY, tooltipW, tooltipH);
    this.graphics.endFill();

    // Divider between header and stats
    const divY = tooltipY + LINE_H + DIVIDER_H / 2;
    this.graphics.lineStyle(0.5, 0x223344, 1.0);
    this.graphics.moveTo(tooltipX + PADDING, divY);
    this.graphics.lineTo(tooltipX + tooltipW - PADDING, divY);

    // Header: [STATUS] Ship Name
    const headerY = tooltipY + LINE_H / 2 + PADDING / 2;
    this.getPooledText(statusText, statusStyle, tooltipX + PADDING, headerY);
    this.getPooledText(nameText,   TOOLTIP_STYLE, tooltipX + PADDING + statusMeasure.width + 4, headerY);

    // Stat rows — label left-aligned, value right-aligned to a fixed column
    const valueX    = tooltipX + PADDING + labelW + VALUE_GAP;
    const rowStartY = tooltipY + LINE_H + DIVIDER_H + LINE_H / 2;

    rows.forEach((row, i) => {
      const rowY      = rowStartY + i * LINE_H;
      const valueStyle = { ...TOOLTIP_STYLE, fill: toHex(row.color), fontWeight: row.bold ? 'bold' : 'normal' } as PIXI.TextStyle;
      this.getPooledText(row.label, dimLabelStyle, tooltipX + PADDING, rowY);
      this.getPooledText(row.value, valueStyle,    valueX,              rowY);
    });
  }

  private renderAIStateLabel(
    assembly: Assembly,
    bounds: { min: { x: number; y: number }; max: { x: number; y: number } },
    canvas: HTMLCanvasElement,
    stateLabel: string,
  ): void {
    const { cx, cy } = this.centerOnScreen(assembly, bounds, canvas);
    const screenScale = canvas.width / (bounds.max.x - bounds.min.x);
    const hs = this.halfSize(assembly, screenScale);
    const color = AI_STATE_COLORS[stateLabel] ?? 0xffffff;
    const colorHex = `#${color.toString(16).padStart(6, '0')}`;

    const style = new PIXI.TextStyle({ fontFamily: 'monospace', fontSize: 10, fill: colorHex, fontWeight: 'bold' });
    const text = this.getPooledText(stateLabel, style, cx, cy + hs + 10);
    text.anchor.set(0.5, 0);

    // Small pill background
    const tw = PIXI.TextMetrics.measureText(stateLabel, style).width;
    const ph = 12, pw = tw + 8;
    this.graphics.lineStyle(1, color, 0.6);
    this.graphics.beginFill(0x000814, 0.75);
    this.graphics.drawRoundedRect(cx - pw / 2, cy + hs + 3, pw, ph, 3);
    this.graphics.endFill();
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

  // ---------------------------------------------------------------------------
  // Structure highlight helpers
  // ---------------------------------------------------------------------------

  private structureScreenInfo(
    structure: Structure,
    bounds: { min: { x: number; y: number }; max: { x: number; y: number } },
    canvas: HTMLCanvasElement,
  ): { cx: number; cy: number; hs: number } {
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const pos = structure.body.position;
    const cx = (pos.x - bounds.min.x) / bw * canvas.width;
    const cy = (pos.y - bounds.min.y) / bh * canvas.height;
    const screenScale = canvas.width / bw;
    const worldRadius = Math.max(structure.definition.widthPx, structure.definition.heightPx) / 2;
    const hs = Math.max(MIN_HALF_SIZE, worldRadius * screenScale) + SCREEN_PAD;
    return { cx, cy, hs };
  }

  private renderStructureBrackets(
    structure: Structure,
    bounds: { min: { x: number; y: number }; max: { x: number; y: number } },
    canvas: HTMLCanvasElement,
    style: BracketStyle,
  ): void {
    const { cx, cy, hs } = this.structureScreenInfo(structure, bounds, canvas);
    const arm = Math.max(8, hs * CORNER_FRAC);
    const l = cx - hs, r = cx + hs, t = cy - hs, b = cy + hs;

    this.graphics.lineStyle(style.lineWidth, style.color, style.alpha);
    this.graphics.moveTo(l, t + arm); this.graphics.lineTo(l, t); this.graphics.lineTo(l + arm, t);
    this.graphics.moveTo(r - arm, t); this.graphics.lineTo(r, t); this.graphics.lineTo(r, t + arm);
    this.graphics.moveTo(r, b - arm); this.graphics.lineTo(r, b); this.graphics.lineTo(r - arm, b);
    this.graphics.moveTo(l + arm, b); this.graphics.lineTo(l, b); this.graphics.lineTo(l, b - arm);
  }

  private renderStructureTooltip(
    structure: Structure,
    bounds: { min: { x: number; y: number }; max: { x: number; y: number } },
    canvas: HTMLCanvasElement,
  ): void {
    const { cx, cy, hs } = this.structureScreenInfo(structure, bounds, canvas);
    const topSY = cy - hs;
    const botSY = cy + hs;

    const teamLabel = structure.team === 0 ? 'FRIENDLY' : structure.team >= 0 ? 'HOSTILE' : 'NEUTRAL';
    const teamColor = structure.team === 0 ? STATUS_COLORS.friendly : structure.team >= 0 ? STATUS_COLORS.hostile : STATUS_COLORS.neutral;
    const statusText = `[${teamLabel}]`;
    const nameText = structure.definition.label;

    // Build stat rows
    interface StatRow { label: string; value: string; color: number; bold?: boolean }
    const rows: StatRow[] = [];

    // Health
    const hpFrac = structure.getHealthFraction();
    const hpColor = hpFrac > 0.5 ? 0x44ff88 : hpFrac > 0.25 ? 0xffee44 : 0xff3333;
    rows.push({ label: 'HP', value: `${Math.round(structure.currentHealth)} / ${structure.maxHealth}`, color: hpColor });

    // Construction progress
    if (!structure.isConstructed) {
      const pct = Math.round(structure.getConstructionFraction() * 100);
      rows.push({ label: 'BUILD', value: `${pct}%`, color: 0xd4a843, bold: true });
    }

    // Power output/consumption
    const def = structure.definition;
    if (def.powerOutput > 0) {
      rows.push({ label: 'PWR', value: `+${def.powerOutput}`, color: 0x44ff88 });
    }
    if (def.powerConsumption > 0) {
      rows.push({ label: 'PWR', value: `-${def.powerConsumption}`, color: 0xff9900 });
    }

    // Storage
    if (def.storageCapacity > 0) {
      rows.push({ label: 'STR', value: `${Math.round(structure.getInventoryTotal())} / ${def.storageCapacity}`, color: 0x778899 });
    }

    // Grid summary (if available)
    const summary = this.getStructureGridSummary?.(structure);
    if (summary) {
      const netColor = summary.netPower >= 0 ? 0x44ff88 : 0xff3333;
      const netSign = summary.netPower >= 0 ? '+' : '';
      rows.push({ label: 'NET', value: `${netSign}${summary.netPower} pwr`, color: netColor });
    }

    // Turret-specific stats
    if (structure instanceof StructureTurret) {
      if (def.weaponRange) rows.push({ label: 'RNG', value: `${def.weaponRange}`, color: 0x778899 });
      if (def.fireRateMs) rows.push({ label: 'ROF', value: `${(1000 / def.fireRateMs).toFixed(1)}/s`, color: 0x778899 });
    }

    const PADDING = 8;
    const LINE_H = 14;
    const VALUE_GAP = 8;
    const DIVIDER_H = 8;

    const dimLabelStyle = { ...TOOLTIP_STYLE, fill: '#445566' } as PIXI.TextStyle;
    const statusStyle = { ...TOOLTIP_STYLE, fill: toHex(teamColor), fontWeight: 'bold' } as PIXI.TextStyle;

    const labelW = rows.length > 0 ? Math.max(...rows.map(r =>
      PIXI.TextMetrics.measureText(r.label, r.bold ? TOOLTIP_BOLD_STYLE : TOOLTIP_STYLE).width)) : 0;
    const maxValueW = rows.length > 0 ? Math.max(...rows.map(r =>
      PIXI.TextMetrics.measureText(r.value, r.bold ? TOOLTIP_BOLD_STYLE : TOOLTIP_STYLE).width)) : 0;

    const statusMeasure = PIXI.TextMetrics.measureText(statusText, TOOLTIP_BOLD_STYLE);
    const nameMeasure = PIXI.TextMetrics.measureText(nameText, TOOLTIP_STYLE);
    const headerW = statusMeasure.width + 4 + nameMeasure.width;

    const contentW = Math.max(headerW, labelW + VALUE_GAP + maxValueW);
    const tooltipW = contentW + PADDING * 2;
    const tooltipH = LINE_H + DIVIDER_H + rows.length * LINE_H + PADDING;
    const tooltipY = topSY - tooltipH - 4 > 4 ? topSY - tooltipH - 4 : botSY + 4;
    const tooltipX = Math.max(4, Math.min(canvas.width - tooltipW - 4, cx - tooltipW / 2));

    // Background
    this.graphics.lineStyle(1, teamColor, 0.6);
    this.graphics.beginFill(0x000814, 0.90);
    this.graphics.drawRect(tooltipX, tooltipY, tooltipW, tooltipH);
    this.graphics.endFill();

    // Divider
    const divY = tooltipY + LINE_H + DIVIDER_H / 2;
    this.graphics.lineStyle(0.5, 0x223344, 1.0);
    this.graphics.moveTo(tooltipX + PADDING, divY);
    this.graphics.lineTo(tooltipX + tooltipW - PADDING, divY);

    // Header: [TEAM] Structure Name
    const headerY = tooltipY + LINE_H / 2 + PADDING / 2;
    this.getPooledText(statusText, statusStyle, tooltipX + PADDING, headerY);
    this.getPooledText(nameText, TOOLTIP_STYLE, tooltipX + PADDING + statusMeasure.width + 4, headerY);

    // Stat rows
    const valueX = tooltipX + PADDING + labelW + VALUE_GAP;
    const rowStartY = tooltipY + LINE_H + DIVIDER_H + LINE_H / 2;

    rows.forEach((row, i) => {
      const rowY = rowStartY + i * LINE_H;
      const valueStyle = { ...TOOLTIP_STYLE, fill: toHex(row.color), fontWeight: row.bold ? 'bold' : 'normal' } as PIXI.TextStyle;
      this.getPooledText(row.label, dimLabelStyle, tooltipX + PADDING, rowY);
      this.getPooledText(row.value, valueStyle, valueX, rowY);
    });
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
