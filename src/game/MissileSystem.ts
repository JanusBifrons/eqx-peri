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
    }

    public update(deltaTime: number, assemblies: Assembly[]): void {
        // Filter out non-destroyed, non-source assemblies for targeting
        const availableTargets = assemblies.filter(a => !a.destroyed);

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
    }

    public handleMissileHit(missile: Missile, targetEntity: any): void {
        // Prevent self-hits
        if (missile.sourceAssemblyId === targetEntity.body?.assembly?.id) {
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

    public cleanup(): void {
        // Remove all missiles
        this.missiles.forEach(missile => {
            Matter.World.remove(this.world, missile.body);
        });
        this.missiles = [];
    }
}
