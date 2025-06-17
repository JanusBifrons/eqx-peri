import { Assembly } from './Assembly';
import { Vector2 } from '../types/GameTypes';

// Control commands that can be sent to an assembly
export interface ControlInput {
    thrust: Vector2;
    torque: number;
    fire: boolean;
    targetAngle?: number;
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
