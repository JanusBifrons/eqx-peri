import { IRenderer } from './IRenderer';
import { Viewport } from './Viewport';
import { ParticleSystem } from '../systems/ParticleSystem';
import { Assembly } from '../core/Assembly';
import * as PIXI from 'pixi.js';

// emitThrust() now emits 3 particles per call, so 0.04/ms ≈ 40 calls/s = 120 particles/s per engine.
const THRUST_RATE = 0.04;
// Viewport margin in world units — emit thrust for engines slightly off-screen.
const THRUST_CULL_MARGIN = 300;

/**
 * IRenderer that drives the ParticleSystem each frame.
 *
 * Each frame:
 *   1. Emit thrust bursts for every visible thrusting engine entity.
 *      emitThrust() fires 3 particles per call (blob + streak + spark).
 *   2. Call particleSystem.update(deltaMs, viewport).
 *
 * Impact and explosion particles are emitted by GameEngine via the shared
 * particleSystem reference.
 */
export class ParticleRenderer implements IRenderer {
  readonly renderPriority = 22;

  private lastTimestamp: number = 0;

  constructor(
    readonly particleSystem: ParticleSystem,
    private readonly getAssemblies: () => Assembly[],
  ) {}

  init(stage: PIXI.Container): void {
    this.particleSystem.init(stage);
  }

  render(viewport: Viewport, timestamp: number): void {
    const rawDelta = this.lastTimestamp === 0 ? 16 : timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;
    const deltaMs = Math.min(rawDelta, 80); // cap to avoid burst on tab-refocus

    this.emitThrustParticles(viewport, deltaMs);
    this.particleSystem.update(deltaMs, viewport);
  }

  private emitThrustParticles(viewport: Viewport, deltaMs: number): void {
    const { bounds } = viewport;

    for (const assembly of this.getAssemblies()) {
      if (assembly.destroyed) continue;

      const shipAngle = assembly.rootBody.angle;
      const exhaustDirX = -Math.cos(shipAngle);
      const exhaustDirY = -Math.sin(shipAngle);

      // Matter.js velocity is world units per physics tick; scale to ~world units/ms
      const vel = assembly.rootBody.velocity;
      const shipVx = vel.x * 0.001;
      const shipVy = vel.y * 0.001;

      for (const entity of assembly.entities) {
        if (!entity.canProvideThrust()) continue;
        if (entity.thrustLevel < 0.05) continue;

        const { x: ex, y: ey } = entity.body.position;

        // Cull engines outside viewport + margin
        if (
          ex < bounds.min.x - THRUST_CULL_MARGIN ||
          ex > bounds.max.x + THRUST_CULL_MARGIN ||
          ey < bounds.min.y - THRUST_CULL_MARGIN ||
          ey > bounds.max.y + THRUST_CULL_MARGIN
        ) continue;

        // Probabilistic rate: THRUST_RATE × thrustLevel calls/ms, each emitting 3 particles
        const expected = THRUST_RATE * entity.thrustLevel * deltaMs;
        const calls = Math.floor(expected) + (Math.random() < (expected % 1) ? 1 : 0);

        for (let i = 0; i < calls; i++) {
          this.particleSystem.emitThrust(
            ex, ey,
            exhaustDirX, exhaustDirY,
            entity.thrustLevel,
            shipVx, shipVy,
          );
        }
      }
    }
  }
}
