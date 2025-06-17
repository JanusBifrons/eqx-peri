import * as Matter from 'matter-js';
import { Assembly } from './Assembly';
import { IController, ControlInput, PlayerController } from './Controller';
import { AIController } from './AIController_New';

// Manages all controllers and applies their inputs to assemblies
export class ControllerManager {
    private controllers: Map<string, IController> = new Map();
    private playerController?: PlayerController;

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
    // Update all controllers and apply their inputs
    update(deltaTime: number, assemblies: Assembly[]): Matter.Body[] {
        // Update AI controllers with available targets
        this.updateAITargets(assemblies);

        const newBullets: Matter.Body[] = [];

        // Process all controller inputs and apply them
        for (const [assemblyId, controller] of this.controllers) {
            const assembly = assemblies.find(a => a.id === assemblyId);
            if (!assembly || assembly.destroyed) {
                this.controllers.delete(assemblyId);
                continue;
            }

            const input = controller.update(deltaTime);
            const bullets = this.applyInput(assembly, input);
            newBullets.push(...bullets);
        }

        return newBullets;
    }
    // Apply control input to an assembly
    private applyInput(assembly: Assembly, input: ControlInput): Matter.Body[] {
        if (assembly.destroyed) return [];

        const bullets: Matter.Body[] = [];

        // Apply thrust
        if (input.thrust.x !== 0 || input.thrust.y !== 0) {
            assembly.applyThrust(input.thrust);
        }

        // Apply torque
        if (Math.abs(input.torque) > 0.1) {
            assembly.applyTorque(input.torque);
        }

        // Fire weapons
        if (input.fire) {
            const newBullets = assembly.fireWeapons(input.targetAngle);
            bullets.push(...newBullets);
        }

        return bullets;
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
