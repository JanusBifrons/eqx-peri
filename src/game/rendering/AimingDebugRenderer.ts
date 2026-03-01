import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { Assembly } from '../core/Assembly';

const DISTANCE_RANGES = [100, 200, 300, 500];
const MAX_DISTANCE = 500;

export class AimingDebugRenderer implements IRenderer {
  readonly renderPriority = 60;

  constructor(private readonly getPlayerAssembly: () => Assembly | null) {}

  render(ctx: CanvasRenderingContext2D, viewport: Viewport, _timestamp: number): void {
    const player = this.getPlayerAssembly();
    if (!player || player.destroyed) return;

    const { bounds, canvas } = viewport;
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const sx = (wx: number) => (wx - bounds.min.x) / bw * canvas.width;
    const sy = (wy: number) => (wy - bounds.min.y) / bh * canvas.height;

    const currentAngle = player.rootBody.angle;
    const shipPos = player.rootBody.position;
    const shipScreenX = sx(shipPos.x);
    const shipScreenY = sy(shipPos.y);

    const weapons = player.entities.filter(e => e.canFire());
    for (const weapon of weapons) {
      const weaponPos = weapon.getMuzzlePosition(currentAngle);
      const weaponScreenX = sx(weaponPos.x);
      const weaponScreenY = sy(weaponPos.y);

      const weaponNaturalAngle = currentAngle + (weapon.rotation * Math.PI / 180);
      const aimingArc = player.getWeaponAimingArc(weapon.type);

      // Distance guide arcs
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;

      for (const worldDistance of DISTANCE_RANGES) {
        const screenDistance = worldDistance * canvas.width / bw;
        const arcStart = weaponNaturalAngle - aimingArc / 2;
        const arcEnd   = weaponNaturalAngle + aimingArc / 2;
        ctx.beginPath();
        ctx.arc(weaponScreenX, weaponScreenY, screenDistance, arcStart, arcEnd);
        ctx.stroke();
      }

      // Radial boundary lines
      const largestScreenDist = MAX_DISTANCE * canvas.width / bw;
      const leftAngle  = weaponNaturalAngle - aimingArc / 2;
      const rightAngle = weaponNaturalAngle + aimingArc / 2;

      ctx.beginPath();
      ctx.moveTo(weaponScreenX, weaponScreenY);
      ctx.lineTo(weaponScreenX + Math.cos(leftAngle) * largestScreenDist,
                 weaponScreenY + Math.sin(leftAngle) * largestScreenDist);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(weaponScreenX, weaponScreenY);
      ctx.lineTo(weaponScreenX + Math.cos(rightAngle) * largestScreenDist,
                 weaponScreenY + Math.sin(rightAngle) * largestScreenDist);
      ctx.stroke();

      ctx.globalAlpha = 1;

      // Distance label at largest arc
      const largestLabelDist = MAX_DISTANCE * canvas.width / bw;
      ctx.fillStyle = '#888888';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.8;
      const labelX = weaponScreenX + Math.cos(weaponNaturalAngle) * (largestLabelDist + 15);
      const labelY = weaponScreenY + Math.sin(weaponNaturalAngle) * (largestLabelDist + 15);
      ctx.fillText(`${MAX_DISTANCE}u`, labelX, labelY);
      ctx.globalAlpha = 1;

      // Dashed line from ship center to weapon
      ctx.strokeStyle = '#aaaaaa';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(shipScreenX, shipScreenY);
      ctx.lineTo(weaponScreenX, weaponScreenY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Weapon position dot
      ctx.fillStyle = '#dddddd';
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(weaponScreenX, weaponScreenY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Weapon type label
      ctx.fillStyle = '#bbbbbb';
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.9;
      ctx.fillText(weapon.type, weaponScreenX, weaponScreenY - 12);
      ctx.globalAlpha = 1;

      // Current aim direction line
      const currentAimAngle = weapon.getCurrentFiringAngle(currentAngle);
      const maxDistScreen = MAX_DISTANCE * canvas.width / bw;
      ctx.strokeStyle = '#999999';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(weaponScreenX, weaponScreenY);
      ctx.lineTo(
        weaponScreenX + Math.cos(currentAimAngle) * maxDistScreen,
        weaponScreenY + Math.sin(currentAimAngle) * maxDistScreen,
      );
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }
}
