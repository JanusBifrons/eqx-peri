import * as Matter from 'matter-js';
import { Entity } from './Entity';
import { EntityConfig, Vector2, EntityType, ENTITY_DEFINITIONS, ShieldState, SHIELD_REGEN_DELAY_MS, SHIELD_REGEN_DURATION_MS, SHIELD_COLLAPSE_COOLDOWN_MS } from '../../types/GameTypes';
import { PowerSystem } from '../systems/PowerSystem';
import { MissileType } from '../weapons/Missile';

// Interface for missile launch requests
export interface MissileLaunchRequest {
  position: Vector2;
  angle: number;
  missileType: MissileType;
  sourceAssemblyId: string;
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
  public lockedTargets: Set<string> = new Set();
  public primaryTarget: Assembly | null = null;
  public cursorPosition: Vector2 | null = null;

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

    // Build parts list — include shield circle when field is active.
    const constructorParts: Matter.Body[] = this.entities.map(e => e.body);
    if (this.hasActiveShield()) {
      const center = this.getShieldCenterLocal();
      const shieldCircle = Matter.Bodies.circle(center.x, center.y, this.getShieldRadius(), {
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

      // Update power system if this is the player ship
      if (this.isPlayerControlled) {
        const powerSystem = PowerSystem.getInstance();
        powerSystem.setPlayerAssembly(this);
        powerSystem.updatePowerAfterDamage();
      }

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
  } public applyThrust(thrustInput: Vector2): void {
    if (this.destroyed) return;

    // Check if this is the player assembly and if engines have power
    if (this.isPlayerControlled) {
      const powerSystem = PowerSystem.getInstance();
      if (!powerSystem.canUseThrusters()) {
        // No engine power - disable all thrust
        const engines = this.entities.filter(e => e.canProvideThrust());
        engines.forEach(engine => engine.setThrustLevel(0));
        return;
      }
    }

    const engines = this.entities.filter(e => e.canProvideThrust());
    if (engines.length === 0) return;// Calculate thrust magnitude for visual effects
    const thrustMagnitude = Math.sqrt(thrustInput.x * thrustInput.x + thrustInput.y * thrustInput.y);

    // Debug logging disabled to reduce spam
    // if (thrustMagnitude > 0) {
    //   console.log(`🚀 Thrust Input: x = ${ thrustInput.x.toFixed(2) }, y = ${ thrustInput.y.toFixed(2) }, engines = ${ engines.length } `);
    // }    // SIMPLIFIED: Apply thrust directly in ship-local coordinates
    engines.forEach((engine) => {
      // Get engine thrust values
      let engineThrust = this.getEngineThrust(engine.type);

      // Apply power efficiency for player ships
      if (this.isPlayerControlled) {
        const powerSystem = PowerSystem.getInstance();
        const efficiency = powerSystem.getEngineEfficiency();
        engineThrust *= efficiency;
      }

      // Set visual thrust level for this engine
      engine.setThrustLevel(thrustMagnitude);

      // SIMPLE LOGIC: All engines contribute to movement in the requested direction
      // The physics engine will handle the realistic movement behavior
      const thrustContribution = { x: 0, y: 0 };

      // If requesting any thrust, all engines contribute proportionally
      if (thrustMagnitude > 0) {
        thrustContribution.x = thrustInput.x * engineThrust;
        thrustContribution.y = thrustInput.y * engineThrust;
      }

      if (thrustContribution.x !== 0 || thrustContribution.y !== 0) {
        // Convert ship-local thrust to world coordinates
        const shipAngle = this.rootBody.angle;
        const worldForce = {
          x: thrustContribution.x * Math.cos(shipAngle) - thrustContribution.y * Math.sin(shipAngle),
          y: thrustContribution.x * Math.sin(shipAngle) + thrustContribution.y * Math.cos(shipAngle)
        };

        // Apply force at CENTER OF MASS to avoid unwanted torque from engine positioning
        Matter.Body.applyForce(this.rootBody, this.rootBody.position, worldForce);
      }
    });
  } private getEngineThrust(engineType: string): number {
    // Get thrust from engine part definition
    const definition = ENTITY_DEFINITIONS[engineType as EntityType];
    if (definition && definition.thrust) {
      return definition.thrust;
    }
    return 0;
  }  public applyTorque(torqueInput: number): void {
    if (this.destroyed) return;

    // More consistent rotation using Matter.js angular velocity
    const currentAngularVelocity = this.rootBody.angularVelocity;
    const maxAngularVelocity = 0.025; // Halved for more deliberate, tactical steering
    
    // Clamp torque input to prevent over-steering
    const clampedTorque = Math.max(-1.0, Math.min(1.0, torqueInput));
    
    const desiredAngularVelocity = clampedTorque * maxAngularVelocity;
    const dampening = 0.2; // Increased from 0.15 for more responsive but controlled steering

    const newAngularVelocity = currentAngularVelocity +
      (desiredAngularVelocity - currentAngularVelocity) * dampening;

    Matter.Body.setAngularVelocity(this.rootBody, newAngularVelocity);
  }public fireWeapons(): Matter.Body[] {
    if (this.destroyed) return [];

    // Check if this is the player assembly and if weapons have power
    if (this.isPlayerControlled) {
      const powerSystem = PowerSystem.getInstance();
      if (!powerSystem.canFireWeapons()) {
        // No weapon power - cannot fire
        return [];
      }
    } const currentTime = Date.now();

    // Calculate effective firing rate based on weapon power for player ships
    let effectiveFireRate = this.fireRate;
    if (this.isPlayerControlled) {
      const powerSystem = PowerSystem.getInstance();
      const weaponEfficiency = powerSystem.getWeaponEfficiency();
      // More power = faster firing (lower fire rate delay)
      // At 0% efficiency: fireRate * 3 (much slower)
      // At 100% efficiency: fireRate * 1 (normal speed)
      effectiveFireRate = this.fireRate * (3 - 2 * weaponEfficiency);
    }

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
    if (this.destroyed) return [];    // Check if this is the player assembly and if weapons/missiles have power
    if (this.isPlayerControlled) {
      const powerSystem = PowerSystem.getInstance();
      if (!powerSystem.canFireMissiles()) {
        return [];
      }
    }

    const currentTime = Date.now();

    // Calculate effective firing rate
    let effectiveFireRate = this.fireRate;
    if (this.isPlayerControlled) {
      const powerSystem = PowerSystem.getInstance();
      const weaponEfficiency = powerSystem.getWeaponEfficiency();
      effectiveFireRate = this.fireRate * (3 - 2 * weaponEfficiency);
    }

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

    if (this.isPlayerControlled) {
      const powerSystem = PowerSystem.getInstance();
      if (!powerSystem.canFireWeapons()) return [];
    }

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

    // Mark as bullet for collision detection and store the source assembly ID
    laser.isBullet = true;
    laser.timeToLive = Date.now() + 8000; // 8 seconds TTL
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
    const currentPosition = oldRootBody ? oldRootBody.position : { x: 0, y: 0 };
    const currentVelocity = oldRootBody ? oldRootBody.velocity : { x: 0, y: 0 };
    const currentAngularVelocity = oldRootBody ? oldRootBody.angularVelocity : 0;
    const currentAngle = oldRootBody ? oldRootBody.angle : 0;

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

    // Build the parts list. When the shield field is active, add a low-mass circle body
    // centred on the shield block's local position. render.visible=false so Matter.js
    // doesn't draw it — the visual overlay in renderShields() handles the appearance.
    const parts: Matter.Body[] = this.entities.map(e => e.body);
    if (this.hasActiveShield()) {
      const center = this.getShieldCenterLocal();
      const shieldCircle = Matter.Bodies.circle(center.x, center.y, this.getShieldRadius(), {
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

    // Create the replacement compound body.
    this.rootBody = Matter.Body.create({
      parts,
      isStatic: false,
      frictionAir: 0,
      friction: 0,
      restitution: 0.2
    });

    // Restore physics state.
    Matter.Body.setPosition(this.rootBody, currentPosition);
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
   * Local-space centroid of all active shield blocks.
   * Used as the centre of both the physical circle part and the visual overlay.
   */
  public getShieldCenterLocal(): { x: number; y: number } {
    const blocks = this.entities.filter(
      e => (e.type === 'Shield' || e.type === 'LargeShield') && !e.destroyed
    );
    if (blocks.length === 0) return { x: 0, y: 0 };
    return {
      x: blocks.reduce((s, e) => s + e.localOffset.x, 0) / blocks.length,
      y: blocks.reduce((s, e) => s + e.localOffset.y, 0) / blocks.length,
    };
  }

  /**
   * Radius of the shield circle in local-space pixels.
   * Measured from the shield block centroid to the farthest corner of any entity.
   */
  public getShieldRadius(): number {
    const PADDING = 28;
    const center = this.getShieldCenterLocal();
    let maxDistSq = 0;
    this.entities.forEach(entity => {
      if (entity.destroyed) return;
      const def = ENTITY_DEFINITIONS[entity.type];
      const halfW = def.width / 2;
      const halfH = def.height / 2;
      const cx = entity.localOffset.x - center.x;
      const cy = entity.localOffset.y - center.y;
      for (const dx of [-halfW, halfW]) {
        for (const dy of [-halfH, halfH]) {
          const distSq = (cx + dx) * (cx + dx) + (cy + dy) * (cy + dy);
          if (distSq > maxDistSq) maxDistSq = distSq;
        }
      }
    });
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

  public lockTarget(target: Assembly): void {
    this.lockedTargets.add(target.id);
    console.log(`🔒 ${this.shipName} locked onto ${target.shipName} `);
  }

  public unlockTarget(target: Assembly): void {
    this.lockedTargets.delete(target.id);
    if (this.primaryTarget?.id === target.id) {
      this.primaryTarget = null;
    }
    console.log(`🔓 ${this.shipName} unlocked ${target.shipName} `);
  }

  public setPrimaryTarget(target: Assembly | null): void {
    this.primaryTarget = target;
    if (target) {
      this.lockTarget(target);
      console.log(`🎯 ${this.shipName} set primary target: ${target.shipName} `);
    } else {
      console.log(`🎯 ${this.shipName} cleared primary target`);
    }
  }

  public isTargetLocked(target: Assembly): boolean {
    return this.lockedTargets.has(target.id);
  }
  public getLockedTargets(): Assembly[] {
    // This method will be called by GameEngine which should provide the current assemblies
    // For now, return empty array - GameEngine will handle the mapping
    return [];
  }

  // Auto-fire at primary target if weapons can aim at it
  public autoFireAtPrimaryTarget(): Matter.Body[] {
    if (!this.primaryTarget || this.primaryTarget.destroyed) {
      return [];
    }
    return this.fireWeapons();
  }

  // Update weapon aiming continuously (called every frame)
  public updateWeaponAiming(): void {
    if (this.destroyed) return;

    const weapons = this.entities.filter(e => e.canFire()); weapons.forEach(weapon => {
      // Weapon targeting priority order:
      // 1. Primary target assembly (highest priority)
      // 2. Mouse cursor position (fallback)
      let aimingTarget: Vector2 | null = null;

      if (this.primaryTarget && !this.primaryTarget.destroyed) {
        aimingTarget = this.primaryTarget.rootBody.position;
      } else if (this.cursorPosition) {
        aimingTarget = this.cursorPosition;
      }

      // Calculate desired aiming angle and set it as the weapon's target
      if (aimingTarget) {
        const desiredAngle = this.calculateWeaponAimAngle(weapon, aimingTarget);
        const weaponNaturalAngle = this.rootBody.angle + (weapon.rotation * Math.PI / 180);

        // Calculate the desired rotation relative to weapon's natural direction
        let desiredRelativeAngle = desiredAngle - weaponNaturalAngle;
        while (desiredRelativeAngle > Math.PI) desiredRelativeAngle -= 2 * Math.PI;
        while (desiredRelativeAngle < -Math.PI) desiredRelativeAngle += 2 * Math.PI;

        // Simple clamping to weapon's aiming arc
        const aimingArc = this.getWeaponAimingArc(weapon.type);
        const maxAngle = aimingArc / 2;
        desiredRelativeAngle = Math.max(-maxAngle, Math.min(maxAngle, desiredRelativeAngle));

        // Set the weapon's target aim angle
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

    // Create a grid map using localOffset — always grid-aligned regardless of world rotation.
    // Using entity.body.position would fail after the ship has rotated because world positions
    // are no longer integer multiples of GRID_SIZE in the cardinal directions.
    const gridMap = new Map<string, Entity>();
    this.entities.forEach(entity => {
      const gridPos = this.worldToGrid({ x: entity.localOffset.x, y: entity.localOffset.y });
      const key = `${gridPos.x},${gridPos.y}`;
      gridMap.set(key, entity);
    });

    // Check all entities for grid-adjacent connections
    let connectionCount = 0;
    this.entities.forEach(entity => {
      const entityGridPos = this.worldToGrid({ x: entity.localOffset.x, y: entity.localOffset.y });
      
      // Check all four cardinal directions for adjacent entities
      const directions = [
        { dx: 0, dy: -1, side: 'north' },   // North
        { dx: 1, dy: 0, side: 'east' },     // East
        { dx: 0, dy: 1, side: 'south' },    // South
        { dx: -1, dy: 0, side: 'west' }     // West
      ];

      directions.forEach(dir => {
        const adjacentPos = {
          x: entityGridPos.x + dir.dx,
          y: entityGridPos.y + dir.dy
        };
        const adjacentKey = `${adjacentPos.x},${adjacentPos.y}`;
        const adjacentEntity = gridMap.get(adjacentKey);

        if (adjacentEntity && this.canEntitiesConnect(entity, adjacentEntity)) {
          if (this.createGridConnection(entity, adjacentEntity, dir.side as 'north' | 'east' | 'south' | 'west')) {
            connectionCount++;
          }
        }
      });    });
    
    console.log(`🔗 ${this.shipName}: rebuilt connections using grid-based system, found ${connectionCount} connections between ${this.entities.length} entities`);
  }

  /**
   * Convert world coordinates to grid coordinates
   */
  private worldToGrid(worldPos: { x: number, y: number }): { x: number, y: number } {
    const GRID_SIZE = 16; // From GameTypes.ts
    return {
      x: Math.round(worldPos.x / GRID_SIZE),
      y: Math.round(worldPos.y / GRID_SIZE)
    };
  }

  /**
   * Check if two entities can connect based on their type compatibility
   */
  private canEntitiesConnect(entity1: Entity, entity2: Entity): boolean {
    const def1 = ENTITY_DEFINITIONS[entity1.type];
    const def2 = ENTITY_DEFINITIONS[entity2.type];
    
    if (!def1 || !def2) return false;

    // Check mutual compatibility
    return def1.canAttachTo.includes(entity2.type) && def2.canAttachTo.includes(entity1.type);
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

    // Create the connection using the first available attachment points
    // Since we're grid-based, we just need to mark them as connected
    entity1.connectTo(entity2, 0, 0); // Simplified - using first attachment points
    
    // Set side-based connections for easier lookup
    entity1.setConnectionOnSide(side, entity2.id);
    
    // Set the opposite side for entity2
    const oppositeSide = this.getOppositeSide(side);
    entity2.setConnectionOnSide(oppositeSide, entity1.id);
    
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
    isBullet?: boolean;
    timeToLive?: number;
  }
}
