import * as Matter from 'matter-js';
import Stats from 'stats.js';
import { Assembly } from './Assembly';
import { Entity } from './Entity';
import { EntityConfig, GRID_SIZE, ENTITY_DEFINITIONS, EntityType, ScenarioConfig, SCENARIOS, SHIP_SPAWN_SPACING, Vector2 } from '../../types/GameTypes';
import shipsData from '../../data/ships.json';
import { ControllerManager } from '../ai/ControllerManager';
import { FlightController } from '../ai/FlightController';
import { ControlInput } from '../ai/Controller';
import { PowerSystem } from '../systems/PowerSystem';
import { ToastSystem } from '../systems/ToastSystem';
import { SoundSystem } from '../systems/SoundSystem';
import { MissileSystem } from '../weapons/MissileSystem';
import { BeamSystem } from '../weapons/BeamSystem';
import { BlockPickupSystem } from '../systems/BlockPickupSystem';
import { RenderSystem } from './RenderSystem';
import { GridRenderer } from '../rendering/GridRenderer';
import { BlockBodyRenderer } from '../rendering/BlockBodyRenderer';
import { BlockFrillsRenderer } from '../rendering/BlockFrillsRenderer';
import { ShieldRenderer } from '../rendering/ShieldRenderer';
import { ShipHighlightRenderer } from '../rendering/ShipHighlightRenderer';
import { AimingDebugRenderer } from '../rendering/AimingDebugRenderer';
import { BlockPickupRenderer } from '../rendering/BlockPickupRenderer';
import { BeamRenderer } from '../rendering/BeamRenderer';

export class GameEngine {
  private engine: Matter.Engine;
  private render: Matter.Render; private world: Matter.World;
  private renderSystem!: RenderSystem;
  private container!: HTMLElement;
  private assemblies: Assembly[] = [];
  private bullets: Matter.Body[] = [];
  private missileSystem: MissileSystem;
  private beamSystem!: BeamSystem;
  private playerAssembly: Assembly | null = null;
  private keys: Set<string> = new Set();
  private running: boolean = false;
  private showGrid: boolean = true;
  private runner: Matter.Runner;  // Mouse interaction properties
  private mouse!: Matter.Mouse;
  private mouseConstraint!: Matter.MouseConstraint;
  private mousePosition: { x: number, y: number } = { x: 0, y: 0 };
  private mouseDown: boolean = false;
  private mouseMovementInfluence: number = 0.05; // Much more subtle mouse influence
  private maxMouseOffset: number = 100; // Maximum distance camera can be offset by mouse  // Ship selection and highlighting
  private selectedAssembly: Assembly | null = null;
  private hoveredAssembly: Assembly | null = null;
  // Player command system
  private playerCommand: string | null = null;
  private playerCommandTarget: Assembly | null = null;
  private zoomLevel: number = 0.05; // Will be calculated based on window size
  private minZoom: number = 0.01; // Allow zooming out much further
  private maxZoom: number = 4; // Allow zooming in more
  private lastFrameTime: number = 0;
  private controllerManager: ControllerManager = new ControllerManager();
  private flightController: FlightController | null = null;  // Advanced flight control  // Zoom control properties
  private baseZoomLevel: number = 0.05; // Start much further out to see more of the battlefield
  private speedBasedZoomEnabled: boolean = true;
  private lastManualZoomTime: number = 0; // Track when player last manually adjusted zoom
  private manualZoomCooldown: number = 2000; // 2 seconds of reduced speed-based zoom after manual adjustment
  // private zoomSmoothingFactor: number = 0.02; // Smooth transitions - currently unused

  // Inertial dampening — linear velocity damping applied to the player body each frame when on
  private inertialDampeningEnabled: boolean = true;
  private readonly INERTIAL_DAMPENING_FACTOR: number = 0.985; // 1.5% velocity loss per frame at 60 fps

  // Stats.js for FPS monitoring
  private stats: Stats;
  // Ship selection and player destruction callback
  public onPlayerDestroyed?: () => void;
  private scenarioConfig: ScenarioConfig = SCENARIOS['debug'];

  // Toast system for game events
  private toastSystem: ToastSystem;

  // Block pickup system for drag-and-attach building
  private blockPickupSystem!: BlockPickupSystem;

  // Current mouse position in world coordinates (updated every frame)
  private mouseWorldPos: Vector2 = { x: 0, y: 0 };

  constructor(container: HTMLElement) {
    this.container = container;
    console.log('🎮 Creating GameEngine...');

    // Create engine
    this.engine = Matter.Engine.create();
    this.world = this.engine.world;
    this.runner = Matter.Runner.create();
    console.log('⚙️  Matter.js engine created');    // Configure engine for space-like physics
    this.engine.world.gravity.y = 0; // No gravity in space
    this.engine.world.gravity.x = 0; // Ensure no horizontal gravity either

    // Configure realistic physics settings for space combat
    this.engine.constraintIterations = 8; // Higher precision for constraints
    this.engine.positionIterations = 8; // Higher precision for positions
    this.engine.velocityIterations = 8; // Higher precision for velocities

    // Set timing for more stable physics
    this.engine.timing.timeScale = 1.0;

    // Set global friction to zero for space-like physics
    this.engine.world.bodies.forEach(body => {
      body.frictionAir = 0; // No air resistance in space
      body.friction = 0; // No surface friction in space
    });    // Add event listener to ensure all new bodies have realistic physics settings
    Matter.Events.on(this.engine, 'beforeUpdate', () => {
      this.engine.world.bodies.forEach(body => {
        // Remove all friction for space physics
        if (body.frictionAir !== 0) body.frictionAir = 0;
        if (body.friction !== 0) body.friction = 0;

        // Apply angular damping to spinning debris to make collisions more realistic
        if (Math.abs(body.angularVelocity) > 0.1) {
          Matter.Body.setAngularVelocity(body, body.angularVelocity * 0.98); // 2% angular velocity loss per frame
        }
      });
    });

    // Create renderer with debug options - matching MVP spec
    const containerWidth = container.clientWidth || 800;
    const containerHeight = container.clientHeight || 600;

    console.log(`📐 Container dimensions: ${containerWidth}x${containerHeight}`);

    // Calculate appropriate default zoom based on window size
    this.calculateDefaultZoom(containerWidth, containerHeight);

    this.render = Matter.Render.create({
      element: container,
      engine: this.engine, options: {
        width: containerWidth,
        height: containerHeight,
        wireframes: false, // Turn off wireframes to see colors
        background: '#000011',
        showVelocity: false, // Hide velocity vectors
        showCollisions: false, // Hide collision detection
        showBounds: false, // Hide bounding boxes
        showAxes: false, // Hide axes
        showAngleIndicator: false, // Hide angle indicators
        showIds: false // Hide IDs for cleaner look
      }
    }); console.log('🖼️  Renderer created');
    console.log('Canvas element:', this.render.canvas);    // Initialize Stats.js for FPS monitoring
    this.stats = new Stats();
    this.stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
    this.stats.dom.style.position = 'absolute';
    this.stats.dom.style.right = '10px';
    this.stats.dom.style.top = '10px';
    this.stats.dom.style.zIndex = '1000';
    container.appendChild(this.stats.dom);    // Initialize toast system
    this.toastSystem = new ToastSystem(container);

    // Initialize missile system
    this.missileSystem = new MissileSystem(this.world);

    // Set missile system reference in controller manager
    this.controllerManager.setMissileSystem(this.missileSystem);

    // Initialize beam system
    this.beamSystem = new BeamSystem(
      (entity, hitAssembly, sourceAssemblyId) =>
        this.handleBeamEntityDestroyed(entity, hitAssembly, sourceAssemblyId)
    );
    this.controllerManager.setBeamSystem(this.beamSystem);

    // Initialize block pickup system
    this.blockPickupSystem = new BlockPickupSystem(
      (body) => this.removeBodyWithParts(body),
      (body) => Matter.World.add(this.world, body),
      // onPickUp: remove from tracked assembly list when grabbed
      (assembly) => { this.assemblies = this.assemblies.filter(a => a !== assembly); },
      // onDrop: add back to tracked assembly list when dropped without snapping
      (assembly) => { this.assemblies.push(assembly); }
    );

    // Initialize mouse interaction
    this.setupMouseInteraction();
    this.setupEventListeners();
    this.setupCollisionDetection();

    // Build the rendering pipeline
    this.setupRenderSystem();
  }

  private calculateDefaultZoom(containerWidth: number, containerHeight: number): void {
    // Base zoom calculation - larger windows should zoom out more to show more battlefield
    const minDimension = Math.min(containerWidth, containerHeight);
    const maxDimension = Math.max(containerWidth, containerHeight);    // Calculate base zoom - smaller windows get closer zoom, larger windows get further zoom
    let baseZoom = 0.3; // Default for small screens - much further out

    if (minDimension >= 800) {
      // Large screens - zoom out more to show more of the battlefield
      const sizeMultiplier = Math.min(minDimension / 800, 2.5); // Cap at 2.5x multiplier
      baseZoom = 0.3 / sizeMultiplier; // Inverse relationship - larger screen = smaller zoom = more zoomed out
    } else if (minDimension >= 600) {
      // Medium screens - moderate zoom out
      const sizeMultiplier = minDimension / 600;
      baseZoom = 0.3 / (1 + (sizeMultiplier - 1) * 0.5);
    }

    // Adjust for very wide screens (ultrawide monitors) - zoom out even more
    const aspectRatio = maxDimension / minDimension;
    if (aspectRatio > 1.8) {
      const wideScreenMultiplier = Math.min(aspectRatio / 1.8, 1.5);
      baseZoom = baseZoom / wideScreenMultiplier;
    }    // Ensure the calculated zoom is within bounds
    this.baseZoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, baseZoom));
    this.zoomLevel = this.baseZoomLevel; // Initialize current zoom

    console.log(`🔍 Calculated default zoom: ${this.baseZoomLevel.toFixed(2)} for ${containerWidth}x${containerHeight}`);
  }

  // Calculate zoom so the player's ship occupies roughly 1/SHIP_ZOOM_BUFFER of the viewport's
  // constrained dimension — consistent regardless of ship size or screen resolution.
  private calculateZoomForAssembly(assembly: Assembly): void {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    assembly.entities.forEach(entity => {
      const def = ENTITY_DEFINITIONS[entity.type];
      const halfW = def.width / 2;
      const halfH = def.height / 2;
      minX = Math.min(minX, entity.localOffset.x - halfW);
      minY = Math.min(minY, entity.localOffset.y - halfH);
      maxX = Math.max(maxX, entity.localOffset.x + halfW);
      maxY = Math.max(maxY, entity.localOffset.y + halfH);
    });

    const shipWidth = maxX - minX;
    const shipHeight = maxY - minY;

    // Buffer factor: ship's limiting dimension fills 1/SHIP_ZOOM_BUFFER of the viewport.
    // Value of 7 gives ~14% ship coverage with good peripheral visibility for combat.
    const SHIP_ZOOM_BUFFER = 7;
    const canvasW = this.render.canvas.width;
    const canvasH = this.render.canvas.height;
    const zoomX = canvasW / (shipWidth * SHIP_ZOOM_BUFFER);
    const zoomY = canvasH / (shipHeight * SHIP_ZOOM_BUFFER);
    const targetZoom = Math.min(zoomX, zoomY);

    this.baseZoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, targetZoom));
    this.zoomLevel = this.baseZoomLevel;

    console.log(`🔍 Ship-based zoom: ${this.baseZoomLevel.toFixed(3)} (ship bounds: ${Math.round(shipWidth)}×${Math.round(shipHeight)})`);
  }

  private setInitialCameraView(): void {
    // Set camera to center (0,0) with the calculated zoom level
    const width = this.render.canvas.width / this.zoomLevel;
    const height = this.render.canvas.height / this.zoomLevel;

    Matter.Render.lookAt(this.render, {
      min: { x: -width / 2, y: -height / 2 },
      max: { x: width / 2, y: height / 2 }
    });

    console.log(`📷 Initial camera view set with zoom ${this.zoomLevel.toFixed(2)}`);
  }

  private setupEventListeners(): void {    // Keyboard input
    document.addEventListener('keydown', (event) => {
      this.keys.add(event.key.toLowerCase());

      // Resume audio context on user interaction (browser autoplay policy)
      SoundSystem.getInstance().resume();
        // Handle special keys
      switch (event.key.toLowerCase()) {
        case '1':
          //this.spawnRandomEnemyAssembly();
          break;
        case '3':
          this.spawnDebris(Math.random() * 400 - 200, Math.random() * 400 - 200);
          break;
        case '4':
          this.spawnMissileCorvette(Math.random() * 400 - 200, Math.random() * 400 - 200, false);
          break;
        case 'r':
          if (this.blockPickupSystem.isHolding()) {
            this.blockPickupSystem.rotateHeld(); // Rotate held block 90° CCW
          } else {
            this.initializeBattle(); // Restart battle
          }
          break;
        case 'g':
          this.toggleGrid();
          break;
        case 'e':
          if (this.canPlayerEject()) {
            this.ejectPlayer();
          }
          break;
        case 't':
          this.selectNearestEnemy();
          break;
        case 'y':
          this.clearAllTargets();
          break;
        case 'u':
          this.cycleTargets();
          break;
      }
    });

    document.addEventListener('keyup', (event) => {
      this.keys.delete(event.key.toLowerCase());
    });    // Handle window resize
    window.addEventListener('resize', () => {
      const newWidth = this.render.element.clientWidth;
      const newHeight = this.render.element.clientHeight;

      this.render.canvas.width = newWidth;
      this.render.canvas.height = newHeight;
    });
  } private setupCollisionDetection(): void {
    Matter.Events.on(this.engine, 'collisionStart', (event: { pairs: { bodyA: Matter.Body; bodyB: Matter.Body }[] }) => {
      event.pairs.forEach(pair => {
        const { bodyA, bodyB } = pair;

        // Check for bullet/laser collisions
        if (bodyA.isBullet && bodyB.entity) {
          this.handleBulletHit(bodyA, bodyB.entity);
        } else if (bodyB.isBullet && bodyA.entity) {
          this.handleBulletHit(bodyB, bodyA.entity);
        } else if (bodyA.isBullet && (bodyB as any).isShieldPart) {
          this.handleBulletHitShield(bodyA, (bodyB as any).parentAssembly);
        } else if (bodyB.isBullet && (bodyA as any).isShieldPart) {
          this.handleBulletHitShield(bodyB, (bodyA as any).parentAssembly);
        }
        // Check for missile collisions
        else if ((bodyA as any).isMissile && bodyB.entity) {
          this.handleMissileHit((bodyA as any).missile, bodyB.entity);
        } else if ((bodyB as any).isMissile && bodyA.entity) {
          this.handleMissileHit((bodyB as any).missile, bodyA.entity);
        } else if ((bodyA as any).isMissile && (bodyB as any).isShieldPart) {
          this.handleMissileHitShield((bodyA as any).missile, (bodyB as any).parentAssembly);
        } else if ((bodyB as any).isMissile && (bodyA as any).isShieldPart) {
          this.handleMissileHitShield((bodyB as any).missile, (bodyA as any).parentAssembly);
        }
        // Check for entity-to-entity collisions (for flash effect)
        else if (bodyA.entity && bodyB.entity) {
          this.handleEntityCollision(bodyA.entity, bodyB.entity);
        } else if (bodyA.entity && (bodyB as any).isShieldPart) {
          this.handleEntityHitShield(bodyA.entity, (bodyB as any).parentAssembly);
        } else if ((bodyA as any).isShieldPart && bodyB.entity) {
          this.handleEntityHitShield(bodyB.entity, (bodyA as any).parentAssembly);
        }
      });
    });

    // NOTE: No collisionActive handler — re-triggering the flash every frame for sustained
    // contact caused a permanent white glow.  collisionStart is sufficient for impact feedback.
  } private handleEntityCollision(entityA: Entity, entityB: Entity): void {
    // Flash on impact for any entity collision
    if (!entityA.destroyed && !entityA.isFlashing) {
      entityA.triggerCollisionFlash();
    }
    if (!entityB.destroyed && !entityB.isFlashing) {
      entityB.triggerCollisionFlash();
    }

    // Calculate realistic collision impact based on mass and velocity differences
    const massA = entityA.body.mass;
    const massB = entityB.body.mass;
    const velocityA = Matter.Vector.magnitude(entityA.body.velocity);
    const velocityB = Matter.Vector.magnitude(entityB.body.velocity);

    // Calculate relative impact force
    const relativeVelocity = Math.abs(velocityA - velocityB);
    const totalMass = massA + massB;
    const massRatio = Math.min(massA, massB) / Math.max(massA, massB);

    // Only cause collision damage if there's significant impact
    if (relativeVelocity > 3 && massRatio > 0.1) {
      const impactForce = (relativeVelocity * Math.min(massA, massB)) / 1000;
      if (impactForce > 1) {
        const damage = Math.floor(impactForce);
        const damageA = Math.floor(damage * (massB / totalMass));
        const damageB = Math.floor(damage * (massA / totalMass));
        const now = Date.now();

        // Shield interception: route collision damage through the shield field
        // when active. Matter.js still applies the physical impulse normally.
        const assemblyA = this.assemblies.find(a => a.entities.includes(entityA));
        const assemblyB = this.assemblies.find(a => a.entities.includes(entityB));

        if (damageA > 0 && !(assemblyA?.damageShield(damageA, now))) {
          entityA.takeDamage(damageA);
        }
        if (damageB > 0 && !(assemblyB?.damageShield(damageB, now))) {
          entityB.takeDamage(damageB);
        }
      }
    }
  } private handleBulletHit(bullet: Matter.Body, entity: Entity): void {
    const LASER_DAMAGE = 10;
    const sourceAssemblyId = (bullet as any).sourceAssemblyId;
    const hitAssembly = this.assemblies.find(a => a.entities.includes(entity));

    if (sourceAssemblyId) {
      if (hitAssembly && hitAssembly.id === sourceAssemblyId) return; // self-hit

      if (hitAssembly) {
        const sourceAssembly = this.assemblies.find(a => a.id === sourceAssemblyId);
        hitAssembly.lastHitByAssemblyId = sourceAssemblyId;
        hitAssembly.lastHitByPlayer = sourceAssembly?.isPlayerControlled || false;
      }
    }

    Matter.World.remove(this.world, bullet);
    this.bullets = this.bullets.filter(b => b !== bullet);

    // Play impact sound
    SoundSystem.getInstance().playLaserImpact();

    // Shield interception — if active the field absorbs the hit entirely.
    if (hitAssembly?.damageShield(LASER_DAMAGE, Date.now())) {
      hitAssembly.entities
        .filter(e => (e.type === 'Shield' || e.type === 'LargeShield') && !e.destroyed)
        .forEach(e => e.triggerCollisionFlash());
      return;
    }

    if (!entity.destroyed) entity.triggerCollisionFlash();

    const entityDestroyed = entity.takeDamage(LASER_DAMAGE);
    if (!entityDestroyed) return;

    if (!hitAssembly) return;
    this.processEntityDestruction(entity, hitAssembly);
  }

  /**
   * Shared destruction cascade used by both bullet hits and beam hits.
   * Call only after entity.takeDamage() has returned true (i.e. the entity is confirmed destroyed).
   */
  private processEntityDestruction(entity: Entity, assembly: Assembly): void {
    SoundSystem.getInstance().playBlockDestroyed();

    // Capture the old compound body BEFORE removeEntity() can replace assembly.rootBody
    // via createFreshBody().  We need it to properly swap the physics world entry.
    const oldRootBody = assembly.rootBody;
    const wasPlayerControlled = assembly.isPlayerControlled;

    const newAssemblies = assembly.removeEntity(entity);

    if (newAssemblies.length > 1) {
      // Ship broke apart — remove old compound (+ parts) and register fragments.
      SoundSystem.getInstance().playShipBreakApart();
      this.removeBodyWithParts(oldRootBody);
      assembly.pendingBodySwap = null; // split path never sets pendingBodySwap

      const assemblyIndex = this.assemblies.findIndex(a => a === assembly);
      if (assemblyIndex !== -1) {
        this.assemblies.splice(assemblyIndex, 1, ...newAssemblies);

        newAssemblies.forEach(newAssembly => {
          Matter.World.add(this.world, newAssembly.rootBody);

          if (newAssembly.entities.length === 1 && !newAssembly.hasControlCenter()) {
            newAssembly.setTeam(-1);
            newAssembly.setShipName(`${newAssembly.entities[0].type} Debris`);
          }

          // Restore AI controller on the fragment that kept the cockpit.
          if (!assembly.isPlayerControlled && newAssembly.hasControlCenter()) {
            const ai = this.controllerManager.createAIController(newAssembly);
            ai.setAggressionLevel(0.8 + Math.random() * 0.4);
          }

          if (assembly.isPlayerControlled && newAssembly.isPlayerControlled) {
            this.playerAssembly = newAssembly;
            this.toastSystem.showWarning(`Ship damaged! Control transferred to ${newAssembly.shipName}`);
          }
        });

        if (assembly.isPlayerControlled && !this.playerAssembly) {
          const newPlayerAssembly = newAssemblies.find(a => a.hasControlCenter());
          if (newPlayerAssembly) {
            this.playerAssembly = newPlayerAssembly;
            newPlayerAssembly.isPlayerControlled = true;
          }
        }

        // When the player's ship fragments and the cockpit survives as a new assembly,
        // reinitialize the controller stack — the old controller is keyed to the old
        // assembly ID and will be auto-removed from ControllerManager on the next tick,
        // leaving the cockpit with no way to receive player input.
        if (wasPlayerControlled && this.playerAssembly && this.playerAssembly !== assembly) {
          const newPlayerAssembly = this.playerAssembly;
          this.controllerManager.removeController(assembly.id);
          this.flightController = new FlightController(newPlayerAssembly);
          this.controllerManager.createPlayerController(newPlayerAssembly);
          PowerSystem.getInstance().setPlayerAssembly(newPlayerAssembly);
        }
      }
    } else if (newAssemblies.length === 1) {
      // Ship stayed intact — createFreshBody() was called, swap old compound for new.
      this.removeBodyWithParts(oldRootBody);
      Matter.World.add(this.world, assembly.rootBody);
      assembly.pendingBodySwap = null; // handled here, not in the game loop
    } else {
      // All entities gone — assembly.destroyed is already true; cleanupDestroyedAssemblies
      // will remove it from this.assemblies.  Remove the old body from the world now so
      // collision detection against its orphaned parts stops immediately.
      this.removeBodyWithParts(oldRootBody);
      assembly.pendingBodySwap = null;
    }
  }

  /** Callback invoked by BeamSystem when a beam destroys an entity. */
  private handleBeamEntityDestroyed(entity: Entity, hitAssembly: Assembly, sourceAssemblyId: string): void {
    const sourceAssembly = this.assemblies.find(a => a.id === sourceAssemblyId);
    hitAssembly.lastHitByAssemblyId = sourceAssemblyId;
    hitAssembly.lastHitByPlayer = sourceAssembly?.isPlayerControlled ?? false;
    SoundSystem.getInstance().playLaserImpact();
    this.processEntityDestruction(entity, hitAssembly);
  }

  private handleMissileHit(missile: any, entity: Entity): void {
    // Use the missile system to handle the hit
    this.missileSystem.handleMissileHit(missile, entity);
  }

  private handleBulletHitShield(bullet: Matter.Body, shieldAssembly: Assembly): void {
    const LASER_DAMAGE = 10;
    const sourceAssemblyId = (bullet as any).sourceAssemblyId;

    // Self-hit prevention — don't let a ship's own lasers hit its own shield.
    if (sourceAssemblyId && shieldAssembly.id === sourceAssemblyId) return;

    if (sourceAssemblyId) {
      const sourceAssembly = this.assemblies.find(a => a.id === sourceAssemblyId);
      shieldAssembly.lastHitByAssemblyId = sourceAssemblyId;
      shieldAssembly.lastHitByPlayer = sourceAssembly?.isPlayerControlled || false;
    }

    Matter.World.remove(this.world, bullet);
    this.bullets = this.bullets.filter(b => b !== bullet);
    SoundSystem.getInstance().playLaserImpact();

    shieldAssembly.damageShield(LASER_DAMAGE, Date.now());
    shieldAssembly.entities
      .filter(e => (e.type === 'Shield' || e.type === 'LargeShield') && !e.destroyed)
      .forEach(e => e.triggerCollisionFlash());

    // Swap the compound body if the shield just collapsed (shield circle removed).
    if (shieldAssembly.pendingBodySwap) {
      this.removeBodyWithParts(shieldAssembly.pendingBodySwap.oldBody);
      Matter.World.add(this.world, shieldAssembly.rootBody);
      shieldAssembly.pendingBodySwap = null;
    }
  }

  private handleMissileHitShield(missile: any, shieldAssembly: Assembly): void {
    if (!missile || !shieldAssembly) return;

    // Launch delay — missiles shouldn't collide immediately after launch.
    if (missile.age < missile.launchCollisionDelay) return;

    // Self-hit prevention.
    if (missile.sourceAssemblyId === shieldAssembly.id) return;

    SoundSystem.getInstance().playMissileExplosion();
    shieldAssembly.damageShield(missile.getDamage(), Date.now());
    shieldAssembly.entities
      .filter(e => (e.type === 'Shield' || e.type === 'LargeShield') && !e.destroyed)
      .forEach(e => e.triggerCollisionFlash());
    missile.destroy();

    // Swap the compound body if the shield just collapsed.
    if (shieldAssembly.pendingBodySwap) {
      this.removeBodyWithParts(shieldAssembly.pendingBodySwap.oldBody);
      Matter.World.add(this.world, shieldAssembly.rootBody);
      shieldAssembly.pendingBodySwap = null;
    }
  }

  private handleEntityHitShield(entity: Entity, shieldAssembly: Assembly): void {
    if (!shieldAssembly || entity.destroyed) return;

    const entityAssembly = this.assemblies.find(a => a.entities.includes(entity));
    // Skip same-assembly (cannot happen with compound parts but guard anyway).
    if (entityAssembly?.id === shieldAssembly.id) return;

    // Flash shield blocks on impact.
    shieldAssembly.entities
      .filter(e => (e.type === 'Shield' || e.type === 'LargeShield') && !e.destroyed)
      .forEach(e => { if (!e.isFlashing) e.triggerCollisionFlash(); });
    if (!entity.isFlashing) entity.triggerCollisionFlash();

    // Collision damage — same formula as handleEntityCollision.
    const entityVel = Matter.Vector.magnitude(entity.body.velocity);
    const shieldVel = Matter.Vector.magnitude(shieldAssembly.rootBody.velocity);
    const relativeVelocity = Math.abs(entityVel - shieldVel);

    if (relativeVelocity > 3) {
      const massEntity = entity.body.mass;
      const massShield = shieldAssembly.rootBody.mass;
      const massRatio = Math.min(massEntity, massShield) / Math.max(massEntity, massShield);
      if (massRatio > 0.1) {
        const impactForce = (relativeVelocity * Math.min(massEntity, massShield)) / 1000;
        if (impactForce > 1) {
          const damage = Math.floor(impactForce);
          const totalMass = massEntity + massShield;
          const now = Date.now();
          const damageEntity = Math.floor(damage * (massShield / totalMass));
          const damageShieldSide = Math.floor(damage * (massEntity / totalMass));

          if (damageEntity > 0 && !(entityAssembly?.damageShield(damageEntity, now))) {
            entity.takeDamage(damageEntity);
          }
          shieldAssembly.damageShield(damageShieldSide, now);
          // pendingBodySwap from shield collapse (if any) is handled by the game loop.
        }
      }
    }
  }

  public start(): void {
    console.log('🚀 Starting GameEngine...');
    if (this.running) return;

    this.running = true;

    // Initialize sound system (requires user interaction to have occurred)
    SoundSystem.getInstance().init();
    SoundSystem.getInstance().startMusic();

    // Start renderer
    console.log('🖼️  About to start renderer...');
    console.log('Render object:', this.render);
    console.log('Render canvas:', this.render.canvas);
    this.renderSystem.start();
    console.log('🖼️  Renderer started');

    // Apply initial zoom and center camera
    this.setInitialCameraView();

    // Start engine with runner
    Matter.Runner.run(this.runner, this.engine);
    console.log('⚙️  Engine runner started');// Start game loop
    this.gameLoop();
    console.log('🔄 Game loop started');
    // Spawn ships to demonstrate team-based AI combat
    console.log('⚔️ About to initialize team battle...');
    this.initializeBattle();
  }
  public stop(): void {
    this.running = false;
    this.renderSystem.stop();
    Matter.Runner.stop(this.runner);
    Matter.Engine.clear(this.engine);

    // Cleanup missile system
    this.missileSystem.cleanup();

    // Stop music
    SoundSystem.getInstance().stopMusic();
  } private gameLoop(): void {
    if (!this.running) return;

    // Calculate delta time
    const currentTime = performance.now();
    const deltaTime = (currentTime - (this.lastFrameTime || currentTime)) / 1000; // Convert ms to seconds
    this.lastFrameTime = currentTime;

    // Update cursor position for weapon aiming (every frame)
    this.updateCursorWorldPosition();

    // Update controllers (handles both player input and AI)
    const newBullets = this.controllerManager.update(deltaTime, this.assemblies);

    // Add new bullets to physics world
    if (newBullets.length > 0) {
      // Play laser fire sound (once per batch to avoid audio spam)
      SoundSystem.getInstance().playLaserFire();
    }
    newBullets.forEach(bullet => {
      Matter.World.add(this.world, bullet);
      this.bullets.push(bullet);
    });    // Handle missile launches from all assemblies (REMOVED - missiles now fire with weapons)
    // this.assemblies.forEach(assembly => {
    //   const missileRequests = assembly.getMissileLaunchRequests();
    //   missileRequests.forEach(request => {
    //     this.missileSystem.createMissile(
    //       request.position,
    //       request.angle,
    //       request.missileType,
    //       request.sourceAssemblyId,
    //       request.targetAssembly
    //     );
    //   });
    // });

    // Handle additional player input (mouse controls, etc.)
    this.handlePlayerInput();// Update assemblies (deltaTime is in seconds; update() expects milliseconds)
    const deltaTimeMs = deltaTime * 1000;
    this.assemblies.forEach(assembly => {
      assembly.update(deltaTimeMs);
      assembly.updateWeaponAiming();
    });

    // Process any body swaps queued by Assembly.update() (e.g. collision damage destroyed an
    // entity mid-frame).  handleBulletHit clears pendingBodySwap itself; this catches the
    // collision-damage path where Assembly.update() calls createFreshBody() independently.
    this.assemblies.forEach(assembly => {
      if (assembly.pendingBodySwap) {
        this.removeBodyWithParts(assembly.pendingBodySwap.oldBody);
        Matter.World.add(this.world, assembly.rootBody);
        assembly.pendingBodySwap = null;
      }
    });

    // Update BlockPickupSystem: reposition ghost and refresh snap candidate
    if (this.blockPickupSystem.isHolding()) {
      this.blockPickupSystem.update(this.mouseWorldPos, this.playerAssembly);
    }

    // Update entity flash effects
    this.updateEntityFlashes(deltaTime);

    // Update bullets (TTL, out-of-bounds removal)
    this.updateBullets();

    // Update missile system (targeting, steering, fuel consumption)
    this.missileSystem.update(deltaTime, this.assemblies);

    // Update beam system (age out expired visual beams)
    this.beamSystem.update(deltaTime);

    // Clean up destroyed assemblies
    this.cleanupDestroyedAssemblies();    // Check if player is destroyed and call callback
    if (!this.playerAssembly || this.playerAssembly.destroyed || !this.playerAssembly.hasControlCenter()) {
      const wasPlayerDestroyed = this.playerAssembly?.destroyed || (this.playerAssembly && !this.playerAssembly.hasControlCenter());

      if (wasPlayerDestroyed && this.onPlayerDestroyed) {
        console.log('💀 Player destroyed - calling destruction callback');
        // Drop any held block before clearing player reference
        if (this.blockPickupSystem.isHolding()) {
          this.blockPickupSystem.forceDropAtCurrentPosition();
        }
        this.playerAssembly = null;
        this.onPlayerDestroyed();
      } else {
        this.findPlayerAssembly();
      }
    }

    // Execute player commands (follow, orbit, lockOn, etc.)
    this.executePlayerCommands();

    // Update camera with mouse influence
    this.updateCameraWithMouse();

    // Update zoom based on speed
    this.updateSpeedBasedZoom();

    // Continue loop
    requestAnimationFrame(() => this.gameLoop());
  }
  private updateEntityFlashes(deltaTime: number): void {
    this.assemblies.forEach(assembly => {
      assembly.entities.forEach(entity => {
        entity.updateFlash(deltaTime);
        entity.updateVisualEffects(deltaTime); // Update weapon aiming and other visual effects
      });
    });
  } private handlePlayerInput(): void {
    if (!this.playerAssembly || this.playerAssembly.destroyed) return;

    // Create control input based on keyboard and mouse
    const input: ControlInput = {
      thrust: { x: 0, y: 0 },
      torque: 0,
      fire: false
    };

    // Keyboard thrust controls - ship-local coordinates
    if (this.keys.has('w') || this.keys.has('arrowup')) {
      input.thrust = {
        x: 1.0, // Forward in ship-local coordinates
        y: 0
      };
    }

    // Reverse thrust
    if (this.keys.has('s') || this.keys.has('arrowdown')) {
      input.thrust = {
        x: -0.5, // Reverse in ship-local coordinates
        y: 0
      };
    }

    // Manual rotation only - no automatic aiming for the ship assembly
    if (this.keys.has('a') || this.keys.has('arrowleft')) {
      input.torque = -1.0; // Manual left rotation
    } else if (this.keys.has('d') || this.keys.has('arrowright')) {
      input.torque = 1.0; // Manual right rotation
    }
    // No automatic rotation - turrets will aim independently

    // Firing
    let isManuallyFiring = false;
    if (this.keys.has(' ') || this.mouseDown) {
      input.fire = true;
      isManuallyFiring = true;
    }

    // Auto-fire at primary target if not manually firing
    if (!isManuallyFiring && this.playerAssembly.primaryTarget && !this.playerAssembly.primaryTarget.destroyed) {
      const targetPosition = this.playerAssembly.primaryTarget.rootBody.position;
      // Check if any weapon can aim at the target
      const canAimAtTarget = this.playerAssembly.entities.some(entity =>
        entity.canFire() && this.playerAssembly!.canWeaponAimAtTarget(entity, targetPosition)
      );

      if (canAimAtTarget) {
        input.fire = true;
      }
    }

    // Send input to player controller
    this.controllerManager.setPlayerInput(input);    // Apply rotational dampening directly (this is physics, not control)
    if (input.torque === 0) {
      const currentAngularVel = this.playerAssembly.rootBody.angularVelocity;
      const dampening = 0.98; // Reduced from 0.95 to be less aggressive and let Assembly's control handle it
      Matter.Body.setAngularVelocity(this.playerAssembly.rootBody, currentAngularVel * dampening);
    }

    // Apply inertial dampening — damp lateral and forward velocity each frame
    if (this.inertialDampeningEnabled) {
      const vel = this.playerAssembly.rootBody.velocity;
      Matter.Body.setVelocity(this.playerAssembly.rootBody, {
        x: vel.x * this.INERTIAL_DAMPENING_FACTOR,
        y: vel.y * this.INERTIAL_DAMPENING_FACTOR
      });
    }
  }

  private updateBullets(): void {
    const bulletsToRemove: Matter.Body[] = [];

    this.bullets.forEach(bullet => {
      // Check time to live
      if (bullet.timeToLive && Date.now() > bullet.timeToLive) {
        bulletsToRemove.push(bullet);
      }

      // Check if bullet is out of bounds
      const bounds = this.render.bounds;
      if (bullet.position.x < bounds.min.x - 100 ||
        bullet.position.x > bounds.max.x + 100 ||
        bullet.position.y < bounds.min.y - 100 ||
        bullet.position.y > bounds.max.y + 100) {
        bulletsToRemove.push(bullet);
      }
    });

    // Remove expired bullets
    bulletsToRemove.forEach(bullet => {
      Matter.World.remove(this.world, bullet);
      this.bullets = this.bullets.filter(b => b !== bullet);
    });
  }

  /**
   * Removes a compound body AND all its individual part bodies from the physics world.
   * Matter.js adds each part body to world.bodies when a compound is added, so removing
   * only the compound leaves orphaned part bodies that continue participating in collision
   * detection with stale entity references.
   */
  public removeBodyWithParts(body: Matter.Body): void {
    if (!body) return;
    // parts[0] is the compound itself; parts[1..N] are the individual sub-bodies.
    if (body.parts && body.parts.length > 1) {
      for (let i = 1; i < body.parts.length; i++) {
        Matter.World.remove(this.world, body.parts[i]);
      }
    }
    Matter.World.remove(this.world, body);
  }

  private cleanupDestroyedAssemblies(): void {
    const destroyedAssemblies = this.assemblies.filter(a => a.destroyed || a.entities.length === 0);

    destroyedAssemblies.forEach(assembly => {
      if (assembly.lastHitByPlayer) {
        this.toastSystem.showKill("You", assembly.shipName);
      } else if (assembly.lastHitByAssemblyId) {
        const killerAssembly = this.assemblies.find(a => a.id === assembly.lastHitByAssemblyId);
        const killerName = killerAssembly ? killerAssembly.shipName : "Unknown";
        this.toastSystem.showKill(killerName, assembly.shipName);
      }

      // Remove the compound and all its part bodies so no orphaned shapes remain.
      this.removeBodyWithParts(assembly.rootBody);

      if (this.selectedAssembly === assembly) this.selectedAssembly = null;
      if (this.hoveredAssembly === assembly) this.hoveredAssembly = null;
    });

    this.assemblies = this.assemblies.filter(a => !a.destroyed && a.entities.length > 0);
  }

  private findPlayerAssembly(): void {
    // Find an assembly with a control center
    const controllableAssembly = this.assemblies.find(a =>
      a.hasControlCenter() && !a.destroyed
    ); if (controllableAssembly) {
      this.playerAssembly = controllableAssembly;
      this.playerAssembly.isPlayerControlled = true;

      // Initialize power system with new player assembly
      const powerSystem = PowerSystem.getInstance();
      powerSystem.setPlayerAssembly(this.playerAssembly);
    }
  }

  private toggleGrid(): void {
    this.showGrid = !this.showGrid;
  }
  /*
  private spawnShip(x: number, y: number, isPlayer: boolean): void {
    try {
      console.log(`🔧 Spawning ship at (${x}, ${y}), isPlayer: ${isPlayer}`);

      // Get a random ship from the JSON data
      const ships = shipsData.ships;
      console.log(`📋 Available ships: ${ships.length}`);

      const randomShip = ships[Math.floor(Math.random() * ships.length)];
      console.log(`🎲 Selected ship: ${randomShip.name} with ${randomShip.parts.length} parts`);

      const assembly = new Assembly(randomShip.parts as EntityConfig[], { x, y });
      console.log(`🔨 Created assembly with ID: ${assembly.id}`);

      this.assemblies.push(assembly);
      Matter.World.add(this.world, assembly.rootBody);
      console.log(`🌍 Added to world, total assemblies: ${this.assemblies.length}`);      // Set as player if requested
      if (isPlayer && (!this.playerAssembly || this.playerAssembly.destroyed)) {
        this.playerAssembly = assembly;
        assembly.isPlayerControlled = true;
        this.flightController = new FlightController(assembly); // Initialize advanced flight control
        console.log('👤 Set as player assembly with flight controller');
      }
    } catch (error) {
      console.error('❌ Error spawning ship:', error);
    }
  }
  */private spawnMissileCorvette(x: number, y: number, isPlayer: boolean): void {
    try {
      console.log(`🚀 Spawning Missile Corvette at (${x}, ${y}), isPlayer: ${isPlayer}`);

      // Find the Missile Corvette ship in the JSON data
      const ships = shipsData.ships;
      const missileCorvette = ships.find(ship => ship.name === 'Missile Corvette');

      if (!missileCorvette) {
        console.error('❌ Missile Corvette ship not found in ships data');
        return;
      }

      console.log(`🎯 Found Missile Corvette with ${missileCorvette.parts.length} parts`);

      const assembly = new Assembly(missileCorvette.parts as EntityConfig[], { x, y });
      console.log(`🔨 Created Missile Corvette assembly with ID: ${assembly.id}`);

      this.assemblies.push(assembly);
      Matter.World.add(this.world, assembly.rootBody);
      console.log(`🌍 Added to world, total assemblies: ${this.assemblies.length}`);

      // Set as player if requested
      if (isPlayer && (!this.playerAssembly || this.playerAssembly.destroyed)) {
        this.playerAssembly = assembly;
        assembly.isPlayerControlled = true;
        this.flightController = new FlightController(assembly);
        console.log('👤 Set Missile Corvette as player assembly with flight controller');
      }
    } catch (error) {
      console.error('❌ Error spawning Missile Corvette:', error);
    }
  }

  // Add debris spawning method
  private spawnDebris(x: number, y: number, entityType?: EntityType): void {
    try {
      console.log(`🗑️ Spawning debris at (${x}, ${y})`);

      // Pick a random entity type for debris if not specified
      const debrisTypes: EntityType[] = ['Hull', 'Engine', 'Gun', 'PowerCell', 'HeavyHull', 'LargePowerCell'];
      const selectedType = entityType || debrisTypes[Math.floor(Math.random() * debrisTypes.length)];

      console.log(`🎲 Selected debris type: ${selectedType}`);

      // Create debris config
      const debrisConfig: EntityConfig = {
        type: selectedType,
        x: 0,
        y: 0,
        rotation: Math.floor(Math.random() * 4) * 90, // Random rotation (0, 90, 180, 270)
        health: 1, // Very low health for debris
        maxHealth: 10
      };

      const debrisAssembly = new Assembly([debrisConfig], { x, y });
      console.log(`🔨 Created debris assembly with ID: ${debrisAssembly.id}`);

      // Set as neutral team (no team affiliation for debris)
      debrisAssembly.setTeam(-1);
      debrisAssembly.setShipName(`${selectedType} Debris`);

      // Add random initial velocity to make it float around
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 2; // Random speed between 0.5-2.5
      Matter.Body.setVelocity(debrisAssembly.rootBody, {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed
      });

      // Add random spin
      Matter.Body.setAngularVelocity(debrisAssembly.rootBody, (Math.random() - 0.5) * 0.3);

      this.assemblies.push(debrisAssembly);
      Matter.World.add(this.world, debrisAssembly.rootBody);
      console.log(`🌍 Added debris to world, total assemblies: ${this.assemblies.length}`);
    } catch (error) {
      console.error('❌ Error spawning debris:', error);
    }
  }
  // Add method to spawn field of debris
  private spawnDebrisField(centerX: number, centerY: number, count: number, radius: number): void {
    console.log(`🗑️ Spawning debris field: ${count} pieces in ${radius} unit radius`);

    // Mix of random debris and broken ship parts
    for (let i = 0; i < count; i++) {
      // Random position within radius
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * radius;
      const x = centerX + Math.cos(angle) * distance;
      const y = centerY + Math.sin(angle) * distance;

      // 30% chance to spawn broken ship parts (multiple pieces together)
      if (Math.random() < 0.3) {
        this.spawnBrokenShipParts(x, y);
      } else {
        this.spawnDebris(x, y);
      }
    }
  }

  // Add method to spawn broken ship parts (simulates destroyed ship remains)
  private spawnBrokenShipParts(x: number, y: number): void {
    console.log(`💥 Spawning broken ship parts at (${x}, ${y})`);

    // Create 2-4 parts from a "destroyed" ship
    const partCount = 2 + Math.floor(Math.random() * 3);
    const baseTypes: EntityType[] = ['Hull', 'Engine', 'Gun', 'PowerCell'];

    for (let i = 0; i < partCount; i++) {
      const offsetX = x + (Math.random() - 0.5) * 100; // Spread parts around
      const offsetY = y + (Math.random() - 0.5) * 100;
      const partType = baseTypes[Math.floor(Math.random() * baseTypes.length)];

      this.spawnDebris(offsetX, offsetY, partType);
    }
  }

  private setupMouseInteraction(): void {
    // Create mouse and mouse constraint for Matter.js
    this.mouse = Matter.Mouse.create(this.render.canvas);
    this.mouseConstraint = Matter.MouseConstraint.create(this.engine, {
      mouse: this.mouse,
      constraint: {
        stiffness: 0.2,
        render: { visible: false }
      }
    });    // Add event listener to filter dragging - only allow debris objects (cockpitless assemblies)
    Matter.Events.on(this.mouseConstraint, 'startdrag', (event: any) => {
      const body = event.body;
      const assembly = this.getAssemblyFromBody(body);

      if (assembly && assembly.hasControlCenter()) {
        // This assembly has a cockpit, prevent dragging by removing the constraint
        this.mouseConstraint.constraint.bodyB = null;
      }
    });    // Use DOM events instead of Matter.js events for better coordinate control
    /* Matter.js mouse events - disabled due to coordinate issues
    Matter.Events.on(this.mouseConstraint, 'mousedown', (event: any) => {
      console.log('🖱️ Matter.js mouse down detected');
      const mousePosition = event.mouse.position;
      console.log('🖱️ Raw mouse position:', mousePosition.x, mousePosition.y);
      
      // Convert screen coordinates to world coordinates
      const worldX = mousePosition.x + this.render.bounds.min.x;
      const worldY = mousePosition.y + this.render.bounds.min.y;
      console.log('🖱️ World coordinates:', worldX, worldY);
      console.log('🖱️ Render bounds:', this.render.bounds.min.x, this.render.bounds.min.y);

      // Handle selection with proper world coordinates
      this.handleWorldClick(worldX, worldY);
    });
    */

    Matter.World.add(this.world, this.mouseConstraint);    // Track mouse position for camera and targeting
    this.render.canvas.addEventListener('mousemove', (event) => {
      const rect = this.render.canvas.getBoundingClientRect();
      this.mousePosition = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
      // Update world-space cursor position (used for weapon aiming and BlockPickupSystem)
      this.updateCursorWorldPosition();

      if (this.blockPickupSystem.isHolding()) {
        // While holding a block, skip normal hover detection and set grabbing cursor
        this.setHoveredAssembly(null);
        this.render.canvas.style.cursor = 'grabbing';
      } else {
        // Normal hover detection
        const hoveredAssembly = this.getAssemblyAtPosition(this.mousePosition.x, this.mousePosition.y);
        this.setHoveredAssembly(hoveredAssembly);

        // Cursor style: grab hand over pickable blocks, crosshair otherwise
        if (
          hoveredAssembly &&
          !hoveredAssembly.hasControlCenter() &&
          hoveredAssembly !== this.playerAssembly
        ) {
          this.render.canvas.style.cursor = 'grab';
        } else {
          this.render.canvas.style.cursor = 'crosshair';
        }
      }
    });// Left mouse button - primary fire and interactions (selection handled by Matter.js events)
    this.render.canvas.addEventListener('mousedown', (event) => {
      // Resume audio context on user interaction (browser autoplay policy)
      SoundSystem.getInstance().resume();

      console.log('🖱️ DOM Mouse down detected, button:', event.button);
      if (event.button === 0) { // Left mouse button
        const rect = this.render.canvas.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        const worldPos = this.screenToWorld(screenX, screenY);

        // BlockPickupSystem intercepts clicks on non-cockpit assemblies
        if (this.blockPickupSystem.tryPickUp(worldPos, this.assemblies, this.playerAssembly)) {
          this.mouseDown = false; // suppress weapon fire while holding
        } else {
          this.mouseDown = true;
        }
      } else if (event.button === 2) { // Right mouse button
        this.handleRightClick(event);
      }
    }); this.render.canvas.addEventListener('mouseup', (event) => {
      if (event.button === 0) {
        if (this.blockPickupSystem.isHolding()) {
          this.blockPickupSystem.tryRelease(this.playerAssembly);
          this.mouseDown = false;
        } else {
          this.mouseDown = false;
        }
      }
    });    // Add click event for target selection
    this.render.canvas.addEventListener('click', (event) => {
      this.handleCanvasClick(event);
    });

    // Mouse wheel for zoom
    this.render.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.handleMouseWheel(event);
    });

    // Disable right-click context menu
    this.render.canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });

    // Keep mouse constraint in sync with render bounds    this.render.mouse = this.mouse;
  }  /*
  private handleWorldClick(_worldX: number, _worldY: number): void {
    console.log('🖱️ World click at:', _worldX, _worldY);

    // Find assembly at this world position
    const clickedAssembly = this.getAssemblyAtWorldPosition(_worldX, _worldY);

    console.log('🖱️ Clicked assembly:', clickedAssembly?.shipName || 'none');

    if (clickedAssembly && clickedAssembly !== this.playerAssembly) {
      // Select the clicked ship
      console.log('🎯 Selecting clicked assembly:', clickedAssembly.shipName);
      this.selectAssembly(clickedAssembly);
    } else if (clickedAssembly === this.playerAssembly) {
      // Clicked on player ship - don't clear selection, but also don't select it
      console.log('🖱️ Clicked on player ship - no action');
    } else {      // Clear selection if clicking empty space
      console.log('🖱️ Clicked empty space - clearing selection');
      this.selectAssembly(null);
    }
  }
  */
  private handleRightClick(_event: MouseEvent): void {
    // Right click for targeting - handled by handleCanvasClick now
    // This method is called by the mousedown event handler, but targeting
    // is now handled in handleCanvasClick which is called by the click event
    console.log('🖱️ Right click detected - targeting handled by click event');
  } private handleMouseWheel(event: WheelEvent): void {
    // Zoom in/out based on wheel direction (inverted for natural feel)
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1; // Wheel down = zoom out, wheel up = zoom in

    // Apply zoom to baseZoomLevel instead of zoomLevel so it persists and isn't overwritten by speed-based zoom
    this.baseZoomLevel *= zoomFactor;

    // Clamp base zoom level
    this.baseZoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, this.baseZoomLevel));

    // Record that the player manually adjusted zoom
    this.lastManualZoomTime = Date.now();

    console.log(`🔍 Mouse Wheel Zoom: ${this.baseZoomLevel.toFixed(3)}`);

    // The actual zoom application will happen in updateCameraWithMouse() which uses this.zoomLevel
    // this.zoomLevel is calculated in updateSpeedBasedZoom() based on baseZoomLevel
  }
  private updateCameraWithMouse(): void {
    if (!this.playerAssembly || this.playerAssembly.destroyed) return;

    const playerPos = this.playerAssembly.rootBody.position;
    const canvas = this.render.canvas;

    // Get mouse position in world coordinates
    const worldMouseX = this.mousePosition.x + this.render.bounds.min.x;
    const worldMouseY = this.mousePosition.y + this.render.bounds.min.y;

    // Calculate mouse offset from player, but clamp it to a maximum distance
    const rawOffsetX = (worldMouseX - playerPos.x) * this.mouseMovementInfluence;
    const rawOffsetY = (worldMouseY - playerPos.y) * this.mouseMovementInfluence;

    // Clamp the offset to maximum distance
    const offsetDistance = Math.sqrt(rawOffsetX * rawOffsetX + rawOffsetY * rawOffsetY);
    let offsetX = rawOffsetX;
    let offsetY = rawOffsetY;

    if (offsetDistance > this.maxMouseOffset) {
      const scale = this.maxMouseOffset / offsetDistance;
      offsetX = rawOffsetX * scale;
      offsetY = rawOffsetY * scale;
    }

    // Calculate target camera position
    const targetX = playerPos.x + offsetX;
    const targetY = playerPos.y + offsetY;

    // Apply zoom
    const width = canvas.width / this.zoomLevel;
    const height = canvas.height / this.zoomLevel;

    Matter.Render.lookAt(this.render, {
      min: { x: targetX - width / 2, y: targetY - height / 2 },
      max: { x: targetX + width / 2, y: targetY + height / 2 }
    });
  }

  private setupRenderSystem(): void {
    console.log('🎨 Setting up RenderSystem');

    this.renderSystem = new RenderSystem(
      this.render.canvas,
      () => this.render.bounds,
      this.stats,
    );

    this.renderSystem.register(new GridRenderer(() => this.showGrid));
    this.renderSystem.register(new BlockBodyRenderer(
      () => this.assemblies,
      () => this.world,
    ));
    this.renderSystem.register(new BlockFrillsRenderer(() => this.assemblies));
    this.renderSystem.register(new ShieldRenderer(() => this.assemblies));
    this.renderSystem.register(new BeamRenderer(this.beamSystem));
    this.renderSystem.register(new ShipHighlightRenderer(
      () => this.playerAssembly,
      () => this.hoveredAssembly,
      () => this.getSelectedAssembly(),
      (assembly) => this.getLockedTargets(assembly),
    ));
    this.renderSystem.register(new AimingDebugRenderer(() => this.playerAssembly));
    this.renderSystem.register(new BlockPickupRenderer(
      this.blockPickupSystem,
      () => this.playerAssembly,
    ));
  }

  /** Enable or disable the physics wireframe debug overlay (called from SettingsPanel). */
  public setDebugPhysics(enabled: boolean, debugOnly: boolean = false): void {
    this.renderSystem.setDebugPhysics(enabled, debugOnly, this.engine, this.container);
  }
  /**
   * Helper method to find which assembly contains a given Matter.js body
   */
  private getAssemblyFromBody(body: Matter.Body): Assembly | null {
    // Check if body is directly an assembly root body
    if (body.assembly) {
      return body.assembly;
    }

    // Check if body is part of a compound body (assembly)
    if (body.parent && body.parent.assembly) {
      return body.parent.assembly;
    }

    // Search through all assemblies to find which one contains this body
    for (const assembly of this.assemblies) {
      if (assembly.rootBody === body || assembly.rootBody === body.parent) {
        return assembly;
      }

      // Check if any entity in the assembly has this body
      for (const entity of assembly.entities) {
        if (entity.body === body) {
          return assembly;
        }
      }
    }

    return null;
  }

  public initializeBattle(): void {
    const cfg = this.scenarioConfig;
    this.assemblies.forEach(a => this.removeBodyWithParts(a.rootBody));
    this.assemblies = [];
    this.playerAssembly = null;

    // Drop any held block before clearing the scene
    if (this.blockPickupSystem.isHolding()) {
      this.blockPickupSystem.forceDropAtCurrentPosition();
    }

    this.toastSystem.showGameEvent(`${cfg.label} — Battle Start!`);

    if (cfg.sandboxMode) {
      this.spawnSandboxScenario();
    } else {
      this.spawnTeamLine(0, cfg);
      this.spawnTeamLine(1, cfg);

      if (cfg.spawnDebris) {
        this.spawnDebrisField(0, 0, cfg.debrisCount, 2000);
      }
    }

    // Set initial zoom based on actual player ship bounds.
    if (this.playerAssembly) {
      this.calculateZoomForAssembly(this.playerAssembly);
      this.setInitialCameraView();
    }
  }

  private spawnSandboxScenario(): void {
    const SANDBOX_BLOCK_TYPES: EntityType[] = [
      'Beam', 'Beam', 'LargeBeam',
      'Gun', 'Gun', 'Gun',
      'Engine', 'Engine', 'Engine', 'Engine',
      'LargeEngine',
      'Shield', 'Shield', 'LargeShield',
      'Hull', 'Hull', 'Hull', 'Hull',
      'PowerCell', 'PowerCell',
      'MissileLauncher',
    ];

    // Spawn player as a single bare cockpit
    const cockpitConfig: EntityConfig = { type: 'Cockpit', x: 0, y: 0, rotation: 0 };
    const playerAssembly = new Assembly([cockpitConfig], { x: 0, y: 0 });
    playerAssembly.isPlayerControlled = true;
    playerAssembly.setShipName('Cockpit');
    playerAssembly.setTeam(0);
    this.assemblies.push(playerAssembly);
    Matter.World.add(this.world, playerAssembly.rootBody);
    this.playerAssembly = playerAssembly;
    this.flightController = new FlightController(playerAssembly);
    this.controllerManager.createPlayerController(playerAssembly);
    PowerSystem.getInstance().setPlayerAssembly(playerAssembly);

    // Scatter loose blocks around the origin
    const count = 12 + Math.floor(Math.random() * 5); // 12–16 blocks
    for (let i = 0; i < count && i < SANDBOX_BLOCK_TYPES.length; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 150 + Math.random() * 350; // 150–500 units from origin
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;

      const config: EntityConfig = {
        type: SANDBOX_BLOCK_TYPES[i],
        x: 0,
        y: 0,
        rotation: Math.floor(Math.random() * 4) * 90,
      };
      const blockAssembly = new Assembly([config], { x, y });
      blockAssembly.setTeam(-1);
      blockAssembly.setShipName(`${SANDBOX_BLOCK_TYPES[i]} Block`);
      // Gentle random spin
      Matter.Body.setAngularVelocity(blockAssembly.rootBody, (Math.random() - 0.5) * 0.16);
      this.assemblies.push(blockAssembly);
      Matter.World.add(this.world, blockAssembly.rootBody);
    }

    // Spawn compound scrap assemblies — pre-built multi-block fragments for snap testing
    const compoundScraps: { name: string; parts: EntityConfig[] }[] = [
      {
        // Hull + Engine: a single thruster nacelle
        name: 'Engine Nacelle',
        parts: [
          { type: 'Hull',   x: 0,            y: 0, rotation: 0 },
          { type: 'Engine', x: -GRID_SIZE,   y: 0, rotation: 0 },
        ],
      },
      {
        // Hull pair + forward Gun: a simple gun platform
        name: 'Gun Platform',
        parts: [
          { type: 'Hull', x: -GRID_SIZE, y: 0, rotation: 0 },
          { type: 'Hull', x: 0,          y: 0, rotation: 0 },
          { type: 'Gun',  x: GRID_SIZE,  y: 0, rotation: 0 },
        ],
      },
      {
        // Engine + PowerCell + Hull in a line: a compact power spine
        name: 'Power Spine',
        parts: [
          { type: 'Engine',    x: -GRID_SIZE, y: 0, rotation: 0 },
          { type: 'PowerCell', x: 0,          y: 0, rotation: 0 },
          { type: 'Hull',      x: GRID_SIZE,  y: 0, rotation: 0 },
        ],
      },
      {
        // L-shaped 4-block wing section: Hull spine with PowerCell above and Engine aft
        name: 'Wing Section',
        parts: [
          { type: 'Engine',    x: -GRID_SIZE, y: 0,          rotation: 0 },
          { type: 'Hull',      x: 0,          y: 0,          rotation: 0 },
          { type: 'Hull',      x: GRID_SIZE,  y: 0,          rotation: 0 },
          { type: 'PowerCell', x: 0,          y: -GRID_SIZE, rotation: 0 },
        ],
      },
      {
        // Twin guns on a hull base: a gun turret fragment
        name: 'Twin Gun Mount',
        parts: [
          { type: 'Hull', x: 0,          y: 0,          rotation: 0 },
          { type: 'Gun',  x: GRID_SIZE,  y: -GRID_SIZE, rotation: 0 },
          { type: 'Gun',  x: GRID_SIZE,  y: GRID_SIZE,  rotation: 0 },
        ],
      },
    ];

    for (const scrap of compoundScraps) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 180 + Math.random() * 300;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;

      const scrapAssembly = new Assembly(scrap.parts, { x, y });
      scrapAssembly.setTeam(-1);
      scrapAssembly.setShipName(scrap.name);
      // Gentle spin, slower than single blocks so they're easier to grab
      Matter.Body.setAngularVelocity(scrapAssembly.rootBody, (Math.random() - 0.5) * 0.06);
      this.assemblies.push(scrapAssembly);
      Matter.World.add(this.world, scrapAssembly.rootBody);
    }

    this.toastSystem.showGameEvent('Sandbox — Build your ship!');
  }

  private spawnTeamLine(team: number, cfg: ScenarioConfig): void {
    const ships = shipsData.ships;
    const selectedShip = ships[cfg.shipIndex] ?? ships[0];
    const isBlue = team === 0;
    const spawnX = isBlue ? -cfg.spawnX : cfg.spawnX;

    for (let i = 0; i < cfg.teamSize; i++) {
      let x: number;
      let y: number;

      if (cfg.lineFormation) {
        x = spawnX;
        y = (i - (cfg.teamSize - 1) / 2) * SHIP_SPAWN_SPACING;
      } else {
        const angle = (i / cfg.teamSize) * Math.PI * 2;
        x = spawnX + Math.cos(angle) * 200 + (Math.random() - 0.5) * 150;
        y =          Math.sin(angle) * 200 + (Math.random() - 0.5) * 150;
      }

      const assembly = new Assembly(selectedShip.parts as EntityConfig[], { x, y });
      assembly.setShipName(selectedShip.name);
      assembly.setTeam(team);
      this.assemblies.push(assembly);
      Matter.World.add(this.world, assembly.rootBody);

      if (isBlue && i === 0 && assembly.hasControlCenter()) {
        this.playerAssembly = assembly;
        assembly.isPlayerControlled = true;
        this.flightController = new FlightController(assembly);
        this.controllerManager.createPlayerController(assembly);
      } else {
        const ai = this.controllerManager.createAIController(assembly);
        ai.setAggressionLevel(0.8 + Math.random() * 0.4);
      }
    }
  }  // Method to get radar data for the UI
  public getRadarData() {
    const radarData: any[] = [];

    // Add all assemblies (ships and debris)
    this.assemblies.forEach(assembly => {
      radarData.push({
        x: assembly.rootBody.position.x,
        y: assembly.rootBody.position.y,
        team: assembly.team,
        isPlayer: assembly.isPlayerControlled,
        id: assembly.id,
        shipName: assembly.shipName,
        shipType: assembly.isPlayerControlled ? 'Player Ship' :
          assembly.team === -1 ? 'Debris' :
            'AI Ship',
        isDebris: assembly.entities.length === 1 && !assembly.hasControlCenter() || assembly.team === -1, // Single part without cockpit OR neutral team = debris
        objectType: 'ship'
      });
    });

    // Add all missiles
    const missiles = this.missileSystem.getMissiles();
    missiles.forEach((missile, index) => {
      if (!missile.destroyed) {
        radarData.push({
          x: missile.body.position.x,
          y: missile.body.position.y,
          team: -2, // Special team for missiles
          isPlayer: false,
          id: `missile-${index}-${missile.sourceAssemblyId}`,
          shipName: `${missile.config.type.toUpperCase()} Missile`,
          shipType: 'Missile',
          isDebris: false,
          isMissile: true,
          objectType: 'missile',
          sourceAssemblyId: missile.sourceAssemblyId
        });
      }
    });

    return radarData;
  }
  // Ship selection methods
  private getAssemblyAtPosition(x: number, y: number): Assembly | null {
    // Convert screen coordinates to world coordinates
    const worldX = x + this.render.bounds.min.x;
    const worldY = y + this.render.bounds.min.y;

    // console.log('🔍 Looking for assembly at screen:', x, y, 'world:', worldX, worldY);

    // Find assembly at this position
    for (const assembly of this.assemblies) {
      if (assembly.destroyed) continue;

      // Check if world position is within assembly bounds
      for (const entity of assembly.entities) {
        const bounds = entity.body.bounds;
        if (worldX >= bounds.min.x && worldX <= bounds.max.x &&
          worldY >= bounds.min.y && worldY <= bounds.max.y) {
          // console.log('🔍 Found assembly:', assembly.shipName, 'at bounds:', bounds);
          return assembly;
        }
      }
    }
    // console.log('🔍 No assembly found at position');
    return null;
  }

  // @ts-expect-error - Currently unused but may be needed later
  private getAssemblyAtWorldPosition(worldX: number, worldY: number): Assembly | null {
    console.log('🔍 Looking for assembly at world position:', worldX, worldY);

    // Find assembly at this world position
    for (const assembly of this.assemblies) {
      if (assembly.destroyed) continue;

      // Check if world position is within assembly bounds
      for (const entity of assembly.entities) {
        const bounds = entity.body.bounds;
        if (worldX >= bounds.min.x && worldX <= bounds.max.x &&
          worldY >= bounds.min.y && worldY <= bounds.max.y) {
          console.log('🔍 Found assembly:', assembly.shipName, 'at bounds:', bounds);
          return assembly;
        }
      }
    }

    console.log('🔍 No assembly found at world position');
    return null;
  }

  private selectAssembly(assembly: Assembly | null): void {
    if (this.selectedAssembly !== assembly) {
      const previousSelection = this.selectedAssembly?.shipName || 'none';
      this.selectedAssembly = assembly;
      const newSelection = assembly?.shipName || 'none';

      console.log(`🎯 Selection changed from "${previousSelection}" to "${newSelection}"`);

      if (assembly) {
        console.log('🎯 Selected assembly details:');
        console.log('   - ID:', assembly.id);
        console.log('   - Ship name:', assembly.shipName);
        console.log('   - Entities count:', assembly.entities.length);
        console.log('   - Destroyed:', assembly.destroyed);
        console.log('   - Team:', assembly.team);
        console.log('   - Is player controlled:', assembly.isPlayerControlled);
      }
    }
  }

  private setHoveredAssembly(assembly: Assembly | null): void {
    this.hoveredAssembly = assembly;
  }

  private updateCursorWorldPosition(): void {
    // Convert current mouse screen position to world coordinates
    const bounds = this.render.bounds;
    const worldX = (this.mousePosition.x / this.render.canvas.width) * (bounds.max.x - bounds.min.x) + bounds.min.x;
    const worldY = (this.mousePosition.y / this.render.canvas.height) * (bounds.max.y - bounds.min.y) + bounds.min.y;

    this.mouseWorldPos = { x: worldX, y: worldY };

    // Set cursor position on player assembly for weapon aiming
    if (this.playerAssembly && !this.playerAssembly.destroyed) {
      this.playerAssembly.cursorPosition = { x: worldX, y: worldY };
    }
  }

  private screenToWorld(screenX: number, screenY: number): Vector2 {
    const bounds = this.render.bounds;
    return {
      x: (screenX / this.render.canvas.width) * (bounds.max.x - bounds.min.x) + bounds.min.x,
      y: (screenY / this.render.canvas.height) * (bounds.max.y - bounds.min.y) + bounds.min.y,
    };
  }

  public getSelectedAssembly(): Assembly | null {
    // Add extra logging to debug selection issues
    if (this.selectedAssembly) {
      // Check if the selected assembly still exists in our assemblies array
      const stillExists = this.assemblies.includes(this.selectedAssembly);
      if (!stillExists) {
        console.log('⚠️ Selected assembly no longer exists in assemblies array!');
        this.selectedAssembly = null;
        return null;
      }

      // Check if the selected assembly is destroyed
      if (this.selectedAssembly.destroyed) {
        console.log('⚠️ Selected assembly is marked as destroyed!');
        this.selectedAssembly = null;
        return null;
      }
    }

    return this.selectedAssembly;
  }

  public getHoveredAssembly(): Assembly | null {
    return this.hoveredAssembly;
  }

  public turnPlayerToFaceTarget(targetX: number, targetY: number): void {
    if (!this.playerAssembly || this.playerAssembly.destroyed) return;

    const playerX = this.playerAssembly.rootBody.position.x;
    const playerY = this.playerAssembly.rootBody.position.y;

    const angle = Math.atan2(targetY - playerY, targetX - playerX);
    Matter.Body.setAngle(this.playerAssembly.rootBody, angle);

    console.log('🎯 Player ship turned to face target');
  }

  public getAssemblyById(id: string): Assembly | null {
    return this.assemblies.find(a => a.id === id) || null;
  }

  public getAllAssemblies(): Assembly[] {
    return [...this.assemblies]; // Return a copy to prevent external modification
  }

  public selectAssemblyById(id: string): void {
    console.log('🎯 GameEngine: Selecting assembly by ID:', id);
    const assembly = this.assemblies.find(a => a.id === id);
    if (assembly) {
      this.selectAssembly(assembly);
      console.log('🎯 GameEngine: Successfully selected assembly:', assembly.shipName);
    } else {
      console.log('🎯 GameEngine: Assembly not found with ID:', id);
      this.selectAssembly(null);
    }
  }
  public setPlayerCommand(command: string, targetId?: string): void {
    console.log(`🎮 Player command: ${command}${targetId ? ` on target ${targetId}` : ''}`);

    // Store the current player command for the AI/control system
    if (this.playerAssembly && !this.playerAssembly.destroyed) {
      this.playerCommand = command;

      // Find the target assembly if targetId is provided
      if (targetId) {
        this.playerCommandTarget = this.assemblies.find(a => a.id === targetId) || null;
        if (!this.playerCommandTarget) {
          console.log('❌ Target assembly not found:', targetId);
          return;
        }
      } else {
        this.playerCommandTarget = null;
      }

      // Handle the command
      switch (command) {
        case 'follow':
          console.log('📍 Setting player to follow target:', this.playerCommandTarget?.shipName);
          break;
        case 'orbit':
          console.log('🌀 Setting player to orbit target:', this.playerCommandTarget?.shipName);
          break;
        case 'keepDistance':
          console.log('📏 Setting player to maintain distance from target:', this.playerCommandTarget?.shipName);
          break; case 'lockOn':
          console.log('🔒 Setting player to lock onto target:', this.playerCommandTarget?.shipName);
          // Also add target to weapon targeting system
          if (this.playerCommandTarget) {
            this.playerAssembly.lockTarget(this.playerCommandTarget);
            // Set as primary target if it's the first lock
            if (this.playerAssembly.primaryTarget === null) {
              this.playerAssembly.setPrimaryTarget(this.playerCommandTarget);
            }
            this.toastSystem.showSuccess(`🔒 Locked: ${this.playerCommandTarget.shipName}`);
          }
          break;
        case 'stop':
          console.log('🛑 Clearing all player commands');
          this.playerCommand = null;
          this.playerCommandTarget = null;
          break;
        default:
          console.log('❓ Unknown command:', command);
      }
    } else {
      console.log('❌ No player assembly available for command');
    }
  }

  private executePlayerCommands(): void {
    if (!this.playerAssembly || this.playerAssembly.destroyed || !this.playerCommand || !this.playerCommandTarget) {
      return;
    }

    // Check if target still exists and isn't destroyed
    if (this.playerCommandTarget.destroyed || !this.assemblies.includes(this.playerCommandTarget)) {
      console.log('🚫 Player command target no longer available, clearing command');
      this.playerCommand = null;
      this.playerCommandTarget = null;
      return;
    }

    const playerPos = this.playerAssembly.rootBody.position;
    const targetPos = this.playerCommandTarget.rootBody.position;
    const distance = Math.sqrt(
      Math.pow(targetPos.x - playerPos.x, 2) +
      Math.pow(targetPos.y - playerPos.y, 2)
    );

    switch (this.playerCommand) {
      case 'follow': this.executeFollowCommand();
        break;
      case 'orbit':
        this.executeOrbitCommand();
        break;
      case 'keepDistance':
        this.executeKeepDistanceCommand(playerPos, targetPos, distance);
        break;
      case 'lockOn':
        this.executeLockOnCommand(playerPos, targetPos, distance);
        break;
    }
  } private executeFollowCommand(): void {
    console.log('🎯 Follow command executing...', this.flightController ? 'FC OK' : 'NO FC', this.selectedAssembly ? 'Target OK' : 'NO Target'); if (!this.flightController || !this.selectedAssembly) return;

    // Use advanced flight controller for smooth following
    const control = this.flightController.followTarget(this.selectedAssembly, 150);

    // Debug logging disabled to reduce spam
    // console.log('🚀 Follow control:', control.thrust.x.toFixed(3), control.thrust.y.toFixed(3), 'torque:', control.torque.toFixed(3));

    // Send control input to the controller manager (like player input)
    this.controllerManager.setPlayerInput(control);
  } private executeOrbitCommand(): void {
    console.log('🌀 Orbit command executing...', this.flightController ? 'FC OK' : 'NO FC', this.selectedAssembly ? 'Target OK' : 'NO Target');
    if (!this.flightController || !this.selectedAssembly) return;

    // Use advanced flight controller for smooth orbital motion
    const control = this.flightController.orbitTarget(this.selectedAssembly, 200);

    // Debug logging disabled to reduce spam
    // console.log('🚀 Orbit control:', control.thrust.x.toFixed(3), control.thrust.y.toFixed(3), 'torque:', control.torque.toFixed(3));

    // Send control input to the controller manager (like player input)
    this.controllerManager.setPlayerInput(control);
  }
  private executeKeepDistanceCommand(playerPos: Matter.Vector, targetPos: Matter.Vector, distance: number): void {
    const keepDistance = 300; // Desired distance to maintain
    const tolerance = 50; // Distance tolerance

    if (distance < keepDistance - tolerance) {
      // Too close, move away using thrusters
      const dirX = (playerPos.x - targetPos.x) / distance;
      const dirY = (playerPos.y - targetPos.y) / distance;
      const thrustPower = Math.min(0.7, (keepDistance - distance) / keepDistance);

      const thrustInput = {
        x: dirX * thrustPower,
        y: dirY * thrustPower
      };
      this.playerAssembly!.applyThrust(thrustInput);

    } else if (distance > keepDistance + tolerance) {
      // Too far, move closer using thrusters
      const dirX = (targetPos.x - playerPos.x) / distance;
      const dirY = (targetPos.y - playerPos.y) / distance;
      const thrustPower = Math.min(0.7, (distance - keepDistance) / keepDistance);

      const thrustInput = {
        x: dirX * thrustPower,
        y: dirY * thrustPower
      };
      this.playerAssembly!.applyThrust(thrustInput);
    }

    // Always face the target using proper torque system
    const targetAngle = Math.atan2(targetPos.y - playerPos.y, targetPos.x - playerPos.x);
    const currentAngle = this.playerAssembly!.rootBody.angle;
    let angleDiff = targetAngle - currentAngle;

    // Normalize angle difference
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;    // Apply torque to face target
    if (Math.abs(angleDiff) > 0.1) {
      const torque = Math.sign(angleDiff) * Math.min(0.6, Math.abs(angleDiff) * 1.5); // Reduced from 0.8 and 2
      this.playerAssembly!.applyTorque(torque);
    }
  }
  private executeLockOnCommand(playerPos: Matter.Vector, targetPos: Matter.Vector, distance: number): void {
    // Lock on keeps the player facing the target and potentially moves closer
    const targetAngle = Math.atan2(targetPos.y - playerPos.y, targetPos.x - playerPos.x);
    const currentAngle = this.playerAssembly!.rootBody.angle;
    let angleDiff = targetAngle - currentAngle;

    // Normalize angle difference
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;    // Apply torque to face target
    if (Math.abs(angleDiff) > 0.05) { // More precise aiming for lock on
      const torque = Math.sign(angleDiff) * Math.min(0.8, Math.abs(angleDiff) * 2.0); // Slightly higher for lock-on precision
      this.playerAssembly!.applyTorque(torque);
    }

    // Move closer if very far using proper thrusters
    if (distance > 400) {
      const dirX = (targetPos.x - playerPos.x) / distance;
      const dirY = (targetPos.y - playerPos.y) / distance; const thrustInput = {
        x: dirX * 0.1, // Reduced from 0.4 to 0.1 (moderate approach speed)
        y: dirY * 0.1
      };
      this.playerAssembly!.applyThrust(thrustInput);
    }
  }
  // Zoom control methods
  public zoomIn(): void {
    this.baseZoomLevel = Math.min(this.baseZoomLevel * 1.5, this.maxZoom);
    this.lastManualZoomTime = Date.now();
    console.log(`🔍 Zoom In: ${this.baseZoomLevel.toFixed(2)}`);
  }

  public zoomOut(): void {
    this.baseZoomLevel = Math.max(this.baseZoomLevel * 0.67, this.minZoom);
    this.lastManualZoomTime = Date.now();
    console.log(`🔍 Zoom Out: ${this.baseZoomLevel.toFixed(2)}`);
  } public resetZoom(): void {
    if (this.playerAssembly) {
      this.calculateZoomForAssembly(this.playerAssembly);
    } else {
      this.calculateDefaultZoom(this.render.canvas.width, this.render.canvas.height);
    }
    this.lastManualZoomTime = Date.now();
    console.log(`🔍 Reset Zoom: ${this.baseZoomLevel.toFixed(3)}`);
  }

  public toggleSpeedBasedZoom(): boolean {
    this.speedBasedZoomEnabled = !this.speedBasedZoomEnabled;
    console.log(`🔍 Speed-based zoom: ${this.speedBasedZoomEnabled ? 'ON' : 'OFF'}`);
    return this.speedBasedZoomEnabled;
  }

  public getCurrentZoom(): number {
    return this.zoomLevel;
  }

  public getBaseZoom(): number {
    return this.baseZoomLevel;
  }

  public isSpeedBasedZoomEnabled(): boolean {
    return this.speedBasedZoomEnabled;
  }

  public toggleInertialDampening(): boolean {
    this.inertialDampeningEnabled = !this.inertialDampeningEnabled;
    return this.inertialDampeningEnabled;
  }

  public isInertialDampeningEnabled(): boolean {
    return this.inertialDampeningEnabled;
  }

  public getCurrentSpeed(): number {
    if (!this.playerAssembly) return 0;
    const velocity = this.playerAssembly.rootBody.velocity;
    return Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
  }  // Update zoom based on speed - call this in the update loop
  private updateSpeedBasedZoom(): void {
    if (!this.speedBasedZoomEnabled || !this.playerAssembly) {
      // When speed-based zoom is disabled, use the player's chosen base zoom level
      this.zoomLevel = this.baseZoomLevel;
      return;
    }

    const currentTime = Date.now();
    const timeSinceManualZoom = currentTime - this.lastManualZoomTime;

    // If player recently manually adjusted zoom, reduce or disable speed-based zoom temporarily
    let speedZoomInfluence = 1.0;
    if (timeSinceManualZoom < this.manualZoomCooldown) {
      // Gradually fade in speed-based zoom over the cooldown period
      speedZoomInfluence = timeSinceManualZoom / this.manualZoomCooldown;
    }

    const speed = this.getCurrentSpeed();

    // Calculate speed-based zoom adjustment as a percentage (max 50% zoom out)
    const maxSpeedZoomPercent = 0.50 * speedZoomInfluence;
    const speedThreshold = 20; // Speed at which max zoom out is reached
    const speedPercent = Math.min(speed / speedThreshold, 1.0);
    const zoomOutPercent = speedPercent * maxSpeedZoomPercent;

    // Apply the zoom out percentage to the player's chosen base zoom level
    const targetZoom = this.baseZoomLevel * (1 - zoomOutPercent);
    const clampedTargetZoom = Math.max(this.minZoom, targetZoom);

    // Smooth but responsive transition
    const smoothingFactor = 0.05;
    this.zoomLevel += (clampedTargetZoom - this.zoomLevel) * smoothingFactor;

    // Debug logging (uncomment to see zoom changes)
   
    // if (speed > 1 || speedZoomInfluence < 1) {
    //   console.log(`🔍 Speed: ${speed.toFixed(1)}, BaseZoom: ${this.baseZoomLevel.toFixed(3)}, Influence: ${(speedZoomInfluence * 100).toFixed(0)}%, ZoomOut%: ${(zoomOutPercent * 100).toFixed(1)}%, Target: ${clampedTargetZoom.toFixed(3)}, Current: ${this.zoomLevel.toFixed(3)}`);
    // }
  }

  public getPlayerAssembly(): Assembly | null {
    return this.playerAssembly;
  }

  public getPlayerCommand(): string | null {
    return this.playerCommand;
  }

  public setPlayerShipIndex(_shipIndex: number): void {
    // Ship index is now controlled via ScenarioConfig; kept for API compatibility
  }

  public setScenario(config: ScenarioConfig): void {
    this.scenarioConfig = config;
  }

  public spawnPlayerShip(shipIndex: number): void {

    // Clear existing player
    if (this.playerAssembly) {
      const index = this.assemblies.findIndex(a => a === this.playerAssembly);
      if (index !== -1) {
        Matter.World.remove(this.world, this.playerAssembly.rootBody);
        this.assemblies.splice(index, 1);
      }
      this.playerAssembly = null;
    }

    // Spawn new player ship
    const ships = shipsData.ships;
    const selectedShip = ships[shipIndex];

    if (selectedShip) {
      // Spawn player on the left side
      const assembly = new Assembly(selectedShip.parts as EntityConfig[], { x: -800, y: 0 });
      assembly.setShipName(selectedShip.name);
      assembly.setTeam(0); // Blue team
      assembly.isPlayerControlled = true;

      this.playerAssembly = assembly;
      this.assemblies.push(assembly);
      Matter.World.add(this.world, assembly.rootBody);

      // Set up controllers
      this.flightController = new FlightController(assembly);
      this.controllerManager.createPlayerController(assembly);

      console.log(`👤 Player respawned with ship: ${selectedShip.name}`);
    }
  }

  public canPlayerEject(): boolean {
    return this.playerAssembly ? this.playerAssembly.canEject() : false;
  }

  public getPlayerDamagePercentage(): number {
    return this.playerAssembly ? this.playerAssembly.getDamagePercentage() : 0;
  }
  public ejectPlayer(): void {
    if (!this.playerAssembly || !this.playerAssembly.canEject()) {
      console.warn('⚠️ Cannot eject - conditions not met');
      return;
    }

    console.log('🚀 Player ejecting!');

    // Store the old assembly ID to remove its controller
    const oldAssemblyId = this.playerAssembly.id;

    // Remove current player assembly from world
    const playerIndex = this.assemblies.findIndex(a => a === this.playerAssembly);
    if (playerIndex !== -1) {
      Matter.World.remove(this.world, this.playerAssembly!.rootBody);
      this.assemblies.splice(playerIndex, 1);
    }

    // Remove the old controller
    this.controllerManager.removeController(oldAssemblyId);

    // Perform ejection
    const newAssemblies = this.playerAssembly!.ejectNonControlParts();

    // Add all new assemblies to world and our list
    newAssemblies.forEach(assembly => {
      this.assemblies.push(assembly);
      Matter.World.add(this.world, assembly.rootBody);
    });    // The first assembly should be the cockpit with player control
    const cockpitAssembly = newAssemblies.find(a => a.isPlayerControlled);
    if (cockpitAssembly) {
      this.playerAssembly = cockpitAssembly;
      this.flightController = new FlightController(cockpitAssembly);
      this.controllerManager.createPlayerController(cockpitAssembly);
      console.log('� Player control transferred to ejected cockpit'); console.log('🎮 New cockpit controller created');

      // Update power system for the new cockpit assembly
      const powerSystem = PowerSystem.getInstance();
      powerSystem.setPlayerAssembly(cockpitAssembly);
      console.log('⚡ Power system updated for cockpit');

      this.toastSystem.showWarning("🚀 Emergency ejection! Cockpit separated");
    } else {
      this.toastSystem.showError("💀 Critical failure! No cockpit available");
      console.warn('⚠️ No cockpit assembly found after ejection');
      this.playerAssembly = null;
    }
  }

  // Auto-zoom functionality for large ships
  public setAutoZoomForShip(shipIndex: number): void {
    const ships = shipsData.ships;
    const selectedShip = ships[shipIndex];

    if (selectedShip) {
      // Calculate ship size
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let totalVolume = 0;
      selectedShip.parts.forEach(part => {
        const def = ENTITY_DEFINITIONS[part.type as EntityType];
        if (def) {
          const halfWidth = def.width / 2;
          const halfHeight = def.height / 2;

          minX = Math.min(minX, part.x - halfWidth);
          minY = Math.min(minY, part.y - halfHeight);
          maxX = Math.max(maxX, part.x + halfWidth);
          maxY = Math.max(maxY, part.y + halfHeight);

          totalVolume += def.width * def.height;
        }
      });

      const shipWidth = maxX - minX;
      const shipHeight = maxY - minY;
      const shipArea = shipWidth * shipHeight;

      // Determine if this is a large ship that needs auto-zoom
      const isLargeShip = shipArea > 10000 || totalVolume > 50000;

      if (isLargeShip) {
        // Calculate appropriate zoom level for large ships
        const containerWidth = this.render.canvas.width;
        const containerHeight = this.render.canvas.height;

        // Calculate zoom to fit ship with some padding
        const paddingFactor = 1.5; // 50% padding around ship
        const zoomForWidth = containerWidth / (shipWidth * paddingFactor);
        const zoomForHeight = containerHeight / (shipHeight * paddingFactor);
        const suggestedZoom = Math.min(zoomForWidth, zoomForHeight);



        // Clamp to reasonable bounds and make it even more zoomed out for large ships
        const largeShipZoom = Math.max(this.minZoom, Math.min(suggestedZoom * 0.6, this.baseZoomLevel * 0.5));

        console.log(`🔍 Large ship detected: ${selectedShip.name}`);
        console.log(`🔍 Ship dimensions: ${shipWidth.toFixed(0)} x ${shipHeight.toFixed(0)} (area: ${shipArea.toFixed(0)})`);
        console.log(`🔍 Setting auto-zoom to: ${largeShipZoom.toFixed(3)} (was: ${this.baseZoomLevel.toFixed(3)})`);

        // Adjust base zoom level for this large ship
        this.baseZoomLevel = largeShipZoom;
        this.zoomLevel = largeShipZoom;
      } else {
        console.log(`🔍 Regular ship: ${selectedShip.name} - using normal zoom`);
      }
    }
  } private handleCanvasClick(event: MouseEvent): void {
    const rect = this.render.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    // Convert screen coordinates to world coordinates
    const worldX = screenX + this.render.bounds.min.x;
    const worldY = screenY + this.render.bounds.min.y;

    // Find assembly at click position
    const clickedAssembly = this.getAssemblyAtPosition(screenX, screenY);

    if (clickedAssembly && clickedAssembly !== this.playerAssembly) {
      // Right-click or Ctrl+click for targeting
      if (event.button === 2 || event.ctrlKey) {
        this.handleTargetClick(clickedAssembly);
      } else {
        // Left-click for selection
        this.selectAssembly(clickedAssembly);
      }
    } else if (clickedAssembly === this.playerAssembly) {
      // Clicked on player ship - clear selection
      this.selectAssembly(null);
    } else {
      // Clicked empty space
      if (this.playerAssembly) {
        // Set cursor position for weapon aiming
        this.mousePosition = { x: screenX, y: screenY };
        this.playerAssembly.cursorPosition = { x: worldX, y: worldY };
      }
      this.selectAssembly(null);
    }
  } private handleTargetClick(assembly: Assembly): void {
    if (!this.playerAssembly || this.playerAssembly.destroyed) return;

    // Toggle target lock
    if (this.playerAssembly.isTargetLocked(assembly)) {
      this.playerAssembly.unlockTarget(assembly);
      this.toastSystem.showGameEvent(`🔓 Unlocked: ${assembly.shipName}`);
    } else {
      this.playerAssembly.lockTarget(assembly);
      this.toastSystem.showSuccess(`🔒 Locked: ${assembly.shipName}`);

      // Set as primary target if it's the first lock
      if (this.playerAssembly.primaryTarget === null) {
        this.playerAssembly.setPrimaryTarget(assembly);
        this.toastSystem.showSuccess(`🎯 Primary target: ${assembly.shipName}`);
      }
    }
  }

  public getLockedTargets(assembly: Assembly): Assembly[] {
    const lockedIds = Array.from(assembly.lockedTargets);
    return this.assemblies.filter(a => lockedIds.includes(a.id) && !a.destroyed);
  }

  private selectNearestEnemy(): void {
    if (!this.playerAssembly || this.playerAssembly.destroyed) return;

    const playerPos = this.playerAssembly.rootBody.position;
    let nearestEnemy: Assembly | null = null;
    let nearestDistance = Infinity;

    this.assemblies.forEach(assembly => {
      if (assembly.destroyed || assembly === this.playerAssembly || assembly.team === this.playerAssembly!.team) return;

      const distance = Math.sqrt(
        Math.pow(assembly.rootBody.position.x - playerPos.x, 2) +
        Math.pow(assembly.rootBody.position.y - playerPos.y, 2)
      );

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestEnemy = assembly;
      }
    }); if (nearestEnemy) {
      this.playerAssembly.setPrimaryTarget(nearestEnemy);
      this.toastSystem.showSuccess(`🎯 Targeting: ${(nearestEnemy as Assembly).shipName}`);
      console.log(`🎯 Selected nearest enemy: ${(nearestEnemy as Assembly).shipName} (${nearestDistance.toFixed(0)} units away)`);
    } else {
      this.toastSystem.showWarning("🎯 No enemies in range");
      console.log('🎯 No enemies found to target');
    }
  }
  private clearAllTargets(): void {
    if (!this.playerAssembly || this.playerAssembly.destroyed) return;

    // Clear all locked targets
    const lockedTargets = this.getLockedTargets(this.playerAssembly);
    lockedTargets.forEach(target => {
      this.playerAssembly!.unlockTarget(target);
    });

    this.playerAssembly.setPrimaryTarget(null);
    this.toastSystem.showGameEvent("🎯 All targets cleared");
    console.log('🎯 Cleared all targets');
  }

  private cycleTargets(): void {
    if (!this.playerAssembly || this.playerAssembly.destroyed) return;

    const lockedTargets = this.getLockedTargets(this.playerAssembly);
    if (lockedTargets.length === 0) {
      this.selectNearestEnemy();
      return;
    }

    // Find current primary target index
    const currentIndex = this.playerAssembly.primaryTarget
      ? lockedTargets.findIndex(t => t.id === this.playerAssembly!.primaryTarget!.id)
      : -1;

    // Select next target in the list
    const nextIndex = (currentIndex + 1) % lockedTargets.length;
    const nextTarget = lockedTargets[nextIndex];

    this.playerAssembly.setPrimaryTarget(nextTarget);
    console.log(`🎯 Cycled to target: ${nextTarget.shipName}`);
  }
}
