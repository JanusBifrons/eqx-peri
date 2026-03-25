import * as Matter from 'matter-js';
import { Missile } from './Missile';
import { MissileConfig, Vector2 } from '../../types/GameTypes';
import { SoundSystem } from '../systems/SoundSystem';

/** Minimal assembly interface to avoid circular imports. */
interface MissileTarget {
  rootBody: Matter.Body;
  destroyed: boolean;
  id: string;
  team: number;
  damageShield?: (damage: number, now: number) => boolean;
  getTeam?: () => number;
  lastHitByAssemblyId?: string | null;
  lastHitByPlayer?: boolean;
  isPlayerControlled?: boolean;
}

export class MissileSystem {
  private missiles: Missile[] = [];
  private readonly world: Matter.World;

  constructor(world: Matter.World) {
    this.world = world;
  }

  public createMissile(
    position: Vector2,
    angle: number,
    config: MissileConfig,
    sourceAssemblyId: string,
    sourceTeam: number,
    targetAssembly?: MissileTarget,
  ): Missile {
    const missile = new Missile(position, angle, config, sourceAssemblyId, sourceTeam, targetAssembly);
    this.missiles.push(missile);
    Matter.World.add(this.world, missile.body);
    SoundSystem.getInstance().playMissileLaunch();
    return missile;
  }

  public update(deltaTime: number, assemblies: MissileTarget[]): void {
    const availableTargets = assemblies.filter(a => !a.destroyed);

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const missile = this.missiles[i];
      if (missile.destroyed) {
        Matter.World.remove(this.world, missile.body);
        this.missiles.splice(i, 1);
        continue;
      }
      missile.update(deltaTime, availableTargets);
    }
  }

  /**
   * Handle a missile colliding with an entity.
   * Returns true if the hit was valid and processed.
   */
  public handleMissileHit(missile: Missile, targetEntity: { takeDamage?: (d: number) => boolean; body?: { assembly?: MissileTarget } }): boolean {
    if (missile.age < missile.launchCollisionDelay) return false;

    // Prevent self-hits
    const targetAssembly = (targetEntity.body as Record<string, unknown>)?.assembly as MissileTarget | undefined;
    if (targetAssembly?.id === missile.sourceAssemblyId) return false;

    SoundSystem.getInstance().playMissileExplosion();

    // Shield interception (skip friendly fire)
    const isFriendlyFire = missile.sourceTeam >= 0 && targetAssembly && targetAssembly.getTeam?.() === missile.sourceTeam;
    if (!isFriendlyFire && targetAssembly?.damageShield) {
      if (targetAssembly.damageShield(missile.getDamage(), Date.now())) {
        missile.destroy();
        return true;
      }
    }

    // Apply damage to the entity
    if (targetEntity.takeDamage) {
      targetEntity.takeDamage(missile.getDamage());
    }

    missile.destroy();
    return true;
  }

  public getMissiles(): Missile[] {
    return this.missiles;
  }

  public cleanup(): void {
    for (const missile of this.missiles) {
      Matter.World.remove(this.world, missile.body);
    }
    this.missiles = [];
  }
}
