import * as Matter from 'matter-js';
import { Missile, MissileType } from './Missile';
import { Assembly } from './Assembly';
import { Vector2 } from '../types/GameTypes';

export class MissileSystem {
    private missiles: Missile[] = [];
    private world: Matter.World;

    constructor(world: Matter.World) {
        this.world = world;
    }

    public createMissile(
        position: Vector2,
        angle: number,
        missileType: MissileType,
        sourceAssemblyId: string,
        targetAssembly?: Assembly
    ): Missile {
        const missile = new Missile(position, angle, missileType, sourceAssemblyId, targetAssembly);
        this.missiles.push(missile);
        Matter.World.add(this.world, missile.body);
        return missile;
    }    public update(deltaTime: number, assemblies: Assembly[]): void {
        // Filter out non-destroyed assemblies (not including missiles as assemblies)
        const availableTargets = assemblies.filter(a => !a.destroyed && a.entities && a.entities.length > 0);

        // Update all missiles
        for (let i = this.missiles.length - 1; i >= 0; i--) {
            const missile = this.missiles[i];

            if (missile.destroyed) {
                // Remove destroyed missile
                Matter.World.remove(this.world, missile.body);
                this.missiles.splice(i, 1);
                continue;
            }

            // Update missile logic
            missile.update(deltaTime, availableTargets);
        }
    }    public handleMissileHit(missile: Missile, targetEntity: any): void {
        // Check collision delay - missiles shouldn't collide immediately after launch
        if (missile.age < missile.launchCollisionDelay) {
            console.log(`🚀 Missile collision ignored - still in launch phase (${missile.age.toFixed(2)}s)`);
            return;
        }

        // Prevent self-hits - check if the target entity belongs to the source assembly
        if (targetEntity.body?.assembly?.id === missile.sourceAssemblyId) {
            console.log(`🚀 Missile collision ignored - hitting source assembly`);
            return;
        }

        // Apply damage
        if (targetEntity.takeDamage) {
            targetEntity.takeDamage(missile.getDamage());
        }

        // Mark missile as destroyed
        missile.destroy();
    }

    public removeMissile(missile: Missile): void {
        const index = this.missiles.indexOf(missile);
        if (index !== -1) {
            Matter.World.remove(this.world, missile.body);
            this.missiles.splice(index, 1);
        }
    } public getMissiles(): Missile[] {
        return [...this.missiles];
    }

    public getMissilesForDebug(): Missile[] {
        return this.missiles;
    }

    public cleanup(): void {
        // Remove all missiles
        this.missiles.forEach(missile => {
            Matter.World.remove(this.world, missile.body);
        });
        this.missiles = [];
    }
}
