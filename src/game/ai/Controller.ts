import { Assembly } from '../core/Assembly';
import { Vector2 } from '../../types/GameTypes';

// Control commands that can be sent to an assembly.
// Both player and AI use this same interface — all dampening, thrust, and
// rotation goes through ControllerManager.applyInput() for a single code path.
export interface ControlInput {
    thrust: Vector2;
    torque: number;
    fire: boolean;
    targetAngle?: number;
    /** When true, inertial dampening is applied this frame (linear velocity). */
    dampen?: boolean;
    /** Override the linear dampening multiplier (default 0.985). Lower = more aggressive braking. */
    dampenFactor?: number;
    /**
     * When set, dampening is applied axis-decomposed: lateral (sideways) velocity is
     * multiplied by this factor each frame, while forward velocity is multiplied by
     * dampenFactor (default 1.0 = untouched).  Allows forward momentum to be preserved
     * while aggressively killing orbit/drift.
     */
    lateralDampenFactor?: number;
    /**
     * When true, angular velocity is damped when no torque is applied.
     * Uses angularDampenFactor (default 0.98) to slow rotation each frame.
     */
    angularDampen?: boolean;
    /** Override the angular dampening multiplier (default 0.98). */
    angularDampenFactor?: number;
}

// Interface for any controller (AI or player)
export interface IController {
    update(deltaTime: number): ControlInput;
    setTarget(assembly: Assembly): void;
}

// Base controller class
export abstract class Controller implements IController {
    protected assembly: Assembly;

    constructor(assembly: Assembly) {
        this.assembly = assembly;
    }

    abstract update(deltaTime: number): ControlInput;
    abstract setTarget(assembly: Assembly): void;
}

// Player controller (responds to input)
export class PlayerController extends Controller {
    private currentInput: ControlInput = {
        thrust: { x: 0, y: 0 },
        torque: 0,
        fire: false
    };

    setInput(input: ControlInput): void {
        this.currentInput = input;
    }
    update(_deltaTime: number): ControlInput {
        return this.currentInput;
    }

    setTarget(_assembly: Assembly): void {
        // Player targeting is handled through input
    }
}
