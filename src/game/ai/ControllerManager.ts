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
    private beamExtraBodies: Matter.Body[] = [];

    // Set the missile system reference
    setMissileSystem(missileSystem: MissileSystem): void {
        this.missileSystem = missileSystem;
    }

    // Set the beam system reference
    setBeamSystem(beamSystem: BeamSystem): void {
        this.beamSystem = beamSystem;
    }

    /** Set extra bodies (e.g., structures) that beams can hit. */
    setBeamExtraBodies(bodies: Matter.Body[]): void {
        this.beamExtraBodies = bodies;
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

        // Apply angular dampening when no torque input and angularDampen is set.
        // This is the shared code path for both player and AI rotational braking.
        if (input.angularDampen && Math.abs(input.torque) < 0.01) {
            const angVel = assembly.rootBody.angularVelocity;
            const angFactor = input.angularDampenFactor ?? 0.98;
            Matter.Body.setAngularVelocity(assembly.rootBody, angVel * angFactor);
        }

        // Apply thrust. For player-controlled ships with dedicated engines, rotation is
        // achieved by selectively firing engines on the appropriate side; applyThrust
        // returns true in that case so we skip the direct-angular-velocity applyTorque.
        const rotationHandledByEngines = assembly.applyThrust(input.thrust, input.torque);

        // Apply torque via direct angular-velocity manipulation only when engine-based
        // rotation was not used (cockpit-only ships, AI ships, or no qualifying engines).
        if (!rotationHandledByEngines && Math.abs(input.torque) > 0.1) {
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
                        request.sourceTeam,
                        request.targetAssembly
                    );
                });
            }

            // Fire beam weapons (continuous raycast, no physics bodies)
            if (this.beamSystem) {
                const beamFires = assembly.getBeamFires();
                beamFires.forEach(spec => {
                    this.beamSystem!.processBeamFire(spec, assemblies, deltaTime, this.beamExtraBodies);
                });
            }
        }

        return lasers;
    }

    // Update AI controllers with available targets, team power, and formation slots
    private updateAITargets(assemblies: Assembly[]): void {
        const activeAssemblies = assemblies.filter(a => !a.destroyed);

        // ── Compute team-level power totals for retreat coordination ──────
        const teamPower = new Map<number, number>();
        for (const a of activeAssemblies) {
            if (!a.hasControlCenter()) continue;
            const power = this.computeAssemblyCombatPower(a);
            teamPower.set(a.team, (teamPower.get(a.team) ?? 0) + power);
        }

        // ── Group friendly assemblies by team ────────────────────────────
        const teamMembers = new Map<number, Assembly[]>();
        for (const a of activeAssemblies) {
            if (!a.hasControlCenter()) continue;
            const list = teamMembers.get(a.team);
            if (list) list.push(a); else teamMembers.set(a.team, [a]);
        }

        // ── Collect all AI controllers and their targets for formation slots
        const aiEntries: { controller: AIController; assembly: Assembly }[] = [];

        for (const [assemblyId, controller] of this.controllers) {
            if (controller instanceof AIController) {
                const assembly = activeAssemblies.find(a => a.id === assemblyId);
                if (assembly) {
                    // Give AI all other assemblies as potential targets
                    const otherAssemblies = activeAssemblies.filter(a => a.id !== assemblyId);
                    controller.setAvailableTargets(otherAssemblies);

                    // Populate per-weapon independent targeting pool: enemy assemblies
                    // with a control center only (no loose debris).
                    assembly.availableTargets = otherAssemblies.filter(
                        a => a.team !== assembly.team && a.hasControlCenter()
                    );

                    // Pass friendly ships for separation steering
                    controller.setFriendlies(teamMembers.get(assembly.team) ?? []);

                    // Compute and pass team power ratio
                    const ownTeamPower = teamPower.get(assembly.team) ?? 0;
                    let enemyTeamPower = 0;
                    for (const [team, power] of teamPower) {
                        if (team !== assembly.team) enemyTeamPower += power;
                    }
                    const teamRatio = enemyTeamPower > 0 ? ownTeamPower / enemyTeamPower : 99;
                    controller.setTeamPowerRatio(teamRatio);

                    aiEntries.push({ controller, assembly });
                }
            }
        }

        // ── Assign formation slots: group friendlies by shared target ────
        // Ships targeting the same enemy get evenly-spaced slots around it.
        const targetGroups = new Map<string, { controller: AIController; assembly: Assembly }[]>();
        for (const entry of aiEntries) {
            const target = entry.controller.getTarget();
            if (target) {
                const key = target.id;
                const group = targetGroups.get(key);
                if (group) group.push(entry); else targetGroups.set(key, [entry]);
            }
        }
        for (const group of targetGroups.values()) {
            // Sort by assembly ID for stable slot assignment across frames
            group.sort((a, b) => a.assembly.id.localeCompare(b.assembly.id));
            for (let i = 0; i < group.length; i++) {
                group[i].controller.setFormationSlot(i, group.length);
            }
        }
    }

    /**
     * Estimates an assembly's combat power for team-level balance computation.
     * Mirrors the per-ship logic in AIController.computeCombatPower.
     */
    private computeAssemblyCombatPower(a: Assembly): number {
        let power = 0;
        for (const e of a.entities) {
            if (e.destroyed) continue;
            switch (e.type) {
                case 'Gun':                    power += 1.0; break;
                case 'LargeGun':               power += 2.5; break;
                case 'CapitalWeapon':          power += 5.0; break;
                case 'MissileLauncher':        power += 1.5; break;
                case 'LargeMissileLauncher':   power += 3.5; break;
                case 'CapitalMissileLauncher': power += 7.0; break;
                case 'Beam':                   power += 1.5; break;
                case 'LargeBeam':              power += 4.0; break;
                case 'Cockpit':                power += 0.5; break;
                case 'LargeCockpit':           power += 1.0; break;
                case 'CapitalCore':            power += 2.0; break;
                default: break;
            }
        }
        const cur = a.entities.reduce((s, e) => s + e.health, 0);
        const max = a.entities.reduce((s, e) => s + e.maxHealth, 0);
        const healthRatio = max > 0 ? cur / max : 0;
        return power * healthRatio;
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

    /** Returns the AIController for a specific assembly, or null if none. */
    getAIControllerForAssembly(assemblyId: string): AIController | null {
        const controller = this.controllers.get(assemblyId);
        return controller instanceof AIController ? controller : null;
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
