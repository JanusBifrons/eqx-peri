import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Connection } from '../structures/Connection';
import { InventoryItemType } from '../../types/GameTypes';

const FLASH_DURATION_MS = 300;

/**
 * Material color map — grouped by source asteroid type.
 * C-Type materials: blue/cyan tones
 * S-Type materials: green/amber tones
 * M-Type materials: orange/red tones
 * Ores: dim versions of their type color
 */
const MATERIAL_COLORS: Partial<Record<InventoryItemType, number>> = {
  // C-Type ores & materials (blue/cyan)
  CarbonaceousOre: 0x335577,
  Hydrogen:        0x66ccff,
  Oxygen:          0x88ddff,
  Carbon:          0x99bbdd,
  Coolant:         0x44ccee,
  Ammonia:         0x77aacc,
  Fluorine:        0x55dddd,
  PreSolarAminoAcids: 0xaaddff,

  // S-Type ores & materials (green/amber)
  SilicateOre:     0x557744,
  Silicon:         0x88cc66,
  Magnesium:       0xaadd55,
  Lithium:         0xddcc44,
  Titanium:        0xccbb66,
  PallasiteGem:    0xeedd66,

  // M-Type ores & materials (orange/red)
  MetallicOre:     0x775533,
  Iron:            0xee8844,
  Nickel:          0xddaa55,
  Copper:          0xee7744,
  Cobalt:          0xdd6655,
  IridiumGeode:    0xff8866,
};

const DEFAULT_FLOW_COLOR = 0x44ddff;

function getMaterialColor(material: InventoryItemType | null): number {
  if (!material) return DEFAULT_FLOW_COLOR;
  return MATERIAL_COLORS[material] ?? DEFAULT_FLOW_COLOR;
}

export class ConnectionRenderer implements IRenderer {
  readonly renderPriority = 13;

  private graphics!: PIXI.Graphics;

  constructor(private readonly getConnections: () => Connection[]) {}

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
  }

  render(viewport: Viewport): void {
    this.graphics.clear();

    const { bounds, canvas } = viewport;
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const sx = (wx: number): number => (wx - bounds.min.x) / bw * canvas.width;
    const sy = (wy: number): number => (wy - bounds.min.y) / bh * canvas.height;
    const scale = canvas.width / bw;
    const now = Date.now();

    for (const conn of this.getConnections()) {
      // Skip fence-to-fence connections — rendered as shield walls by StructureRenderer
      if (conn.nodeA.type === 'ShieldFence' && conn.nodeB.type === 'ShieldFence') continue;

      const ax = sx(conn.nodeA.body.position.x);
      const ay = sy(conn.nodeA.body.position.y);
      const bx = sx(conn.nodeB.body.position.x);
      const by = sy(conn.nodeB.body.position.y);

      // Viewport culling — skip if both endpoints are off-screen with margin
      const margin = 20;
      if (
        (ax < -margin && bx < -margin) ||
        (ax > canvas.width + margin && bx > canvas.width + margin) ||
        (ay < -margin && by < -margin) ||
        (ay > canvas.height + margin && by > canvas.height + margin)
      ) continue;

      // Flash state — only visible between flashAfter and flashUntil
      const flashing = now >= conn.flashAfter && now < conn.flashUntil;
      const flashProgress = flashing
        ? 1 - (conn.flashUntil - now) / FLASH_DURATION_MS
        : 1;

      // Determine color from material type when flashing
      const materialColor = flashing ? getMaterialColor(conn.flowMaterial) : 0x4488aa;

      // Line style
      const lineWidth = Math.max(1, (flashing ? 2.5 : 1) * scale);
      const alpha = flashing ? 0.9 - flashProgress * 0.5 : 0.3;

      this.graphics.lineStyle(lineWidth, flashing ? materialColor : 0x4488aa, alpha);
      this.graphics.moveTo(ax, ay);
      this.graphics.lineTo(bx, by);

      // Flash glow — thicker semi-transparent line on top
      if (flashing) {
        const glowAlpha = (1 - flashProgress) * 0.3;
        const glowWidth = lineWidth * 3;
        this.graphics.lineStyle(glowWidth, materialColor, glowAlpha);
        this.graphics.moveTo(ax, ay);
        this.graphics.lineTo(bx, by);
      }
    }
  }
}
