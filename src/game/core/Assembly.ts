import * as Matter from 'matter-js';
import { Entity } from './Entity';
import { EntityConfig, Vector2, EntityType, ENTITY_DEFINITIONS, ShieldState, SHIELD_REGEN_DELAY_MS, SHIELD_REGEN_DURATION_MS, SHIELD_COLLAPSE_COOLDOWN_MS, getEntityOccupiedGridCells, getEntityBodyOffset, getBlockedConnectionDirs, canTypesConnect } from '../../types/GameTypes';
import { MissileType } from '../weapons/Missile';

// Interface for missile launch requests
export interface MissileLaunchRequest {
  position: Vector2;
  angle: number;
  missileType: MissileType;
  sourceAssemblyId: string;
  sourceTeam: number;
  targetAssembly?: Assembly;
}

// Interface for beam fire requests (continuous raycast weapons)
export interface BeamFireSpec {
  weaponId: string;
  origin: Vector2;
  angle: number;
  maxRange: number;
  damagePerSecond: number;
  sourceAssemblyId: string;
  weaponType: EntityType;
}

// All engines start at this fraction of full thrust when the balanced system is active.
// The remaining headroom (up to 1.0) is used to correct torque imbalance or add rotation bias.
const BASE_THRUST_LEVEL = 0.5;

// Fraction of the maximum achievable one-sided torque applied at full rotationInput during
// combined thrust + rotation (W+A / W+D). Lower = gentler banking turn.
const ROTATION_TORQUE_BLEND = 0.6;

// Minimum torque-arm magnitude (ship-local pixels) for an engine to participate in torque
// correction. Engines within this band of the thrust axis are treated as on-centre.
// Half a grid cell (GRID_SIZE = 16).
const BALANCE_MIN_TORQUE_ARM = 8;

// Minimum dot product between an engine's ship-local thrust direction and the requested
// thrust input for the engine to fire.  Engines perpendicular or opposed are silenced.
const ENGINE_ALIGNMENT_THRESHOLD = 0.01;

/**
 * Compute an engine's ship-local thrust direction from its construction-time rotation.
 * An engine "faces" the direction given by its rotation; its thrust is opposite that.
 *   rotation 180 (faces west / backward)  → thrust east  (forward)  = ( 1,  0)
 *   rotation 0   (faces east / forward)   → thrust west  (backward) = (-1,  0)
 *   rotation 90  (faces south)            → thrust north            = ( 0, -1)
 *   rotation 270 (faces north)            → thrust south            = ( 0,  1)
 */
function getEngineLocalThrustDir(engineRotationDeg: number): Vector2 {
  const rad = (engineRotationDeg * Math.PI) / 180;
  return { x: -Math.cos(rad), y: -Math.sin(rad) };
}

export class Assembly {
  public id: string;
  public rootBody: Matter.Body;
  public entities: Entity[] = [];
  public shipName: string = 'Unknown Ship'; public isPlayerControlled: boolean = false;
  public destroyed: boolean = false;
  /** Set by createFreshBody() so GameEngine can swap the old compound out of the physics world. */
  public pendingBodySwap: { oldBody: Matter.Body } | null = null;
  public lastFireTime: number = 0;
  public lastMissileFireTime: number = 0; // Separate timing for missiles
  public fireRate: number = 300;
  public team: number = 0;

  // Targeting system properties
  public primaryTarget: Assembly | null = null;
  public cursorPosition: Vector2 | null = null;

  /**
   * Enemy assemblies available for per-weapon independent targeting.
   * Set each frame by ControllerManager for AI-controlled ships.
   * When non-empty, each weapon independently selects the best entity body
   * to aim at rather than all weapons sharing the primaryTarget COM.
   */
  public availableTargets: Assembly[] = [];

  /**
   * Per-weapon target positions computed each frame by updateWeaponAiming().
   * Keyed by weapon entity ID. Used by AIController to check fire readiness
   * without relying on a single shared target position.
   */
  public weaponTargetPositions: Map<string, Vector2> = new Map();

  // Kill tracking properties
  public lastHitByPlayer: boolean = false;
  public lastHitByAssemblyId: string | null = null;

  // Shield field state — null when the assembly has no shield blocks
  public shieldState: ShieldState | null = null;

  constructor(entityConfigs: EntityConfig[], position: Vector2 = { x: 0, y: 0 }) {
    this.id = Math.random().toString(36).substr(2, 9);

    // Create entities
    this.entities = entityConfigs.map(config => new Entity(config));

    // Build connection graph between entities
    this.buildConnectionGraph();

    // Initialize shield state before body creation so hasActiveShield() is accurate
    // when deciding whether to include the physical shield circle in the compound.
    this.shieldState = this.initializeShieldState();

    // Calculate expected total mass
    const expectedTotalMass = this.entities.reduce((sum, e) => sum + e.body.mass, 0);

    // Build parts list — include one shield circle per active shield entity.
    const constructorParts: Matter.Body[] = this.entities.map(e => e.body);
    if (this.hasActiveShield()) {
      for (const entity of this.entities) {
        if ((entity.type !== 'Shield' && entity.type !== 'LargeShield') || entity.destroyed) continue;
        const def = ENTITY_DEFINITIONS[entity.type];
        const radius = def.shieldRadius ?? 80;
        const offset = getEntityBodyOffset(entity.type, entity.rotation);
        const cx = entity.localOffset.x + offset.x;
        const cy = entity.localOffset.y + offset.y;
        const shieldCircle = Matter.Bodies.circle(cx, cy, radius, {
          density: 0.000001,
          restitution: 0.3,
          frictionAir: 0,
          friction: 0,
          render: { visible: false },
        });
        (shieldCircle as any).isShieldPart = true;
        (shieldCircle as any).parentAssembly = this;
        constructorParts.push(shieldCircle);
      }
    }

    // Create root body with realistic physics settings
    this.rootBody = Matter.Body.create({
      parts: constructorParts,
      isStatic: false,
      frictionAir: 0,
      friction: 0,
      restitution: 0.2
    });

    if (Math.abs(this.rootBody.mass - expectedTotalMass) > 0.1) {
      console.warn(`⚠️ Mass mismatch! Matter.js mass: ${this.rootBody.mass}, calculated: ${expectedTotalMass} `);
    }

    // Set position
    Matter.Body.setPosition(this.rootBody, position);
    this.rootBody.assembly = this;

    this.entities.forEach(entity => {
      entity.body.assembly = this;
    });
  }
  public update(deltaTimeMs: number = 16): void {
    if (this.destroyed) return;

    // Update visual effects for ALL entities (including destroyed ones that are still flashing)
    // This allows destroyed entities to complete their flash animation before being removed
    this.entities.forEach(entity => {
      entity.updateVisualEffects(deltaTimeMs);
    });

    // Tick shield field regen/cooldown
    this.updateShield(deltaTimeMs);

    // Check if we still have a control center
    const hasControlCenter = this.entities.some(e => e.isControlCenter());

    // Remove destroyed entities and rebuild if needed
    const activeEntities = this.entities.filter(e => !e.destroyed);if (activeEntities.length !== this.entities.length) {
      // Some entities were destroyed - we need to rebuild completely
      this.entities = activeEntities;

      if (this.entities.length === 0) {
        this.destroy();
        return;
      }

      // Recreate the body completely with remaining entities
      this.createFreshBody();
    }

    // If no control center and this was player controlled, find new player ship
    if (this.isPlayerControlled && !hasControlCenter) {
      this.isPlayerControlled = false;
    }
  }

  /**
   * Returns true if this assembly has at least one dedicated engine block (Engine, LargeEngine,
   * CapitalEngine). Used to determine whether rotation should be achieved via engine selection
   * or via direct angular velocity (applyTorque) for cockpit-only ships.
   */
  public hasDedicatedEngines(): boolean {
    return this.entities.some(
      e => (e.type === 'Engine' || e.type === 'LargeEngine' || e.type === 'CapitalEngine') && !e.destroyed
    );
  }

  /**
   * Apply thrust to the assembly. When rotationInput is provided AND this is a player-controlled
   * ship with dedicated engines, only the engines on the side that produces the desired rotation
   * direction are fired (engine-based rotation). Returns true if rotation was handled by engine
   * selection (caller should skip applyTorque); false otherwise.
   *
   * Physics: torque from an engine at ship-local Y position ey = -F * ey.
   *   ey > 0 (bottom wing, Y+) → negative torque → CCW → left (A key, rotationInput < 0)
   *   ey < 0 (top wing, Y-)   → positive torque → CW  → right (D key, rotationInput > 0)
   *
   * Special case: cockpit-only ships (no dedicated engines) always use applyTorque (returns false).
   */
  public applyThrust(thrustInput: Vector2, rotationInput: number = 0): boolean {
    if (this.destroyed) return false;

    const engines = this.entities.filter(e => e.canProvideThrust());
    if (engines.length === 0) return false;

    const thrustMagnitude = Math.sqrt(thrustInput.x * thrustInput.x + thrustInput.y * thrustInput.y);

    // Pure-rotation path: only when there is no forward/lateral thrust, so the player is
    // exclusively steering (A / D keys). Fires only the engines on the correct side.
    // When thrust is also requested (W+A), the balanced thrust path handles turning instead.
    const isPureRotation = this.isPlayerControlled
      && thrustMagnitude < 0.1
      && Math.abs(rotationInput) > 0.1
      && this.hasDedicatedEngines();

    if (isPureRotation) {
      // Compute each engine's ship-local Y relative to the assembly COM by unrotating
      // the world-space offset. This gives the actual torque arm length.
      const com = this.rootBody.position;
      const angle = this.rootBody.angle;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      // Minimum offset (pixels) for an engine to be considered "off-centre" enough to
      // contribute meaningfully to rotation. Engines within this band are skipped.
      const OFF_CENTRE_THRESHOLD = 8; // half a grid unit (GRID_SIZE = 16)

      const correctSideEngines = engines.filter(engine => {
        // Only consider forward-facing engines for pure rotation (their positional
        // offset from the COM creates the torque).  Retro-thrusters pointing backward
        // would push the ship the wrong way.
        const thrustDir = getEngineLocalThrustDir(engine.rotation);
        if (thrustDir.x < ENGINE_ALIGNMENT_THRESHOLD) return false;

        const dx = engine.body.position.x - com.x;
        const dy = engine.body.position.y - com.y;
        // Ship-local Y = rotate world-offset by -shipAngle: local_y = -dx*sinA + dy*cosA
        const localY = -dx * sinA + dy * cosA;
        if (rotationInput < 0) {
          // CCW / left (A key): fire engines with positive local Y (bottom wing → Y+)
          return localY > OFF_CENTRE_THRESHOLD;
        } else {
          // CW / right (D key): fire engines with negative local Y (top wing → Y-)
          return localY < -OFF_CENTRE_THRESHOLD;
        }
      });

      if (correctSideEngines.length > 0) {
        // When only rotating (no forward thrust requested), still fire at rotation magnitude
        // so the ship actually turns. This creates a realistic arc — the ship rotates AND
        // drifts forward slightly (a deliberate tradeoff).
        const effectiveMagnitude = Math.max(thrustMagnitude, Math.abs(rotationInput));
        const shipAngle = this.rootBody.angle;

        engines.forEach(engine => {
          const isCorrectSide = correctSideEngines.includes(engine);
          if (isCorrectSide) {
            const engineThrust = this.getEngineThrust(engine.type);
            // Always thrust in the ship-forward direction; the positional offset
            // generates torque automatically via Matter.js.
            const worldForce = {
              x: effectiveMagnitude * engineThrust * Math.cos(shipAngle),
              y: effectiveMagnitude * engineThrust * Math.sin(shipAngle)
            };
            engine.setThrustLevel(effectiveMagnitude);
            Matter.Body.applyForce(this.rootBody, engine.body.position, worldForce);
          } else {
            // Opposite-side engines are silent while rotating
            engine.setThrustLevel(0);
          }
        });

        return true; // rotation handled — caller should skip applyTorque
      }
      // No engines on the correct side: fall through to normal thrust + let caller use applyTorque
    }

    // ── Thrust path ──────────────────────────────────────────────────────────
    if (thrustMagnitude < 0.0001) {
      engines.forEach(engine => engine.setThrustLevel(0));
      return false;
    }

    // ── Filter engines by facing direction ────────────────────────────────
    // Only engines whose thrust direction has a component aligned with the
    // requested thrustInput should fire.  Retro-thrusters, lateral thrusters,
    // etc. stay silent when their thrust opposes the movement direction.
    const alignedEngines = engines.filter(engine => {
      const dir = getEngineLocalThrustDir(engine.rotation);
      const dot = dir.x * thrustInput.x + dir.y * thrustInput.y;
      return dot > ENGINE_ALIGNMENT_THRESHOLD;
    });

    // Silence non-aligned engines (important for particle emission)
    engines.forEach(engine => {
      if (!alignedEngines.includes(engine)) {
        engine.setThrustLevel(0);
      }
    });

    if (alignedEngines.length === 0) return false;

    // Player ships with dedicated engines: dynamic torque-balanced thrust.
    // Aligned engines start at BASE_THRUST_LEVEL (50 %); individual engines are boosted
    // up to 100 % to cancel natural torque imbalance and to add intentional turning bias.
    if (this.isPlayerControlled && this.hasDedicatedEngines()) {
      const powerEfficiency = 1.0;
      return this.applyBalancedThrust(alignedEngines, thrustInput, thrustMagnitude, rotationInput, powerEfficiency);
    }

    // Uniform thrust for AI ships and cockpit-only ships (original algorithm).
    alignedEngines.forEach((engine) => {
      const engineThrust = this.getEngineThrust(engine.type);

      engine.setThrustLevel(thrustMagnitude);

      const shipAngle = this.rootBody.angle;
      const worldForce = {
        x: (thrustInput.x * engineThrust) * Math.cos(shipAngle) - (thrustInput.y * engineThrust) * Math.sin(shipAngle),
        y: (thrustInput.x * engineThrust) * Math.sin(shipAngle) + (thrustInput.y * engineThrust) * Math.cos(shipAngle)
      };
      Matter.Body.applyForce(this.rootBody, engine.body.position, worldForce);
    });

    return false;
  }

  private getEngineThrust(engineType: string): number {
    // Get thrust from engine part definition
    const definition = ENTITY_DEFINITIONS[engineType as EntityType];
    if (definition && definition.thrust) {
      return definition.thrust;
    }
    return 0;
  }

  /**
   * Dynamic torque-balanced thrust for player ships with dedicated engines.
   *
   * All engines start at BASE_THRUST_LEVEL (50 %).  Per-engine levels are then
   * boosted up to 1.0 to achieve two goals in priority order:
   *
   *   1. Auto-balance: counteract unwanted torque from asymmetric engine placement.
   *      Example: 2 engines on one side, 1 on the other → the lone engine is boosted to
   *      equalise the torque moment; if full equalisation is impossible the ship still
   *      drifts, but less than it would without any compensation.
   *
   *   2. Rotation bias: when rotationInput is non-zero (W+A / W+D), the target torque is
   *      offset proportionally, giving a controlled banking turn rather than a pure spin.
   *
   * Physics:
   *   The torque produced by engine i at unit thrust is:
   *     arm_i  = −thrustDir.x × localY_i  +  thrustDir.y × localX_i
   *   At BASE_THRUST_LEVEL:
   *     baseTorque = Σ( T_i × BASE_LEVEL × arm_i )
   *   Target:
   *     targetTorque = rotationInput × maxTorqueMoment × ROTATION_TORQUE_BLEND
   *   Deficit = targetTorque − baseTorque is covered by boosting engines whose arm
   *   has the same sign as the deficit, proportionally up to their maximum headroom.
   *
   * Returns true when the engine differential generates rotation (suppresses applyTorque).
   */
  private applyBalancedThrust(
    engines: Entity[],
    thrustInput: Vector2,
    thrustMagnitude: number,
    rotationInput: number,
    powerEfficiency: number
  ): boolean {
    const com = this.rootBody.position;
    const angle = this.rootBody.angle;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Normalise thrust direction for torque-arm calculation (magnitude is applied separately).
    const invMag = 1 / thrustMagnitude;
    const thrustDirX = thrustInput.x * invMag;
    const thrustDirY = thrustInput.y * invMag;

    interface EngineInfo {
      engine: Entity;
      baseThrust: number; // definition thrust × power efficiency
      torqueArm: number;  // signed: positive ≡ CW torque contribution per unit thrust
    }

    const infos: EngineInfo[] = engines.map(engine => {
      const dx = engine.body.position.x - com.x;
      const dy = engine.body.position.y - com.y;
      // Ship-local coordinates (rotate world offset by −shipAngle)
      const localX = dx * cosA + dy * sinA;
      const localY = -dx * sinA + dy * cosA;
      // Torque arm in the requested thrust direction
      // τ_i = T_i × level_i × arm_i  (positive → CW)
      const torqueArm = -thrustDirX * localY + thrustDirY * localX;
      return { engine, baseThrust: this.getEngineThrust(engine.type) * powerEfficiency, torqueArm };
    });

    // Torque at BASE_THRUST_LEVEL from all engines
    const baseTorque = infos.reduce((sum, ei) => sum + ei.baseThrust * BASE_THRUST_LEVEL * ei.torqueArm, 0);

    // Maximum additional torque achievable by boosting each engine from BASE to 1.0
    const maxTorqueMoment = infos.reduce(
      (sum, ei) => sum + ei.baseThrust * (1.0 - BASE_THRUST_LEVEL) * Math.abs(ei.torqueArm), 0
    );

    // Target torque: zero = pure balance; biased when the player requests rotation.
    // ROTATION_TORQUE_BLEND fraction of maxTorqueMoment is the ceiling for intentional turning.
    const targetTorque = rotationInput * maxTorqueMoment * ROTATION_TORQUE_BLEND;
    const deficit = targetTorque - baseTorque;

    // Per-engine thrust levels (start at BASE, boosted as needed)
    const levels = new Map<Entity, number>(engines.map(e => [e, BASE_THRUST_LEVEL]));
    let torqueApplied = false;

    if (Math.abs(deficit) > 0.001) {
      // Engines that can contribute torque in the deficit direction
      const helpful = infos.filter(ei => {
        if (Math.abs(ei.torqueArm) < BALANCE_MIN_TORQUE_ARM) return false;
        return deficit > 0 ? ei.torqueArm > 0 : ei.torqueArm < 0;
      });

      // Total headroom available from helpful engines (their extra torque potential)
      const potential = helpful.reduce(
        (sum, ei) => sum + ei.baseThrust * (1.0 - BASE_THRUST_LEVEL) * Math.abs(ei.torqueArm), 0
      );

      if (potential > 0) {
        // How much of the headroom to use (clamped so levels stay ≤ 1.0)
        const coverageRatio = Math.min(1.0, Math.abs(deficit) / potential);
        helpful.forEach(ei => {
          levels.set(ei.engine, BASE_THRUST_LEVEL + coverageRatio * (1.0 - BASE_THRUST_LEVEL));
        });
        torqueApplied = coverageRatio > 0.05;
      }
    }

    // Apply forces at each engine's world position
    infos.forEach(ei => {
      const level = levels.get(ei.engine) ?? BASE_THRUST_LEVEL;
      const effectiveThrust = ei.baseThrust * level;

      // setThrustLevel drives particle emission intensity (0–1)
      ei.engine.setThrustLevel(level * thrustMagnitude);

      const worldForce = {
        x: (thrustInput.x * effectiveThrust) * cosA - (thrustInput.y * effectiveThrust) * sinA,
        y: (thrustInput.x * effectiveThrust) * sinA + (thrustInput.y * effectiveThrust) * cosA
      };
      Matter.Body.applyForce(this.rootBody, ei.engine.body.position, worldForce);
    });

    // Suppress applyTorque when the engine differential is handling rotation
    return torqueApplied && Math.abs(rotationInput) > 0.1;
  }

  public applyTorque(torqueInput: number): void {
    if (this.destroyed) return;

    // More consistent rotation using Matter.js angular velocity.
    // Turn rate scales inversely with ship mass so heavy ships are sluggish and
    // light scouts are nimble.  BASE_ANGULAR_VELOCITY applies at REFERENCE_MASS;
    // the exponent 0.45 gives a gentle power-law curve (not linear, not square-root).
    const BASE_ANGULAR_VELOCITY = 0.020; // rad/frame at reference mass (≈68 deg/s at 60 Hz)
    const REFERENCE_MASS = 500;          // Single cockpit — lightest flyable ship
    const massScale = Math.min(1.0, Math.pow(REFERENCE_MASS / this.rootBody.mass, 0.45));
    const maxAngularVelocity = BASE_ANGULAR_VELOCITY * massScale;

    const currentAngularVelocity = this.rootBody.angularVelocity;

    // Clamp torque input to prevent over-steering
    const clampedTorque = Math.max(-1.0, Math.min(1.0, torqueInput));

    const desiredAngularVelocity = clampedTorque * maxAngularVelocity;
    const dampening = 0.2;

    const newAngularVelocity = currentAngularVelocity +
      (desiredAngularVelocity - currentAngularVelocity) * dampening;

    Matter.Body.setAngularVelocity(this.rootBody, newAngularVelocity);
  }

  /**
   * Compute weapon power efficiency (0–1) for AI-controlled assemblies.
   *
   * Power budget = power cells + cockpit backup power (same values as PowerSystem).
   * Efficiency = min(1, budget / weaponCount). If the ship has more weapons than
   * power, efficiency drops below 1 and the fire rate slows accordingly. If the
   * budget reaches 0 the ship cannot fire at all, matching the player experience.
   */
  /** Total thrust output from all live engine entities. */
  public getTotalThrust(): number {
    return this.entities
      .filter(e => !e.destroyed)
      .reduce((sum, e) => {
        const def = ENTITY_DEFINITIONS[e.type];
        return sum + (def.thrust ?? 0);
      }, 0);
  }

  /** Power efficiency (0–1) based on on-board power budget vs weapon count. */
  public getPowerEfficiency(): number {
    return this.computeAIWeaponPowerEfficiency();
  }

  /** Current speed in world units per physics tick. */
  public getCurrentSpeed(): number {
    const v = this.rootBody.velocity;
    return Math.sqrt(v.x * v.x + v.y * v.y);
  }

  private computeAIWeaponPowerEfficiency(): number {
    const live = this.entities.filter(e => !e.destroyed);

    let budget = 0;
    live.forEach(e => {
      if (e.type === 'PowerCell' || e.type === 'LargePowerCell' || e.type === 'PowerReactor') {
        budget += 1;
      } else if (e.type === 'Cockpit') {
        budget += 2; // Matches PowerSystem cockpit backup power values
      } else if (e.type === 'LargeCockpit') {
        budget += 4;
      } else if (e.type === 'CapitalCore') {
        budget += 8;
      }
    });

    const weaponCount = live.filter(e => e.canFire()).length;
    if (weaponCount === 0) return 1.0; // No weapons — efficiency irrelevant
    if (budget === 0) return 0;
    return Math.min(1.0, budget / weaponCount);
  }

  public fireWeapons(): Matter.Body[] {
    if (this.destroyed) return [];

    // All ships compute weapon power from on-board power cells.
    // Destroying power cells degrades firing rate.
    const weaponEfficiency = this.computeAIWeaponPowerEfficiency();
    if (weaponEfficiency === 0) return [];

    const currentTime = Date.now();

    // More power = faster firing (lower fire rate delay).
    // At 0% efficiency: fireRate × 3 (much slower); at 100%: fireRate × 1 (normal).
    const effectiveFireRate = this.fireRate * (3 - 2 * weaponEfficiency);

    // Enforce firing rate limit
    if (currentTime - this.lastFireTime < effectiveFireRate) {
      return []; // Can't fire yet, return empty array
    } const weapons = this.entities.filter(e => e.canFire() && !e.isMissileLauncher() && !e.isBeamWeapon());
    const lasers: Matter.Body[] = [];

    weapons.forEach(weapon => {
      // Trigger visual firing effect
      weapon.triggerWeaponFire();

      // Fire using the weapon's current (smoothly interpolated) aiming angle
      const currentFiringAngle = weapon.getCurrentFiringAngle(this.rootBody.angle);
      const laser = this.createLaser(weapon, currentFiringAngle);
      if (laser) {
        lasers.push(laser);
      }
    });

    // Update last fire time to current time
    this.lastFireTime = currentTime;

    return lasers;
  }  public getMissileLaunchRequests(): MissileLaunchRequest[] {
    if (this.destroyed) return [];

    const weaponEfficiency = this.computeAIWeaponPowerEfficiency();
    if (weaponEfficiency === 0) return [];

    const currentTime = Date.now();
    const effectiveFireRate = this.fireRate * (3 - 2 * weaponEfficiency);

    // Enforce firing rate limit - Use separate lastMissileFireTime to avoid conflicts with regular weapons
    if (!this.lastMissileFireTime) {
      this.lastMissileFireTime = 0;
    }
    
    if (currentTime - this.lastMissileFireTime < effectiveFireRate) {
      return [];
    }

    const missileLaunchers = this.entities.filter(e => e.isMissileLauncher() && e.canFire());
    const missileRequests: MissileLaunchRequest[] = [];

    missileLaunchers.forEach(launcher => {
      // Trigger visual firing effect
      launcher.triggerWeaponFire();

      const currentFiringAngle = launcher.getCurrentFiringAngle(this.rootBody.angle);

      // Determine missile type based on launcher type
      let missileType: MissileType;
      switch (launcher.type) {
        case 'MissileLauncher':
          missileType = MissileType.HEAT_SEEKER; // Default to heat seekers for small launchers
          break;
        case 'LargeMissileLauncher':
          missileType = MissileType.GUIDED; // Guided missiles for large launchers
          break;
        case 'CapitalMissileLauncher':
          missileType = MissileType.TORPEDO; // Heavy torpedoes for capital launchers
          break;
        default:
          missileType = MissileType.HEAT_SEEKER;
      }

      // If we have a primary target and it's a guided missile, use it
      const targetAssembly = (missileType === MissileType.GUIDED && this.primaryTarget && !this.primaryTarget.destroyed)
        ? this.primaryTarget
        : undefined;      missileRequests.push({
        position: launcher.getMuzzlePosition(this.rootBody.angle),
        angle: currentFiringAngle,
        missileType,
        sourceAssemblyId: this.id,
        sourceTeam: this.team,
        targetAssembly
      });
    });    // Update missile fire time if we have requests
    if (missileRequests.length > 0) {
      this.lastMissileFireTime = currentTime;
    }

    return missileRequests;
  }

  /**
   * Returns beam fire specs for all live beam weapons this tick.
   * Unlike projectile weapons, beams have no fire-rate limit — they fire every tick
   * the trigger is held; damage is already scaled by deltaTime in BeamSystem.
   */
  public getBeamFires(): BeamFireSpec[] {
    if (this.destroyed) return [];

    if (this.computeAIWeaponPowerEfficiency() === 0) return [];

    const beamWeapons = this.entities.filter(e => e.isBeamWeapon() && !e.destroyed);
    const specs: BeamFireSpec[] = [];

    beamWeapons.forEach(weapon => {
      weapon.triggerWeaponFire();
      const firingAngle = weapon.getCurrentFiringAngle(this.rootBody.angle);
      const muzzlePos = weapon.getMuzzlePosition(this.rootBody.angle);
      const def = ENTITY_DEFINITIONS[weapon.type];

      specs.push({
        weaponId: weapon.id,
        origin: muzzlePos,
        angle: firingAngle,
        maxRange: def.beamRange ?? 400,
        damagePerSecond: def.beamDps ?? 30,
        sourceAssemblyId: this.id,
        weaponType: weapon.type,
      });
    });

    return specs;
  }

  public canWeaponAimAtTarget(weapon: Entity, targetPosition: Vector2): boolean {
    const weaponAngle = this.calculateWeaponAimAngle(weapon, targetPosition);
    const weaponNaturalAngle = this.rootBody.angle + (weapon.rotation * Math.PI / 180);

    // Normalize angle difference
    let angleDiff = weaponAngle - weaponNaturalAngle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    // Check if target is within weapon's aiming arc
    const aimingArc = this.getWeaponAimingArc(weapon.type);
    return Math.abs(angleDiff) <= aimingArc / 2;
  }

  public calculateWeaponAimAngle(weapon: Entity, targetPosition: Vector2): number {
    const weaponWorldPos = weapon.body.position;
    return Math.atan2(
      targetPosition.y - weaponWorldPos.y,
      targetPosition.x - weaponWorldPos.x
    );
  }
  public getWeaponAimingArc(weaponType: string): number {
    // Return aiming arc in radians - significantly widened for debugging
    switch (weaponType) {
      case 'Gun':
      case 'Cockpit':
      case 'Beam':
        return Math.PI; // 180 degrees total arc (90 degrees each side)
      case 'LargeGun':
      case 'LargeCockpit':
      case 'LargeBeam':
        return Math.PI * 1.2; // 216 degrees total arc
      case 'CapitalWeapon':
      case 'CapitalCore':
        return Math.PI * 1.5; // 270 degrees total arc
      default:
        return Math.PI; // Default 180 degrees
    }
  } private createLaser(weapon: Entity, targetAngle?: number): Matter.Body | null {
    const assemblyAngle = this.rootBody.angle;
    const weaponLocalAngle = weapon.rotation * Math.PI / 180;

    let firingAngle: number;

    if (targetAngle !== undefined) {
      // Use target angle but apply aiming arc constraints
      const weaponNaturalAngle = assemblyAngle + weaponLocalAngle;
      let angleDiff = targetAngle - weaponNaturalAngle;

      // Normalize angle difference
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      // Clamp angle difference to weapon's aiming arc
      const aimingArc = this.getWeaponAimingArc(weapon.type);
      const maxAngleDiff = aimingArc / 2;
      angleDiff = Math.max(-maxAngleDiff, Math.min(maxAngleDiff, angleDiff));

      firingAngle = weaponNaturalAngle + angleDiff;
    } else {
      // Use weapon's natural direction
      firingAngle = assemblyAngle + weaponLocalAngle;
    }

    // Configure laser properties based on weapon type
    let laserSpeed = 50; // Base speed in units per physics tick
    let laserHeight = 4; // Thickness of the laser
    let laserColor = '#00ffff'; // Default cyan

    switch (weapon.type) {
      case 'Gun':
        laserSpeed = 50;
        break;
      case 'LargeGun':
        laserSpeed = 60;
        laserHeight = 6;
        laserColor = '#ff6600'; // Orange for large guns
        break;
      case 'CapitalWeapon':
        laserSpeed = 70;
        laserHeight = 10;
        laserColor = '#ff0000'; // Red for capital weapons
        break;
    }

    // TUNNELING PREVENTION: Calculate laser length to cover travel distance per tick
    // Matter.js velocity is in units per tick, so a laser with speed 50 moves 50 units per tick.
    // The laser must be at least as long as its speed to prevent passing through thin targets.
    // We add 50% buffer and account for ship velocity inheritance.
    const shipVelocity = this.rootBody.velocity;
    const totalSpeed = Math.sqrt(
      Math.pow(Math.cos(firingAngle) * laserSpeed + shipVelocity.x, 2) +
      Math.pow(Math.sin(firingAngle) * laserSpeed + shipVelocity.y, 2)
    );
    // Laser length = 1.5x the distance traveled per tick, minimum 30 units
    const laserWidth = Math.max(totalSpeed * 1.5, 30);

    // Spawn from the weapon's front-face center (muzzle), then offset by half the laser length
    // so the laser's back edge starts exactly at the muzzle rather than overlapping the block.
    const muzzlePos = weapon.getMuzzlePosition(this.rootBody.angle);
    const spawnX = muzzlePos.x + Math.cos(firingAngle) * (laserWidth / 2);
    const spawnY = muzzlePos.y + Math.sin(firingAngle) * (laserWidth / 2);

    // Create rectangular laser body with CCD enabled via bullet option
    const laser = Matter.Bodies.rectangle(spawnX, spawnY, laserWidth, laserHeight, {
      isSensor: true, // Lasers are sensors - they pass through objects but trigger collision events
      frictionAir: 0, // No air resistance in space
      // Enable Matter.js Continuous Collision Detection for high-speed bodies
      // This makes the physics engine check for collisions along the movement path
      // @ts-expect-error - bullet is a valid Matter.js option but not in the TypeScript definitions
      bullet: true,
      collisionFilter: {
        category: 0x0002, // Laser category
        mask: 0x0001 // Only collides with default category (not with other lasers or same assembly)
      },
      render: {
        fillStyle: laserColor,
        strokeStyle: '#ffffff',
        lineWidth: 1
      }
    });

    // Rotate the laser to match the firing direction
    Matter.Body.rotate(laser, firingAngle);

    // Set laser velocity using the firing angle, inheriting ship's velocity
    const velocity = {
      x: Math.cos(firingAngle) * laserSpeed + shipVelocity.x,
      y: Math.sin(firingAngle) * laserSpeed + shipVelocity.y
    };

    Matter.Body.setVelocity(laser, velocity);

    // Mark as laser for collision detection and store the source assembly ID
    // TTL derived from weapon range: range / speed gives ticks, × 1000/60 converts to ms.
    // Add 20% buffer so the bolt travels slightly past its effective range.
    const def = ENTITY_DEFINITIONS[weapon.type];
    const effectiveRange = def.weaponRange ?? 500;
    const ttlMs = (effectiveRange / laserSpeed) * (1000 / 60) * 1.2;
    laser.isLaser = true;
    laser.timeToLive = Date.now() + ttlMs;
    (laser as any).sourceAssemblyId = this.id; // Store which assembly fired this laser

    return laser;
  }  public removeEntity(entity: Entity): Assembly[] {
    const entityIndex = this.entities.findIndex(e => e.id === entity.id);
    if (entityIndex === -1) {
      return [this];
    }

    // Store current physics state before destroying
    const currentVelocity = this.rootBody.velocity;
    const currentAngularVelocity = this.rootBody.angularVelocity;
    const currentPosition = this.rootBody.position;
    const currentAngle = this.rootBody.angle;
    const wasPlayerControlled = this.isPlayerControlled;// CRITICAL FIX: Clean up all connection references to the destroyed entity
    this.entities.forEach(otherEntity => {
      if (otherEntity !== entity) {
        otherEntity.disconnectFrom(entity);
      }
    });

    // Remove the destroyed entity
    this.entities.splice(entityIndex, 1);    // ADDITIONAL FIX: Completely rebuild the connection graph for remaining entities
    // This ensures we have accurate connectivity information after the removal
    console.log(`🔧 DEBUG: Rebuilding connections for remaining ${this.entities.length} entities:`);
    this.entities.forEach((entity, index) => {
      console.log(`  ${index}: ${entity.type} at (${entity.body.position.x.toFixed(1)}, ${entity.body.position.y.toFixed(1)})`);
    });
    this.buildConnectionGraph();

    if (this.entities.length === 0) {
      this.destroy();
      return [];
    }    // Find connected components from remaining entities
    const components = this.findConnectedComponents();    // If there's only one component, the ship remains intact - no need to break apart
    if (components.length === 1) {
      // Recreate the assembly body without the destroyed entity to update physics
      // Note: The destroyed entity's physics body has already been removed from the world by GameEngine
      this.createFreshBody();
      return [this];
    }

    // Multiple components found - ship breaks apart
    // Mark this assembly as destroyed since it's being split
    this.destroyed = true;// Create completely new assemblies for each component
    const newAssemblies: Assembly[] = [];
    
    components.forEach((component) => {
      const newAssembly = this.createNewAssemblyFromComponent(
        component,
        currentPosition,
        currentVelocity,
        currentAngularVelocity,
        currentAngle
      );

      // Set team and naming for broken parts
      if (component.length === 1 && !newAssembly.hasControlCenter()) {
        // Single part without cockpit = debris
        newAssembly.setTeam(-1); // Neutral debris
        newAssembly.setShipName(`${component[0].type} Debris`);
      } else {
        // Multi-part assembly or has cockpit = maintains original team
        newAssembly.setTeam(this.team);
        newAssembly.setShipName(`${this.shipName} Fragment`);
      }

      // Transfer player control to first assembly with a cockpit
      if (wasPlayerControlled && newAssembly.hasControlCenter() && !newAssemblies.some(a => a.isPlayerControlled)) {
        newAssembly.isPlayerControlled = true;
      }

      newAssemblies.push(newAssembly);
    });
    return newAssemblies;
  }  private createFreshBody(): void {
    // Save old body reference so GameEngine can remove it and its parts from the physics world.
    const oldRootBody = this.rootBody;

    // Capture current physics state before recreating
    const currentVelocity = oldRootBody ? oldRootBody.velocity : { x: 0, y: 0 };
    const currentAngularVelocity = oldRootBody ? oldRootBody.angularVelocity : 0;
    const currentAngle = oldRootBody ? oldRootBody.angle : 0;

    // Capture a reference entity's world position from the OLD compound so we can
    // compensate for the center-of-mass shift after removing a block.  When Matter.js
    // rebuilds the compound with fewer parts it recomputes the COM; naively restoring
    // the old COM world position causes the whole assembly to visually jump.
    // refBodyLocalPos = the reference entity's body centre in "local-offset space"
    // (= localOffset + bodyOffset for multi-cell blocks; = localOffset for 1×1 blocks).
    // refWorldPos = that body centre's current world position.
    // The COM-compensation formula later uses these two together so that the reference
    // entity stays visually fixed when the compound is rebuilt.
    let refBodyLocalPos: { x: number; y: number } | null = null;
    let refWorldPos: { x: number; y: number } | null = null;
    if (oldRootBody) {
      for (const entity of this.entities) {
        if (!entity.destroyed) {
          const bodyOff = getEntityBodyOffset(entity.type, entity.rotation);
          refBodyLocalPos = {
            x: entity.localOffset.x + bodyOff.x,
            y: entity.localOffset.y + bodyOff.y,
          };
          refWorldPos = { x: entity.body.position.x, y: entity.body.position.y };
          break;
        }
      }
    }

    // Build new entity list — only surviving (non-destroyed) entities.
    const newEntities: Entity[] = [];
    this.entities.forEach(oldEntity => {
      if (!oldEntity.destroyed) {
        const config: EntityConfig = {
          type: oldEntity.type,
          x: oldEntity.localOffset.x,
          y: oldEntity.localOffset.y,
          rotation: oldEntity.rotation,
          health: oldEntity.health,
          maxHealth: oldEntity.maxHealth
        };
        newEntities.push(new Entity(config));
      }
    });
    this.entities = newEntities;

    // Rebuild connections using localOffset (grid-aligned, rotation-independent).
    this.buildConnectionGraph();

    // Refresh shield state now (after entity rebuild) so hasActiveShield() is accurate
    // when we decide whether to include the physical shield circle in the compound.
    this.shieldState = this.initializeShieldState();

    // Build the parts list. When the shield field is active, add one low-mass circle body
    // per shield entity at fixed radius. render.visible=false — ShieldRenderer handles visuals.
    const parts: Matter.Body[] = this.entities.map(e => e.body);
    if (this.hasActiveShield()) {
      for (const entity of this.entities) {
        if ((entity.type !== 'Shield' && entity.type !== 'LargeShield') || entity.destroyed) continue;
        const def = ENTITY_DEFINITIONS[entity.type];
        const radius = def.shieldRadius ?? 80;
        const offset = getEntityBodyOffset(entity.type, entity.rotation);
        const cx = entity.localOffset.x + offset.x;
        const cy = entity.localOffset.y + offset.y;
        const shieldCircle = Matter.Bodies.circle(cx, cy, radius, {
          density: 0.000001,
          restitution: 0.3,
          frictionAir: 0,
          friction: 0,
          render: { visible: false },
        });
        (shieldCircle as any).isShieldPart = true;
        (shieldCircle as any).parentAssembly = this;
        parts.push(shieldCircle);
      }
    }

    // Create the replacement compound body.
    this.rootBody = Matter.Body.create({
      parts,
      isStatic: false,
      frictionAir: 0,
      friction: 0,
      restitution: 0.2
    });

    // Restore physics state, correcting for the COM shift caused by removing a block.
    // After Matter.Body.create the compound root sits at the new COM in local-offset space.
    // setPosition(T) + setAngle(angle) places the reference entity at:
    //   T + rotate(refLocalOffset - newCOM, angle)
    // Solving for T so the entity lands at its original world position gives the formula below.
    let targetPosition: { x: number; y: number };
    if (refBodyLocalPos && refWorldPos) {
      const newCOM = this.rootBody.position; // COM in body-centre local space right after create
      const cos = Math.cos(currentAngle);
      const sin = Math.sin(currentAngle);
      const dx = refBodyLocalPos.x - newCOM.x;
      const dy = refBodyLocalPos.y - newCOM.y;
      targetPosition = {
        x: refWorldPos.x - (dx * cos - dy * sin),
        y: refWorldPos.y - (dx * sin + dy * cos),
      };
    } else {
      targetPosition = oldRootBody ? oldRootBody.position : { x: 0, y: 0 };
    }

    Matter.Body.setPosition(this.rootBody, targetPosition);
    Matter.Body.setVelocity(this.rootBody, currentVelocity);
    Matter.Body.setAngularVelocity(this.rootBody, currentAngularVelocity);
    Matter.Body.setAngle(this.rootBody, currentAngle);

    this.rootBody.assembly = this;
    this.entities.forEach(entity => { entity.body.assembly = this; });

    // Signal to GameEngine that the old compound body must be removed from the physics world
    // and the new one added.  GameEngine checks pendingBodySwap each frame.
    this.pendingBodySwap = { oldBody: oldRootBody };
  }

  private createNewAssemblyFromComponent(component: Entity[], _basePosition: Vector2, velocity: Vector2, angularVelocity: number, baseAngle: number): Assembly {
    // World-space center of this component — used as the spawn position.
    const avgCurrentX = component.reduce((sum, e) => sum + e.body.position.x, 0) / component.length;
    const avgCurrentY = component.reduce((sum, e) => sum + e.body.position.y, 0) / component.length;

    // Build configs using localOffset so the new assembly's entities have grid-aligned
    // localOffset values. Using body.position (world coords) would produce non-grid-aligned
    // values for rotated ships, breaking future connectivity checks on the fragment.
    const avgLocalX = component.reduce((sum, e) => sum + e.localOffset.x, 0) / component.length;
    const avgLocalY = component.reduce((sum, e) => sum + e.localOffset.y, 0) / component.length;
    const configs: EntityConfig[] = component.map(entity => ({
      type: entity.type,
      x: entity.localOffset.x - avgLocalX,
      y: entity.localOffset.y - avgLocalY,
      rotation: entity.rotation,
      health: entity.health,
      maxHealth: entity.maxHealth
    }));

    // Position the new assembly at the component's current center of mass
    const newPosition = {
      x: avgCurrentX,
      y: avgCurrentY
    };

    console.log(`🔧 Creating new assembly at (${newPosition.x.toFixed(1)}, ${newPosition.y.toFixed(1)}) with ${component.length} parts`);

    const newAssembly = new Assembly(configs, newPosition);
    
    // Set the assembly's rotation to match the original
    Matter.Body.setAngle(newAssembly.rootBody, baseAngle);

    // Conserve momentum - inherit velocity and angular momentum
    Matter.Body.setVelocity(newAssembly.rootBody, velocity);
    Matter.Body.setAngularVelocity(newAssembly.rootBody, angularVelocity);

    // Add small explosion force for dramatic effect
    const explosionForce = 0.5;
    const randomAngle = Math.random() * Math.PI * 2;
    const explosionVelocity = {
      x: Math.cos(randomAngle) * explosionForce,
      y: Math.sin(randomAngle) * explosionForce
    };

    // Apply the explosion force on top of the conserved momentum
    const finalVelocity = {
      x: velocity.x + explosionVelocity.x,
      y: velocity.y + explosionVelocity.y
    };

    Matter.Body.setVelocity(newAssembly.rootBody, finalVelocity);

    return newAssembly;
  }  private findConnectedComponents(): Entity[][] {
    if (this.entities.length <= 1) return [this.entities];

    // Debug logging for Titan Dreadnought
    if (this.shipName === 'Titan Dreadnought') {
      console.log(`🔍 Finding connected components for ${this.shipName} with ${this.entities.length} entities`);
      this.entities.forEach(entity => {
        console.log(`  - ${entity.type} at (${entity.body.position.x}, ${entity.body.position.y})`);
      });
    }

    // Build connectivity graph using the tracked connections
    const graph = new Map<string, Set<string>>();

    // Initialize graph
    this.entities.forEach(entity => {
      graph.set(entity.id, new Set());
    });

    // Use the tracked connections to build the graph
    let connectionCount = 0;
    this.entities.forEach(entity => {
      const connectedEntityIds = entity.getConnectedEntities();
      connectedEntityIds.forEach(connectedId => {
        const connectedEntity = this.entities.find(e => e.id === connectedId);
        if (connectedEntity) {
          graph.get(entity.id)!.add(connectedId);
          graph.get(connectedId)!.add(entity.id);
          connectionCount++;
          
          if (this.shipName === 'Titan Dreadnought') {
            console.log(`  ✅ ${entity.type} <-> ${connectedEntity.type} CONNECTED (tracked)`);
          }
        }
      });
    });

    if (this.shipName === 'Titan Dreadnought') {
      console.log(`🔍 Found ${connectionCount} total tracked connections`);
    }

    // Find connected components using DFS
    const visited = new Set<string>();
    const components: Entity[][] = [];

    this.entities.forEach(entity => {
      if (!visited.has(entity.id)) {
        const component: Entity[] = [];
        this.dfsComponent(entity.id, graph, visited, component);
        components.push(component);
      }
    });

    // Debug logging for Titan Dreadnought
    if (this.shipName === 'Titan Dreadnought') {
      console.log(`🔍 Found ${components.length} connected components:`);
      components.forEach((component, index) => {
        console.log(`  Component ${index}: ${component.map(e => e.type).join(', ')}`);
      });
    }

    return components;  }

  /**
   * Returns true if the given entity can be detached from this assembly without
   * splitting the remaining entities into disconnected fragments.
   * A control-center (cockpit) is never detachable.
   * Pure read-only — no state mutation.
   */
  public canDetachEntity(entity: Entity): boolean {
    if (entity.isControlCenter()) return false;
    if (!this.entities.includes(entity)) return false;

    const remaining = this.entities.filter(e => e !== entity);
    if (remaining.length === 0) return false;

    // Build localOffset-based adjacency — mirrors buildConnectionGraph, read-only.
    // Multi-cell blocks register once per occupied cell.
    const gridMap = new Map<string, Entity>();
    remaining.forEach(e => {
      getEntityOccupiedGridCells(e.localOffset, e.type, e.rotation).forEach(cell => {
        gridMap.set(`${cell.x},${cell.y}`, e);
      });
    });

    const adj = new Map<string, Set<string>>();
    remaining.forEach(e => adj.set(e.id, new Set()));

    const dirs = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
    remaining.forEach(e => {
      const blockedA = getBlockedConnectionDirs(e.type, e.rotation);
      getEntityOccupiedGridCells(e.localOffset, e.type, e.rotation).forEach(cell => {
        dirs.forEach(({ dx, dy }) => {
          if (blockedA.some(b => b.x === dx && b.y === dy)) return;
          const nbr = gridMap.get(`${cell.x + dx},${cell.y + dy}`);
          if (!nbr || nbr === e) return;
          const blockedB = getBlockedConnectionDirs(nbr.type, nbr.rotation);
          if (blockedB.some(b => b.x === -dx && b.y === -dy)) return;
          if (this.canEntitiesConnect(e, nbr)) {
            adj.get(e.id)!.add(nbr.id);
            adj.get(nbr.id)!.add(e.id);
          }
        });
      });
    });

    // BFS from first remaining entity — all remaining must be reachable
    const visited = new Set<string>([remaining[0].id]);
    const queue = [remaining[0].id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      adj.get(cur)?.forEach(id => {
        if (!visited.has(id)) { visited.add(id); queue.push(id); }
      });
    }
    return visited.size === remaining.length;
  }

  /**
   * Detach a single entity from this assembly and return it as a new single-entity
   * Assembly positioned at the entity's current world location.
   * The caller MUST process `this.pendingBodySwap` synchronously after this call.
   */
  public detachEntity(entity: Entity): Assembly {
    // Snapshot world state before any structural changes (createFreshBody discards old entities)
    const entityWorldPos = { x: entity.body.position.x, y: entity.body.position.y };
    const shipVelocity = { x: this.rootBody.velocity.x, y: this.rootBody.velocity.y };
    const shipAngle = this.rootBody.angle;
    const shipAngularVelocity = this.rootBody.angularVelocity;

    const config: EntityConfig = {
      type: entity.type,
      x: 0,
      y: 0,
      rotation: entity.rotation,
      health: entity.health,
      maxHealth: entity.maxHealth,
    };

    // Remove from this assembly and disconnect neighbors
    this.entities = this.entities.filter(e => e !== entity);
    this.entities.forEach(other => other.disconnectFrom(entity));

    // Rebuild this assembly (sets pendingBodySwap — caller must process it)
    this.buildConnectionGraph();
    this.createFreshBody();

    // Build detached single-entity assembly at the block's world position
    const detached = new Assembly([config], entityWorldPos);
    Matter.Body.setAngle(detached.rootBody, shipAngle);
    Matter.Body.setVelocity(detached.rootBody, shipVelocity);
    Matter.Body.setAngularVelocity(detached.rootBody, shipAngularVelocity);
    return detached;
  }

  private dfsComponent(
    entityId: string,
    graph: Map<string, Set<string>>,
    visited: Set<string>,
    component: Entity[]
  ): void {
    visited.add(entityId);
    const entity = this.entities.find(e => e.id === entityId);
    if (entity) {
      component.push(entity);
    }

    const neighbors = graph.get(entityId);
    if (neighbors) {
      neighbors.forEach(neighborId => {
        if (!visited.has(neighborId)) {
          this.dfsComponent(neighborId, graph, visited, component);
        }
      });
    }
  }

  public destroy(): void {
    this.destroyed = true;
    this.entities.forEach(entity => entity.destroy());
  }

  // ─── Shield field management ──────────────────────────────────────────────

  /**
   * Build initial ShieldState from the current set of entities.
   * Returns null if no shield blocks are present.
   */
  private initializeShieldState(): ShieldState | null {
    const shieldBlocks = this.entities.filter(
      e => (e.type === 'Shield' || e.type === 'LargeShield') && !e.destroyed
    );
    if (shieldBlocks.length === 0) return null;

    const totalHp = shieldBlocks.reduce((sum, block) => {
      const def = ENTITY_DEFINITIONS[block.type];
      return sum + (def.shieldHp ?? 0);
    }, 0);

    // Preserve existing state when refreshing after body rebuild (so regen/cooldown persists)
    if (this.shieldState) {
      return {
        currentHp: Math.min(this.shieldState.currentHp, totalHp),
        maxHp: Math.min(this.shieldState.maxHp, totalHp),
        isActive: this.shieldState.isActive,
        lastHitTime: this.shieldState.lastHitTime,
        cooldownUntil: this.shieldState.cooldownUntil,
      };
    }

    return {
      currentHp: totalHp,
      maxHp: totalHp,
      isActive: true,
      lastHitTime: 0,
      cooldownUntil: 0,
    };
  }

  /**
   * Per-frame shield tick: handles regen and post-collapse reactivation.
   * deltaTimeMs is elapsed time in milliseconds.
   */
  public updateShield(deltaTimeMs: number): void {
    // Drop shield state if all shield blocks have been destroyed
    const hasBlocks = this.entities.some(
      e => (e.type === 'Shield' || e.type === 'LargeShield') && !e.destroyed
    );
    if (!hasBlocks) {
      this.shieldState = null;
      return;
    }

    if (!this.shieldState) return;
    const s = this.shieldState;
    const now = Date.now();

    if (!s.isActive) {
      // Check whether the post-collapse lockout has expired
      if (s.maxHp > 0 && now >= s.cooldownUntil) {
        s.isActive = true;
        s.currentHp = s.maxHp;
        s.lastHitTime = now; // Grace period so regen doesn't immediately fire
        // Rebuild compound body to add the physical shield circle part back.
        this.createFreshBody();
      }
      return;
    }

    // Regen: starts after SHIELD_REGEN_DELAY_MS of no hits
    if (s.currentHp < s.maxHp && (now - s.lastHitTime) >= SHIELD_REGEN_DELAY_MS) {
      const regenPerMs = s.maxHp / SHIELD_REGEN_DURATION_MS;
      s.currentHp = Math.min(s.maxHp, s.currentHp + regenPerMs * deltaTimeMs);
    }
  }

  /**
   * Attempt to absorb `damage` with the shield field.
   * Returns true if the shield was active and absorbed the hit (caller should
   * skip normal entity damage). Returns false if the shield is down.
   *
   * Per hit: reduces both currentHp and maxHp by the damage amount so the
   * shield's regen ceiling degrades over time (Halo-style wear mechanic).
   */
  public damageShield(damage: number, now: number): boolean {
    if (!this.shieldState || !this.shieldState.isActive) return false;

    const s = this.shieldState;
    s.lastHitTime = now;

    // maxHp degrades with every hit — regen ceiling lowers over time
    s.maxHp = Math.max(0, s.maxHp - damage);
    s.currentHp = Math.max(0, s.currentHp - damage);

    if (s.currentHp <= 0) {
      // Final hit absorbed; field collapses. Lockout before reactivation.
      s.currentHp = 0;
      s.isActive = false;
      s.cooldownUntil = now + SHIELD_COLLAPSE_COOLDOWN_MS;
      // Rebuild compound body to remove the physical shield circle part.
      this.createFreshBody();
    }

    return true; // Damage was absorbed — don't hit inner blocks
  }

  /** True when the shield field is active and has HP remaining. */
  public hasActiveShield(): boolean {
    return this.shieldState !== null && this.shieldState.isActive && this.shieldState.currentHp > 0;
  }

  /**
   * Returns world-space positions and radii of each active shield entity.
   * Used by ShieldRenderer to draw one bubble per shield generator.
   */
  public getShieldBubbles(): { x: number; y: number; radius: number }[] {
    const result: { x: number; y: number; radius: number }[] = [];
    for (const entity of this.entities) {
      if ((entity.type !== 'Shield' && entity.type !== 'LargeShield') || entity.destroyed) continue;
      const def = ENTITY_DEFINITIONS[entity.type];
      const radius = def.shieldRadius ?? 80;
      // Use the entity's physics body position (already in world space)
      result.push({ x: entity.body.position.x, y: entity.body.position.y, radius });
    }
    return result;
  }

  /** Returns the largest shield radius among active shield entities. */
  public getShieldRadius(): number {
    let maxRadius = 0;
    for (const entity of this.entities) {
      if ((entity.type !== 'Shield' && entity.type !== 'LargeShield') || entity.destroyed) continue;
      const def = ENTITY_DEFINITIONS[entity.type];
      const r = def.shieldRadius ?? 80;
      if (r > maxRadius) maxRadius = r;
    }
    return maxRadius;
  }

  /** Bounding radius from assembly COM to the farthest entity corner (for highlights/icons). */
  public getBoundingRadius(): number {
    const PADDING = 12;
    let maxDistSq = 0;
    for (const entity of this.entities) {
      if (entity.destroyed) continue;
      const def = ENTITY_DEFINITIONS[entity.type];
      const halfW = def.width / 2;
      const halfH = def.height / 2;
      const cx = entity.localOffset.x;
      const cy = entity.localOffset.y;
      for (const dx of [-halfW, halfW]) {
        for (const dy of [-halfH, halfH]) {
          const distSq = (cx + dx) * (cx + dx) + (cy + dy) * (cy + dy);
          if (distSq > maxDistSq) maxDistSq = distSq;
        }
      }
    }
    return Math.sqrt(maxDistSq) + PADDING;
  }

  // ─── End shield field management ─────────────────────────────────────────

  public getControlCenter(): Entity | null {
    return this.entities.find(e => e.isControlCenter()) || null;
  }
  public hasControlCenter(): boolean {
    return this.getControlCenter() !== null;
  }

  public setTeam(team: number): void {
    this.team = team;
    this.updateTeamColors();
  }

  public getTeam(): number {
    return this.team;
  }
  private updateTeamColors(): void {
    // Set MUCH more obvious team-based colors for all entities
    const teamColor = this.team === 0 ? '#0066ff' : '#ff0000'; // Much more vibrant colors
    const teamAccent = this.team === 0 ? '#00aaff' : '#ff3333';
    const teamBright = this.team === 0 ? '#66ccff' : '#ff6666';

    this.entities.forEach(entity => {
      if (entity.body.render) {
        // Override the default entity colors with MUCH more obvious team colors
        if (entity.isControlCenter()) {
          // Cockpits get the brightest color to stand out dramatically
          entity.body.render.fillStyle = teamBright;
          entity.body.render.strokeStyle = '#ffffff';
          entity.body.render.lineWidth = 3; // Thicker border        } else {
          // Other parts get the main team color - much more vibrant
          entity.body.render.fillStyle = teamColor;
          entity.body.render.strokeStyle = teamAccent;
          entity.body.render.lineWidth = 2; // Thicker borders for visibility
        }
      }
    });
  }

  // Set ship name for display
  public setShipName(name: string): void {
    this.shipName = name;
  }
  public getDamagePercentage(): number {
    const totalMaxHealth = this.entities.reduce((sum, e) => sum + e.maxHealth, 0);
    const currentHealth = this.entities.reduce((sum, e) => sum + e.health, 0);
    return totalMaxHealth > 0 ? (1 - (currentHealth / totalMaxHealth)) * 100 : 0;
  }
  public canEject(): boolean {
    // Can eject if there's a control center and there are non-control parts to eject
    const hasControlCenter = this.hasControlCenter();
    const hasNonControlParts = this.entities.some(e => !e.isControlCenter());
    return hasControlCenter && hasNonControlParts;
  }
  public ejectNonControlParts(): Assembly[] {
    console.log('🚀 EJECTING! Separating non-control parts from assembly');

    const controlCenter = this.getControlCenter();
    if (!controlCenter) {
      console.warn('⚠️ Cannot eject - no control center found');
      return [];
    }

    // Separate entities into cockpit and non-cockpit
    const ejectEntities = this.entities.filter(e => !e.isControlCenter());

    console.log(`💥 EXPLOSION! Ejecting ${ejectEntities.length} parts with explosive force from cockpit origin`);

    // Create new assemblies for ejected parts (each part becomes its own debris)
    const newAssemblies: Assembly[] = [];
    const cockpitPos = controlCenter.body.position;
    const explosionForce = 0.005; // Force magnitude for Matter.js physics
    const explosionRadius = 200; // Maximum effective radius of explosion

    ejectEntities.forEach(entity => {
      // Create individual debris assemblies for each ejected part
      const debrisConfig: EntityConfig = {
        type: entity.type,
        x: entity.body.position.x,
        y: entity.body.position.y,
        rotation: (entity.body.angle * 180) / Math.PI,
        health: entity.health,
        maxHealth: entity.maxHealth
      };

      const debrisAssembly = new Assembly([debrisConfig], entity.body.position);
      debrisAssembly.setTeam(-1); // Mark as neutral debris
      debrisAssembly.setShipName(`${entity.type} Debris`);

      // Calculate explosion effect from cockpit origin using Matter.js forces
      const entityPos = entity.body.position;
      const explosionVector = {
        x: entityPos.x - cockpitPos.x,
        y: entityPos.y - cockpitPos.y
      };

      // Calculate distance from explosion center
      const distance = Math.sqrt(explosionVector.x * explosionVector.x + explosionVector.y * explosionVector.y);

      if (distance > 0) {
        // Normalize the explosion vector
        const normalizedVector = {
          x: explosionVector.x / distance,
          y: explosionVector.y / distance
        };

        // Calculate explosion force based on distance (closer = more force)
        const distanceFactor = Math.max(0.1, 1 - (distance / explosionRadius));
        const forceMultiplier = explosionForce * distanceFactor;

        // Add some randomness to make it more organic (±30 degrees)
        const randomAngle = (Math.random() - 0.5) * Math.PI / 3;
        const forceAngle = Math.atan2(normalizedVector.y, normalizedVector.x) + randomAngle;

        // Apply explosion force with some random variation
        const forceVariation = 0.8 + Math.random() * 0.4; // 0.8x to 1.2x force
        const force = {
          x: Math.cos(forceAngle) * forceMultiplier * forceVariation,
          y: Math.sin(forceAngle) * forceMultiplier * forceVariation
        };

        // Apply force at the center of mass - this is the proper Matter.js way
        Matter.Body.applyForce(debrisAssembly.rootBody, debrisAssembly.rootBody.position, force);

        console.log(`💥 Debris ${entity.type} ejected with force ${forceMultiplier.toFixed(4)} at distance ${distance.toFixed(1)} `);
      } else {
        // If entity is at exact same position as cockpit, use random direction
        const randomAngle = Math.random() * Math.PI * 2;
        const randomForce = explosionForce * (0.5 + Math.random() * 0.5);
        const force = {
          x: Math.cos(randomAngle) * randomForce,
          y: Math.sin(randomAngle) * randomForce
        };
        Matter.Body.applyForce(debrisAssembly.rootBody, debrisAssembly.rootBody.position, force);
      }

      // Add random spin - we can still set angular velocity for this
      const spinIntensity = 0.1 + Math.random() * 0.3;
      Matter.Body.setAngularVelocity(debrisAssembly.rootBody, (Math.random() - 0.5) * spinIntensity);

      newAssemblies.push(debrisAssembly);
    });    // Create new cockpit-only assembly
    const cockpitConfig: EntityConfig = {
      type: controlCenter.type,
      x: controlCenter.body.position.x,
      y: controlCenter.body.position.y,
      rotation: (controlCenter.body.angle * 180) / Math.PI,
      health: controlCenter.health,
      maxHealth: controlCenter.maxHealth
    }; const cockpitAssembly = new Assembly([cockpitConfig], controlCenter.body.position);
    cockpitAssembly.setTeam(this.team);
    cockpitAssembly.isPlayerControlled = this.isPlayerControlled;
    cockpitAssembly.setShipName(`${this.shipName} (Cockpit)`);

    // Make cockpit briefly invulnerable after ejection to prevent immediate damage
    const cockpitEntity = cockpitAssembly.entities[0];
    if (cockpitEntity) {
      cockpitEntity.setInvulnerable(2000); // 2 seconds of invulnerability
    }

    // Apply gentle recoil to cockpit from explosion (much smaller than debris)
    const originalVel = this.rootBody.velocity;
    const recoilForce = 1.5; // Much smaller than debris explosion force
    const recoilAngle = Math.random() * Math.PI * 2; // Random direction

    Matter.Body.setVelocity(cockpitAssembly.rootBody, {
      x: originalVel.x * 0.8 + Math.cos(recoilAngle) * recoilForce,
      y: originalVel.y * 0.8 + Math.sin(recoilAngle) * recoilForce
    });

    console.log(`💥 Cockpit recoil applied: ${recoilForce} force at ${(recoilAngle * 180 / Math.PI).toFixed(1)}°`);

    // Mark this assembly as destroyed
    this.destroyed = true;

    console.log(`🚀 Ejection complete: 1 cockpit assembly + ${newAssemblies.length} debris pieces`);

    return [cockpitAssembly, ...newAssemblies];
  }

  /**
   * Merge all entities from `source` into this assembly at the grid positions
   * described by `newLocalOffsets`.  After this call the source assembly should
   * be discarded — its entities are now first-class members of this assembly.
   */
  public attachExternalAssembly(
    source: Assembly,
    newLocalOffsets: Map<string, { localOffset: Vector2; rotation: number }>
  ): void {
    // Record a reference entity's world position BEFORE any changes so we can
    // cancel out the centre-of-mass drift that createFreshBody introduces when
    // new blocks shift the compound's CM.
    const refLocalOffset = this.entities.length > 0
      ? { x: this.entities[0].localOffset.x, y: this.entities[0].localOffset.y }
      : null;
    const refWorldPosBefore = this.entities.length > 0
      ? { x: this.entities[0].body.position.x, y: this.entities[0].body.position.y }
      : null;

    for (const entity of source.entities) {
      const data = newLocalOffsets.get(entity.id);
      if (!data) continue;
      entity.localOffset = { ...data.localOffset };
      entity.rotation = data.rotation;
      this.entities.push(entity);
    }
    this.buildConnectionGraph();
    this.createFreshBody();

    // createFreshBody restores the compound to the old centre-of-mass world
    // position.  Adding new blocks shifts the new compound's CM, so the
    // reference entity drifts.  Measure the drift and apply an equal-but-opposite
    // translation so the original entities stay exactly where they were.
    if (refLocalOffset && refWorldPosBefore) {
      const refEntityAfter = this.entities.find(
        e => Math.abs(e.localOffset.x - refLocalOffset.x) < 0.5 &&
             Math.abs(e.localOffset.y - refLocalOffset.y) < 0.5
      );
      if (refEntityAfter) {
        const driftX = refEntityAfter.body.position.x - refWorldPosBefore.x;
        const driftY = refEntityAfter.body.position.y - refWorldPosBefore.y;
        if (Math.abs(driftX) > 0.01 || Math.abs(driftY) > 0.01) {
          Matter.Body.setPosition(this.rootBody, {
            x: this.rootBody.position.x - driftX,
            y: this.rootBody.position.y - driftY,
          });
        }
      }
    }
  }

  public getShipBounds(): { minX: number, minY: number, maxX: number, maxY: number, width: number, height: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    this.entities.forEach(entity => {
      const def = ENTITY_DEFINITIONS[entity.type];
      const halfWidth = def.width / 2;
      const halfHeight = def.height / 2;

      // Get entity position relative to assembly root
      const entityX = entity.body.position.x;
      const entityY = entity.body.position.y;

      minX = Math.min(minX, entityX - halfWidth);
      minY = Math.min(minY, entityY - halfHeight);
      maxX = Math.max(maxX, entityX + halfWidth);
      maxY = Math.max(maxY, entityY + halfHeight);
    });

    const width = maxX - minX;
    const height = maxY - minY;

    return { minX, minY, maxX, maxY, width, height };
  }

  public getShipRadius(): number {
    const bounds = this.getShipBounds();
    // Return the radius as half the diagonal of the bounding box
    return Math.sqrt(bounds.width * bounds.width + bounds.height * bounds.height) / 2;
  }

  // Auto-fire at primary target if weapons can aim at it
  public autoFireAtPrimaryTarget(): Matter.Body[] {
    if (!this.primaryTarget || this.primaryTarget.destroyed) {
      return [];
    }
    return this.fireWeapons();
  }

  /**
   * Per-weapon independent target selection.
   *
   * Searches all available enemy assemblies for the entity body that falls
   * within this weapon's aiming arc AND is closest in angle to the weapon's
   * natural facing direction.  Weapons with different natural angles will
   * naturally lock onto different parts/targets, spreading fire across the enemy.
   *
   * Falls back to the nearest enemy's root-body position when nothing lies
   * within arc, so the weapon still tracks toward the threat.
   */
  private findBestWeaponTarget(weapon: Entity): Vector2 | null {
    if (this.availableTargets.length === 0) return null;

    const weaponPos = weapon.body.position;
    const weaponNaturalAngle = this.rootBody.angle + (weapon.rotation * Math.PI / 180);
    const aimingArc = this.getWeaponAimingArc(weapon.type);
    const maxAngleDiff = aimingArc / 2;
    const weaponRange = ENTITY_DEFINITIONS[weapon.type].weaponRange;
    const rangeSq = weaponRange ? weaponRange * weaponRange : Infinity;

    // Best entity body within the aiming arc AND range
    let bestInArc: Vector2 | null = null;
    let bestInArcAngularDist = Infinity;

    // Nearest enemy root-body within range as fallback when nothing is in-arc
    let closestFallback: Vector2 | null = null;
    let closestFallbackDistSq = Infinity;

    for (const target of this.availableTargets) {
      if (target.destroyed || target.team === this.team) continue;

      // Check each entity body on the target as a potential aim point
      for (const entity of target.entities) {
        if (entity.destroyed) continue;
        const pos = entity.body.position;
        const dx = pos.x - weaponPos.x;
        const dy = pos.y - weaponPos.y;
        const distSq = dx * dx + dy * dy;

        // Skip entities outside weapon range
        if (distSq > rangeSq) continue;

        const angleToEntity = Math.atan2(dy, dx);
        let angleDiff = angleToEntity - weaponNaturalAngle;
        while (angleDiff >  Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        if (Math.abs(angleDiff) <= maxAngleDiff && Math.abs(angleDiff) < bestInArcAngularDist) {
          bestInArcAngularDist = Math.abs(angleDiff);
          bestInArc = pos;
        }
      }

      // Track closest target within range by distance as fallback
      const rp = target.rootBody.position;
      const dx = rp.x - weaponPos.x;
      const dy = rp.y - weaponPos.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < closestFallbackDistSq && distSq <= rangeSq) {
        closestFallbackDistSq = distSq;
        closestFallback = rp;
      }
    }

    return bestInArc ?? closestFallback;
  }

  // Update weapon aiming continuously (called every frame)
  public updateWeaponAiming(): void {
    if (this.destroyed) return;

    this.weaponTargetPositions.clear();

    const weapons = this.entities.filter(e => e.canFire());
    weapons.forEach(weapon => {
      // Weapon targeting priority order:
      // 1. Per-weapon independent targeting from availableTargets (AI ships)
      // 2. Primary target assembly COM (single-target fallback)
      // 3. Mouse cursor position (player control)
      let aimingTarget: Vector2 | null = null;

      if (this.availableTargets.length > 0) {
        aimingTarget = this.findBestWeaponTarget(weapon);
      }

      if (!aimingTarget && this.primaryTarget && !this.primaryTarget.destroyed) {
        aimingTarget = this.primaryTarget.rootBody.position;
      }

      if (!aimingTarget && this.cursorPosition) {
        aimingTarget = this.cursorPosition;
      }

      // Calculate desired aiming angle and set it as the weapon's target
      if (aimingTarget) {
        this.weaponTargetPositions.set(weapon.id, aimingTarget);

        const desiredAngle = this.calculateWeaponAimAngle(weapon, aimingTarget);
        const weaponNaturalAngle = this.rootBody.angle + (weapon.rotation * Math.PI / 180);

        // Calculate the desired rotation relative to weapon's natural direction
        let desiredRelativeAngle = desiredAngle - weaponNaturalAngle;
        while (desiredRelativeAngle > Math.PI) desiredRelativeAngle -= 2 * Math.PI;
        while (desiredRelativeAngle < -Math.PI) desiredRelativeAngle += 2 * Math.PI;

        // Clamp to weapon's aiming arc
        const aimingArc = this.getWeaponAimingArc(weapon.type);
        const maxAngle = aimingArc / 2;
        desiredRelativeAngle = Math.max(-maxAngle, Math.min(maxAngle, desiredRelativeAngle));

        weapon.setTargetAimAngle(desiredRelativeAngle);
      } else {
        // No target, return to natural position
        weapon.setTargetAimAngle(0);
      }
    });
  }  /**
   * Build the connection graph between entities using grid-based adjacency
   * This method checks all entities against each other to determine which should be connected
   * based on grid adjacency (N/S/E/W neighbors only).
   */  private buildConnectionGraph(): void {
    // Clear existing connections
    this.entities.forEach(entity => {
      entity.attachmentConnections.forEach(connection => {
        connection.connectedEntity = null;
        connection.attachmentPointIndex = -1;
      });
      entity.clearAllSideConnections();
    });

    // Build a grid map covering ALL cells of every entity (multi-cell blocks register
    // once per occupied cell).  Using localOffset (always grid-aligned) not body.position
    // (which drifts after rotation).
    const gridMap = new Map<string, Entity>();
    this.entities.forEach(entity => {
      getEntityOccupiedGridCells(entity.localOffset, entity.type, entity.rotation).forEach(cell => {
        gridMap.set(`${cell.x},${cell.y}`, entity);
      });
    });

    // Check all entities for grid-adjacent connections.  For multi-cell blocks every
    // occupied cell is checked; same-entity neighbour cells are skipped automatically.
    let connectionCount = 0;
    const directions = [
      { dx: 0, dy: -1, side: 'north' as const },
      { dx: 1, dy: 0,  side: 'east'  as const },
      { dx: 0, dy: 1,  side: 'south' as const },
      { dx: -1, dy: 0, side: 'west'  as const },
    ];

    this.entities.forEach(entity => {
      const cells = getEntityOccupiedGridCells(entity.localOffset, entity.type, entity.rotation);
      const blockedA = getBlockedConnectionDirs(entity.type, entity.rotation);
      cells.forEach(cell => {
        directions.forEach(dir => {
          // Skip if this entity has no face in this direction (e.g. TriHull hypotenuse)
          if (blockedA.some(b => b.x === dir.dx && b.y === dir.dy)) return;

          const neighbourKey = `${cell.x + dir.dx},${cell.y + dir.dy}`;
          const neighbour = gridMap.get(neighbourKey);
          if (!neighbour || neighbour === entity) return;

          // Skip if the neighbour has no face toward this entity
          const blockedB = getBlockedConnectionDirs(neighbour.type, neighbour.rotation);
          if (blockedB.some(b => b.x === -dir.dx && b.y === -dir.dy)) return;

          if (this.canEntitiesConnect(entity, neighbour)) {
            if (this.createGridConnection(entity, neighbour, dir.side)) {
              connectionCount++;
            }
          }
        });
      });
    });
    
    console.log(`🔗 ${this.shipName}: rebuilt connections using grid-based system, found ${connectionCount} connections between ${this.entities.length} entities`);
  }

  /**
   * Check if two entities can connect based on their type compatibility
   */
  private canEntitiesConnect(entity1: Entity, entity2: Entity): boolean {
    return canTypesConnect(entity1.type, entity2.type);
  }

  /**
   * Create a grid-based connection between two adjacent entities
   */
  private createGridConnection(entity1: Entity, entity2: Entity, side: 'north' | 'east' | 'south' | 'west'): boolean {
    // Avoid duplicate connections
    if (entity1.getConnectedEntities().includes(entity2.id)) {
      return false;
    }

    console.log(`🔗 Creating grid connection: ${entity1.type} (${side}) -> ${entity2.type}`);

    // Use the first available (null) slot in each entity's attachmentConnections so that
    // multi-cell blocks can store more than one connection without overwriting.
    const idx1 = entity1.findFreeAttachmentSlot();
    const idx2 = entity2.findFreeAttachmentSlot();
    entity1.connectTo(entity2, idx1, idx2);

    entity1.setConnectionOnSide(side, entity2.id);
    entity2.setConnectionOnSide(this.getOppositeSide(side), entity1.id);
    
    return true;
  }

  /**
   * Get the opposite side for a given side
   */
  private getOppositeSide(side: 'north' | 'east' | 'south' | 'west'): 'north' | 'east' | 'south' | 'west' {
    switch (side) {
      case 'north': return 'south';
      case 'south': return 'north';
      case 'east': return 'west';
      case 'west': return 'east';
    }
  }
}

// Extend Matter.js Body type to include our assembly reference
declare module 'matter-js' {
  interface Body {
    assembly?: Assembly;
    isLaser?: boolean;
    timeToLive?: number;
  }
}
