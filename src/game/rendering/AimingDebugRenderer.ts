import * as PIXI from 'pixi.js';
import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';
import { Entity } from '../core/Entity';

const DISTANCE_RANGES = [100, 200, 300, 500];
const MAX_DISTANCE = 500;

const LABEL_STYLE = new PIXI.TextStyle({ fontFamily: 'Arial', fontSize: 11, fill: '#bbbbbb' });
const DIST_STYLE  = new PIXI.TextStyle({ fontFamily: 'Arial', fontSize: 12, fill: '#888888' });

export class AimingDebugRenderer implements IRenderer {
  readonly renderPriority = 60;

  private graphics!: PIXI.Graphics;
  private labelContainer!: PIXI.Container;
  private labelCache = new Map<string, PIXI.Text>();
  private distLabel!: PIXI.Text;

  constructor(private readonly getPlayerAssembly: () => Assembly | null) {}

  init(stage: PIXI.Container): void {
    this.graphics = new PIXI.Graphics();
    stage.addChild(this.graphics);
    this.labelContainer = new PIXI.Container();
    stage.addChild(this.labelContainer);
    this.distLabel = new PIXI.Text('', DIST_STYLE);
    this.distLabel.anchor.set(0.5, 0.5);
    this.labelContainer.addChild(this.distLabel);
  }

  render(viewport: Viewport, _timestamp: number): void {
    this.graphics.clear();
    for (const t of this.labelCache.values()) t.visible = false;
    this.distLabel.visible = false;

    const player = this.getPlayerAssembly();
    if (!player || player.destroyed) return;

    const { bounds, canvas } = viewport;
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const sx = (wx: number) => (wx - bounds.min.x) / bw * canvas.width;
    const sy = (wy: number) => (wy - bounds.min.y) / bh * canvas.height;

    const currentAngle = player.rootBody.angle;
    const shipPos = player.rootBody.position;
    const shipSX = sx(shipPos.x);
    const shipSY = sy(shipPos.y);

    const weapons = player.entities.filter(e => e.canFire());
    for (const weapon of weapons) {
      const weaponPos = weapon.getMuzzlePosition(currentAngle);
      const wsx = sx(weaponPos.x);
      const wsy = sy(weaponPos.y);
      const naturalAngle = currentAngle + (weapon.rotation * Math.PI / 180);
      const aimingArc = player.getWeaponAimingArc(weapon.type);

      // Distance arcs
      this.graphics.lineStyle(1.5, 0x666666, 0.6);
      for (const wd of DISTANCE_RANGES) {
        const sd = wd * canvas.width / bw;
        this.graphics.arc(wsx, wsy, sd, naturalAngle - aimingArc / 2, naturalAngle + aimingArc / 2);
      }

      // Boundary lines
      const maxSD = MAX_DISTANCE * canvas.width / bw;
      const leftA  = naturalAngle - aimingArc / 2;
      const rightA = naturalAngle + aimingArc / 2;
      this.graphics.moveTo(wsx, wsy);
      this.graphics.lineTo(wsx + Math.cos(leftA) * maxSD, wsy + Math.sin(leftA) * maxSD);
      this.graphics.moveTo(wsx, wsy);
      this.graphics.lineTo(wsx + Math.cos(rightA) * maxSD, wsy + Math.sin(rightA) * maxSD);

      // Dashed ship→weapon line (approximated as semi-transparent solid)
      this.graphics.lineStyle(1, 0xaaaaaa, 0.5);
      this.graphics.moveTo(shipSX, shipSY);
      this.graphics.lineTo(wsx, wsy);

      // Aim direction
      this.graphics.lineStyle(2, 0x999999, 0.7);
      const aimAngle = weapon.getCurrentFiringAngle(currentAngle);
      this.graphics.moveTo(wsx, wsy);
      this.graphics.lineTo(wsx + Math.cos(aimAngle) * maxSD, wsy + Math.sin(aimAngle) * maxSD);

      // Weapon dot
      this.graphics.lineStyle(0);
      this.graphics.beginFill(0xdddddd, 0.9);
      this.graphics.drawCircle(wsx, wsy, 5);
      this.graphics.endFill();

      // Distance label
      const labelX = wsx + Math.cos(naturalAngle) * (maxSD + 15);
      const labelY = wsy + Math.sin(naturalAngle) * (maxSD + 15);
      this.distLabel.text = `${MAX_DISTANCE}u`;
      this.distLabel.x = labelX;
      this.distLabel.y = labelY;
      this.distLabel.visible = true;

      // Weapon type label
      this.getWeaponLabel(weapon).x = wsx;
      this.getWeaponLabel(weapon).y = wsy - 12;
      this.getWeaponLabel(weapon).visible = true;
    }
  }

  private getWeaponLabel(weapon: Entity): PIXI.Text {
    const key = weapon.id;
    let text = this.labelCache.get(key);
    if (!text) {
      text = new PIXI.Text(weapon.type, LABEL_STYLE);
      text.anchor.set(0.5, 0.5);
      this.labelContainer.addChild(text);
      this.labelCache.set(key, text);
    }
    text.visible = true;
    return text;
  }

  dispose(): void {
    for (const t of this.labelCache.values()) t.destroy();
    this.labelCache.clear();
  }
}
