import * as Matter from 'matter-js';
import { Assembly } from '../core/Assembly';
import { IController, ControlInput, PlayerController } from './Controller';
import { AIController } from './AIController';
import { MissileSystem } from '../weapons/MissileSystem';
import { BeamSystem } from '../weapons/BeamSystem';

// Manages all controllers and applies their inputs to assemblies
export class ControllerManager {    private controllers: Map<string, IController> = new Map();
    private playerController?: PlayerController;
    private missileSystem?: MissileSystem;
    private beamSystem?: BeamSystem;

    // Set the missile system reference
    setMissileSystem(missileSystem: MissileSystem): void {
        this.missileSystem = missileSystem;
    }

    // Set the beam system reference
    setBeamSystem(beamSystem: BeamSystem): void {
        this.beamSystem = beamSystem;
    }

    // Create an AI controller for an assembly
    createAIController(assembly: Assembly): AIController {
        const controller = new AIController(assembly);
        this.controllers.set(assembly.id, controller);
        return controller;
    }

    // Create a player controller for an assembly
    createPlayerController(assembly: Assembly): PlayerController {
        const controller = new PlayerController(assembly);
        this.controllers.set(assembly.id, controller);
        this.playerController = controller;
        assembly.isPlayerControlled = true;
        return controller;
    }

    // Remove controller for an assembly
    removeController(assemblyId: string): void {
        this.controllers.delete(assemblyId);
    }

    // Check if an assembly currently has any controller registered
    hasController(assemblyId: string): boolean {
        return this.controllers.has(assemblyId);
    }
    // Update all controllers and apply their inputs
    update(deltaTime: number, assemblies: Assembly[]): Matter.Body[] {
        // Update AI controllers with available targets
        this.updateAITargets(assemblies);

        const newLasers: Matter.Body[] = [];

        // Process all controller inputs and apply them
        for (const [assemblyId, controller] of this.controllers) {
            const assembly = assemblies.find(a => a.id === assemblyId);
            if (!assembly || assembly.destroyed) {
                this.controllers.delete(assemblyId);
                continue;
            }

            const input = controller.update(deltaTime);
            const lasers = this.applyInput(assembly, input, deltaTime, assemblies);
            newLasers.push(...lasers);
        }

        return newLasers;
    }    // Apply control input to an assembly
    private applyInput(assembly: Assembly, input: ControlInput, deltaTime: number, assemblies: Assembly[]): Matter.Body[] {
        if (assembly.destroyed) return []; const lasers: Matter.Body[] = [];

        // Debug logging disabled to reduce spam
        // const thrustMag = Math.sqrt(input.thrust.x * input.thrust.x + input.thrust.y * input.thrust.y);
        // if (thrustMag > 0 || Math.abs(input.torque) > 0) {
        //     console.log(`🎮 [${assembly.isPlayerControlled ? 'PLAYER' : 'AI'}] Control Input:`,
        //         `thrust=(${input.thrust.x.toFixed(3)}, ${input.thrust.y.toFixed(3)}, mag=${thrustMag.toFixed(3)})`,
        //         `torque=${input.torque.toFixed(3)}`);
        // }

        // Apply inertial dampening before thrust so corrections are additive on top.
        // When lateralDampenFactor is provided the velocity is decomposed into forward
        // and lateral axes: lateral (orbit-generating) velocity is damped aggressively
        // while forward velocity uses dampenFactor (default 1.0 = untouched).
        if (input.dampen) {
            const vel   = assembly.rootBody.velocity;
            const angle = assembly.rootBody.angle;

            if (input.lateralDampenFactor !== undefined) {
                const fwdX = Math.cos(angle);
                const fwdY = Math.sin(angle);
                const fwdSpeed = vel.x * fwdX + vel.y * fwdY;
                const latSpeed = vel.x * -fwdY + vel.y * fwdX;

                const fwdFactor = input.dampenFactor ?? 1.0;
                const latFactor = input.lateralDampenFactor;

                const newFwd = fwdSpeed * fwdFactor;
                const newLat = latSpeed * latFactor;
                Matter.Body.setVelocity(assembly.rootBody, {
                    x: newFwd * fwdX + newLat * -fwdY,
                    y: newFwd * fwdY + newLat *  fwdX,
                });
            } else {
                const factor = input.dampenFactor ?? 0.985;
                Matter.Body.setVelocity(assembly.rootBody, {
                    x: vel.x * factor,
                    y: vel.y * factor,
                });
            }
        }

        // Apply thrust (always call to ensure thrust levels are updated, even when 0)
        assembly.applyThrust(input.thrust);

        // Apply torque
        if (Math.abs(input.torque) > 0.1) {
            assembly.applyTorque(input.torque);
        }        // Fire weapons
        if (input.fire) {
            const newLasers = assembly.fireWeapons();
            lasers.push(...newLasers);

            // Also fire missiles
            if (this.missileSystem) {
                const missileRequests = assembly.getMissileLaunchRequests();
                missileRequests.forEach(request => {
                    this.missileSystem!.createMissile(
                        request.position,
                        request.angle,
                        request.missileType,
                        request.sourceAssemblyId,
                        request.targetAssembly
                    );
                });
            }

            // Fire beam weapons (continuous raycast, no physics bodies)
            if (this.beamSystem) {
                const beamFires = assembly.getBeamFires();
                beamFires.forEach(spec => {
                    this.beamSystem!.processBeamFire(spec, assemblies, deltaTime);
                });
            }
        }

        return lasers;
    }

    // Update AI controllers with available targets
    private updateAITargets(assemblies: Assembly[]): void {
        const activeAssemblies = assemblies.filter(a => !a.destroyed);

        for (const [assemblyId, controller] of this.controllers) {
            if (controller instanceof AIController) {
                const assembly = activeAssemblies.find(a => a.id === assemblyId);
                if (assembly) {
                    // Give AI all other assemblies as potential targets
                    const otherAssemblies = activeAssemblies.filter(a => a.id !== assemblyId);
                    controller.setAvailableTargets(otherAssemblies);
                }
            }
        }
    }

    // Get the player controller (for input handling)
    getPlayerController(): PlayerController | undefined {
        return this.playerController;
    }

    // Returns the human-readable combat state label for an AI-controlled assembly, or null.
    getAIStateLabelForAssembly(assemblyId: string): string | null {
        const controller = this.controllers.get(assemblyId);
        if (controller instanceof AIController) return controller.getCombatStateLabel();
        return null;
    }

    // Get all AI controllers
    getAIControllers(): AIController[] {
        const aiControllers: AIController[] = [];
        for (const controller of this.controllers.values()) {
            if (controller instanceof AIController) {
                aiControllers.push(controller);
            }
        }
        return aiControllers;
    }

    // Set input for player controller
    setPlayerInput(input: ControlInput): void {
        if (this.playerController) {
            this.playerController.setInput(input);
        }
    }
}
