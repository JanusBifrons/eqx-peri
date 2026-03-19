import * as Matter from 'matter-js';
import Stats from 'stats.js';
import { Assembly } from './Assembly';
import { Entity } from './Entity';
import { EntityConfig, GRID_SIZE, ENTITY_DEFINITIONS, EntityType, ScenarioConfig, SCENARIOS, SHIP_SPAWN_SPACING, Vector2, PerformanceMetrics, isStructuralBlock, StructureType } from '../../types/GameTypes';
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
import { ShockwaveRenderer } from '../rendering/ShockwaveRenderer';
import { ParticleRenderer } from '../rendering/ParticleRenderer';
import { StarfieldRenderer } from '../rendering/StarfieldRenderer';
import { StrategicIconRenderer } from '../rendering/StrategicIconRenderer';
import { ParticleSystem } from '../systems/ParticleSystem';
import { AsteroidFieldSystem } from '../systems/AsteroidFieldSystem';
import { StructureManager } from '../structures/StructureManager';
import { Structure } from '../structures/Structure';
import { StructureRenderer } from '../rendering/StructureRenderer';
import { ConnectionRenderer } from '../rendering/ConnectionRenderer';
import { StructurePlacementSystem } from '../systems/StructurePlacementSystem';
import { StructurePlacementRenderer } from '../rendering/StructurePlacementRenderer';

export class GameEngine {
  private engine: Matter.Engine;
  private render: Matter.Render; private world: Matter.World;
  private renderSystem!: RenderSystem;
  private container!: HTMLElement;
  private assemblies: Assembly[] = [];
  private lasers: Matter.Body[] = [];
  private missileSystem: MissileSystem;
  private beamSystem!: BeamSystem;
  private shockwaveRenderer!: ShockwaveRenderer;
  private particleSystem!: ParticleSystem;
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
  private selectedStructure: Structure | null = null;
  private hoveredStructure: Structure | null = null;
  // Player command system
  private playerCommand: string | null = null;
  private playerCommandTarget: Assembly | null = null;
  private zoomLevel: number = 0.05; // Will be calculated based on window size
  private minZoom: number = 1 / 15; // Maximum 15× zoom out
  private maxZoom: number = 4; // Allow zooming in more
  private lastFrameTime: number = 0;
  private controllerManager: ControllerManager = new ControllerManager();
  private flightController: FlightController | null = null;  // Advanced flight control  // Zoom control properties
  private baseZoomLevel: number = 0.05; // Current eased base zoom (lerps toward targetBaseZoomLevel)
  private targetBaseZoomLevel: number = 0.05; // Desired zoom set by scroll/piloting; baseZoomLevel eases here
  private speedBasedZoomEnabled: boolean = true;
  private lastManualZoomTime: number = 0; // Track when player last manually adjusted zoom
  private manualZoomCooldown: number = 2000; // 2 seconds of reduced speed-based zoom after manual adjustment

  // Inertial dampening — linear velocity damping applied to the player body each frame when on
  private inertialDampeningEnabled: boolean = true;
  private readonly INERTIAL_DAMPENING_FACTOR: number = 0.985; // 1.5% velocity loss per frame at 60 fps

  // Stats.js for FPS monitoring
  private stats: Stats;

  // Performance metrics tracking
  private perfFrameCount: number = 0;          // frames counted in current 1s window
  private perfFpsWindowStart: number = 0;      // timestamp when current window began
  private perfDisplayFps: number = 0;          // last committed FPS value
  private perfLastTickMs: number = 0;
  // Tracks pre-solver velocities of shielded assemblies hit this frame.
  // Used by afterUpdate to undo 60% of the impulse (shield absorption).
  private shieldImpactVelocities: Map<string, { x: number; y: number }> = new Map();

  private perfCollisionEventsInWindow: number = 0;
  private perfCollisionWindowStart: number = 0;
  private perfCollisionsPerSecond: number = 0;
  private perfMemorySamples: number[] = [];    // MB samples, capped at 5
  private perfMemoryLastSampleTime: number = 0;


  private scenarioConfig: ScenarioConfig = SCENARIOS['debug'];

  // Ship builder mode state
  private shipBuilderMode: boolean = false;
  private shipBuilderAssembly: Assembly | null = null;

  // Toast system for game events
  private toastSystem: ToastSystem;

  // Block pickup system for drag-and-attach building
  private blockPickupSystem!: BlockPickupSystem;

  // Procedural asteroid field (null when the current scenario doesn't use one)
  private asteroidFieldSystem: AsteroidFieldSystem | null = null;

  // Structure system (null when the current scenario doesn't use structures)
  private structureManager: StructureManager | null = null;
  private structurePlacementSystem: StructurePlacementSystem | null = null;

  // Current mouse position in world coordinates (updated every frame)
  private mouseWorldPos: Vector2 = { x: 0, y: 0 };

  // Set to true when a drag-and-drop just completed so the subsequent click event is suppressed
  private dragJustCompleted: boolean = false;

  // Observer-mode camera state
  private observerPos: { x: number; y: number } = { x: 0, y: 0 };
  private readonly OBSERVER_PAN_SPEED = 600;  // world units/s at zoom 1
  private readonly EDGE_SCROLL_MARGIN = 8;    // CSS px from canvas edge that triggers scroll
  private lastTouchDistance: number = 0;
  private touchStartPos: { x: number; y: number } | null = null;
  // Mouse drag-to-pan state (observer mode)
  private observerDragActive: boolean = false;
  private observerDragLastScreenPos: { x: number; y: number } | null = null;
  private observerDragStartScreenPos: { x: number; y: number } | null = null;

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

    // Set global friction to zero for space-like physics (bodies already created with 0)
    this.engine.world.bodies.forEach(body => {
      body.frictionAir = 0;
      body.friction = 0;
    });

    // Angular damping for spinning debris — only check dynamic (non-static) bodies
    // to avoid iterating hundreds of static asteroid bodies every physics tick.
    Matter.Events.on(this.engine, 'beforeUpdate', () => {
      for (const assembly of this.assemblies) {
        const body = assembly.rootBody;
        if (Math.abs(body.angularVelocity) > 0.1) {
          Matter.Body.setAngularVelocity(body, body.angularVelocity * 0.98);
        }
      }
      // Keep the builder assembly frozen at its current position (no drift from impulses)
      if (this.shipBuilderMode && this.shipBuilderAssembly && !this.shipBuilderAssembly.destroyed) {
        const body = this.shipBuilderAssembly.rootBody;
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
        Matter.Body.setAngularVelocity(body, 0);
      }
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
      (assembly) => { this.assemblies.push(assembly); },
      (constraint) => Matter.World.add(this.world, constraint),
      (constraint) => Matter.World.remove(this.world, constraint),
    );

    // Initialize mouse interaction
    this.setupMouseInteraction();
    this.setupEventListeners();
    this.setupCollisionDetection();

    // Build the rendering pipeline
    this.setupRenderSystem();
  }

  private calculateDefaultZoom(containerWidth: number, containerHeight: number): void {
    // Show ~2000 world units across the canvas width by default.
    // This gives a sensible battlefield overview on all screen sizes —
    // larger monitors naturally see more of the world at the same pixel density.
    const TARGET_WORLD_WIDTH = 2000;
    const baseZoom = containerWidth / TARGET_WORLD_WIDTH;

    this.baseZoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, baseZoom));
    this.targetBaseZoomLevel = this.baseZoomLevel;
    this.zoomLevel = this.baseZoomLevel;

    console.log(`🔍 Default zoom: ${this.baseZoomLevel.toFixed(2)} for ${containerWidth}×${containerHeight}`);
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

    this.targetBaseZoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, targetZoom));
    // Do not snap zoomLevel — let it ease toward the new target via updateSpeedBasedZoom.
    // Only hard-snap baseZoomLevel on initial construction (zoomLevel == baseZoomLevel == 0.05).
    if (this.zoomLevel === this.baseZoomLevel && this.baseZoomLevel === 0.05) {
      this.baseZoomLevel = this.targetBaseZoomLevel;
      this.zoomLevel = this.baseZoomLevel;
    }

    console.log(`🔍 Ship-based zoom target: ${this.targetBaseZoomLevel.toFixed(3)} (ship bounds: ${Math.round(shipWidth)}×${Math.round(shipHeight)})`);
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
            this.blockPickupSystem.rotateHeld(); // Rotate held block 90° CCW relative to player
          } else if (!this.shipBuilderMode) {
            this.initializeBattle(); // Restart battle (disabled in ship builder)
          }
          break;
        case 'g':
          this.toggleGrid();
          break;
        case 'e':
          if (this.playerAssembly && this.canPlayerEject()) {
            this.ejectPlayer();
          }
          break;
        case 'p':
          if (this.selectedAssembly && !this.selectedAssembly.isPlayerControlled) {
            this.pilotAssembly(this.selectedAssembly);
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
        case 'escape':
          if (this.structurePlacementSystem?.isActive()) {
            this.structurePlacementSystem.cancel();
            // Prevent App.tsx's Escape handler from also opening the confirm dialog
            event.stopImmediatePropagation();
          }
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
  } /**
   * Check if a shield collision pair is friendly (same team).  If so, disable
   * the pair so the solver skips it — the bodies pass through each other.
   * Returns true if the pair was disabled (caller should skip further handling).
   */
  private tryDisableFriendlyShieldPair(
    pair: { isActive?: boolean },
    shieldAssembly: Assembly,
    otherBody: Matter.Body,
  ): boolean {
    const shieldTeam = shieldAssembly.getTeam();
    // Team -1 is neutral/debris — never counts as "friendly".
    if (shieldTeam < 0) return false;

    if ((otherBody as any).entity) {
      const otherAssembly = this.assemblies.find(a => a.entities.includes((otherBody as any).entity));
      if (otherAssembly && otherAssembly.getTeam() === shieldTeam) {
        pair.isActive = false;
        return true;
      }
    } else if ((otherBody as any).isMissile) {
      if ((otherBody as any).missile.sourceTeam === shieldTeam) {
        pair.isActive = false;
        return true;
      }
    }
    return false;
  }

  /**
   * For an enemy shield collision, record the shielded assembly's pre-solver
   * velocity so afterUpdate can undo 60% of the impulse (shield absorption).
   */
  private recordShieldImpactVelocity(shieldAssembly: Assembly): void {
    if (!this.shieldImpactVelocities.has(shieldAssembly.id)) {
      this.shieldImpactVelocities.set(shieldAssembly.id, {
        x: shieldAssembly.rootBody.velocity.x,
        y: shieldAssembly.rootBody.velocity.y,
      });
    }
  }

  private setupCollisionDetection(): void {
    // Matter.js event order: collisionStart/Active fire BEFORE the solver,
    // so setting pair.isActive = false prevents the impulse from being applied.

    Matter.Events.on(this.engine, 'collisionStart', (event: { pairs: { bodyA: Matter.Body; bodyB: Matter.Body; isActive?: boolean }[] }) => {
      this.perfCollisionEventsInWindow += event.pairs.length;
      event.pairs.forEach(pair => {
        const { bodyA, bodyB } = pair;

        // Laser collisions are handled by the beforeUpdate raycast (setupLaserRaycast).
        // Skip any laser pairs that leak through from the physics step.
        if (bodyA.isLaser || bodyB.isLaser) {
          return;
        }

        // --- Shield pair handling: friendly pass-through + absorption tracking ---
        const aIsShield = (bodyA as any).isShieldPart;
        const bIsShield = (bodyB as any).isShieldPart;
        if (aIsShield || bIsShield) {
          const shieldBody = aIsShield ? bodyA : bodyB;
          const otherBody = aIsShield ? bodyB : bodyA;
          const shieldAssembly = (shieldBody as any).parentAssembly as Assembly;

          if (this.tryDisableFriendlyShieldPair(pair, shieldAssembly, otherBody)) {
            return; // friendly — solver will skip this pair
          }
          // Enemy shield collision — record pre-solver velocity for 60% absorption.
          this.recordShieldImpactVelocity(shieldAssembly);
        }

        // --- Normal collision dispatch ---
        // Check for missile collisions
        if ((bodyA as any).isMissile && bodyB.entity) {
          this.handleMissileHit((bodyA as any).missile, bodyB.entity);
        } else if ((bodyB as any).isMissile && bodyA.entity) {
          this.handleMissileHit((bodyB as any).missile, bodyA.entity);
        } else if ((bodyA as any).isMissile && (bodyB as any).isShieldPart) {
          this.handleMissileHitShield((bodyA as any).missile, (bodyB as any).parentAssembly);
        } else if ((bodyB as any).isMissile && (bodyA as any).isShieldPart) {
          this.handleMissileHitShield((bodyB as any).missile, (bodyA as any).parentAssembly);
        }
        // Missile hitting a structure
        else if ((bodyA as any).isMissile && (bodyB as any).structure) {
          this.handleMissileHitStructure((bodyA as any).missile, (bodyB as any).structure as Structure);
        } else if ((bodyB as any).isMissile && (bodyA as any).structure) {
          this.handleMissileHitStructure((bodyB as any).missile, (bodyA as any).structure as Structure);
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

    // collisionActive: disable friendly shield pairs every frame so the solver
    // never pushes same-team bodies apart.  No damage/flash here — that is
    // collisionStart-only to avoid the permanent-white-glow bug.
    Matter.Events.on(this.engine, 'collisionActive', (event: { pairs: { bodyA: Matter.Body; bodyB: Matter.Body; isActive?: boolean }[] }) => {
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        const aIsShield = (bodyA as any).isShieldPart;
        const bIsShield = (bodyB as any).isShieldPart;
        if (!aIsShield && !bIsShield) continue;

        const shieldBody = aIsShield ? bodyA : bodyB;
        const otherBody = aIsShield ? bodyB : bodyA;
        const shieldAssembly = (shieldBody as any).parentAssembly as Assembly;

        if (!this.tryDisableFriendlyShieldPair(pair, shieldAssembly, otherBody)) {
          // Enemy sustained contact — keep recording for absorption correction.
          this.recordShieldImpactVelocity(shieldAssembly);
        }
      }
    });

    // afterUpdate: the solver has now applied impulses.  For shielded assemblies
    // that took a shield hit this frame, undo 60% of the velocity change so
    // only 40% of the impact is felt.
    Matter.Events.on(this.engine, 'afterUpdate', () => {
      for (const [assemblyId, preVel] of this.shieldImpactVelocities) {
        const assembly = this.assemblies.find(a => a.id === assemblyId);
        if (!assembly) continue;
        const body = assembly.rootBody;
        const deltaX = body.velocity.x - preVel.x;
        const deltaY = body.velocity.y - preVel.y;
        if (Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001) {
          Matter.Body.setVelocity(body, {
            x: preVel.x + deltaX * 0.4,
            y: preVel.y + deltaY * 0.4,
          });
        }
      }
      this.shieldImpactVelocities.clear();
    });

    this.setupLaserRaycast();
  }

  /**
   * Pre-physics raycast: each frame before Matter.js moves laser bodies,
   * cast a ray along each laser's velocity to find the first thing it will
   * hit this tick (entity, shield, or asteroid).  This prevents lasers from
   * ever rendering inside a target and gives exact surface-edge impact
   * positions for particle effects.
   */
  private setupLaserRaycast(): void {
    Matter.Events.on(this.engine, 'beforeUpdate', () => {
      if (this.lasers.length === 0) return;

      // Build candidate body list: all assembly part bodies + asteroid bodies + structure bodies.
      // Skip index-0 of compound parts (the compound root has no real geometry).
      const candidateBodies: Matter.Body[] = [];
      for (const assembly of this.assemblies) {
        const parts = assembly.rootBody.parts;
        for (let i = parts.length > 1 ? 1 : 0; i < parts.length; i++) {
          candidateBodies.push(parts[i]);
        }
      }
      const asteroidBodies = this.asteroidFieldSystem?.getAllBodies() ?? [];
      for (const ab of asteroidBodies) candidateBodies.push(ab);
      const structureBodies = this.structureManager?.getStructures().map(s => s.body) ?? [];
      for (const sb of structureBodies) candidateBodies.push(sb);

      if (candidateBodies.length === 0) return;

      // Process each laser — collect hits, then handle them after the loop
      // (handling mutates the lasers array).
      const laserHits: Array<{
        laser: Matter.Body;
        hitBody: Matter.Body;
        hitPos: Matter.Vector;
      }> = [];

      for (const laser of this.lasers) {
        const vel = laser.velocity;
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
        if (speed < 0.1) continue;

        const nx = vel.x / speed;
        const ny = vel.y / speed;

        // Laser body length ≈ 1.5× per-tick travel; half-length ≈ 0.75× speed.
        // Cast from trailing tip to one full tick past the leading tip.
        const halfLen = speed * 0.75;
        const from = {
          x: laser.position.x - nx * halfLen,
          y: laser.position.y - ny * halfLen,
        };
        const to = {
          x: laser.position.x + nx * (halfLen + speed),
          y: laser.position.y + ny * (halfLen + speed),
        };

        const rayHits = Matter.Query.ray(candidateBodies, from, to);
        if (rayHits.length === 0) continue;

        // Find the closest surface intersection across all hit bodies.
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        let closestT = Infinity;
        let closestBody: Matter.Body | null = null;

        for (const rh of rayHits) {
          // Matter.js types for Query.ray are incomplete; body is a runtime field
          const body = (rh as any).body as Matter.Body;
          if (!body) continue;

          // Skip self — don't let a laser hit its own ship
          const sourceId = (laser as any).sourceAssemblyId;
          if (sourceId && body.assembly?.id === sourceId) continue;

          // Turret laser: skip same-team assemblies and same-team structures
          const sourceStructId = (laser as any).sourceStructureId as string | undefined;
          const sourceTeam = (laser as any).sourceTeam as number | undefined;
          if (sourceStructId) {
            // Don't hit same-team assemblies
            if (sourceTeam !== undefined && sourceTeam >= 0 && body.assembly) {
              if (body.assembly.getTeam() === sourceTeam) continue;
            }
            // Don't hit same-team structures (including self)
            const hitStructure = (body as any).structure as Structure | undefined;
            if (hitStructure && sourceTeam !== undefined && hitStructure.team === sourceTeam) continue;
          }

          // Skip friendly shields — same-team weapons pass through allied shield fields.
          if ((body as any).isShieldPart) {
            const shieldOwner = (body as any).parentAssembly as Assembly | undefined;
            if (shieldOwner && sourceId) {
              const sourceAssembly = this.assemblies.find(a => a.id === sourceId);
              if (sourceAssembly && sourceAssembly.getTeam() >= 0 && sourceAssembly.getTeam() === shieldOwner.getTeam()) continue;
            }
            // Turret lasers also pass through friendly shields
            if (shieldOwner && sourceTeam !== undefined && sourceTeam >= 0 && shieldOwner.getTeam() === sourceTeam) continue;
          }

          // Ray-edge intersection (Cramer's rule) against the body polygon
          const verts = body.vertices;
          for (let i = 0; i < verts.length; i++) {
            const a = verts[i];
            const b = verts[(i + 1) % verts.length];
            const ex = b.x - a.x;
            const ey = b.y - a.y;
            const det = dx * (-ey) - dy * (-ex);
            if (Math.abs(det) < 1e-10) continue;
            const t = ((a.x - from.x) * (-ey) - (a.y - from.y) * (-ex)) / det;
            const s = (dx * (a.y - from.y) - dy * (a.x - from.x)) / det;
            if (t >= 0 && t <= 1 && s >= 0 && s <= 1 && t < closestT) {
              closestT = t;
              closestBody = body;
            }
          }
        }

        if (!closestBody) continue;

        const hitPos = closestT < Infinity
          ? { x: from.x + dx * closestT, y: from.y + dy * closestT }
          : laser.position;

        laserHits.push({ laser, hitBody: closestBody, hitPos });
      }

      // Dispatch each hit to the appropriate handler
      for (const { laser, hitBody, hitPos } of laserHits) {
        if ((hitBody as any).isShieldPart) {
          this.handleLaserHitShield(laser, (hitBody as any).parentAssembly, hitPos);
        } else if (hitBody.entity) {
          this.handleLaserHit(laser, hitBody.entity, hitPos);
        } else if ((hitBody as any).structure) {
          this.handleLaserHitStructure(laser, (hitBody as any).structure as Structure, hitPos);
        } else if (hitBody.label === 'asteroid') {
          this.handleLaserHitAsteroid(laser, hitPos);
        }
      }
    });
  }

  private handleEntityCollision(entityA: Entity, entityB: Entity): void {
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
        // when active. Friendly collisions (same team) bypass shields entirely.
        const assemblyA = this.assemblies.find(a => a.entities.includes(entityA));
        const assemblyB = this.assemblies.find(a => a.entities.includes(entityB));
        const sameTeam = assemblyA && assemblyB && assemblyA.getTeam() >= 0 && assemblyA.getTeam() === assemblyB.getTeam();

        if (damageA > 0 && !((!sameTeam) && assemblyA?.damageShield(damageA, now))) {
          entityA.takeDamage(damageA);
        }
        if (damageB > 0 && !((!sameTeam) && assemblyB?.damageShield(damageB, now))) {
          entityB.takeDamage(damageB);
        }
      }
    }
  } private handleLaserHit(laser: Matter.Body, entity: Entity, hitPos: Matter.Vector): void {
    const LASER_DAMAGE = 10;
    const sourceAssemblyId = (laser as any).sourceAssemblyId;
    const hitAssembly = this.assemblies.find(a => a.entities.includes(entity));

    if (sourceAssemblyId) {
      if (hitAssembly && hitAssembly.id === sourceAssemblyId) return; // self-hit

      if (hitAssembly) {
        const sourceAssembly = this.assemblies.find(a => a.id === sourceAssemblyId);
        hitAssembly.lastHitByAssemblyId = sourceAssemblyId;
        hitAssembly.lastHitByPlayer = sourceAssembly?.isPlayerControlled || false;
      }
    }

    Matter.World.remove(this.world, laser);
    this.lasers = this.lasers.filter(l => l !== laser);

    // Play impact sound
    SoundSystem.getInstance().playLaserImpact();

    // Shield interception — if active the field absorbs the hit entirely.
    // Friendly weapons bypass allied shields (same team).
    const laserSourceAssembly = sourceAssemblyId ? this.assemblies.find(a => a.id === sourceAssemblyId) : undefined;
    const isFriendlyFire = laserSourceAssembly && hitAssembly && laserSourceAssembly.getTeam() >= 0 && laserSourceAssembly.getTeam() === hitAssembly.getTeam();
    if (!isFriendlyFire && hitAssembly?.damageShield(LASER_DAMAGE, Date.now())) {
      hitAssembly.entities
        .filter(e => (e.type === 'Shield' || e.type === 'LargeShield') && !e.destroyed)
        .forEach(e => e.triggerCollisionFlash());
      return;
    }

    if (!entity.destroyed) entity.triggerCollisionFlash();

    // Laser impact sparks at the exact surface intersection
    this.particleSystem.emitImpact(hitPos.x, hitPos.y, 'laser');

    const entityDestroyed = entity.takeDamage(LASER_DAMAGE);
    if (!entityDestroyed) return;

    if (!hitAssembly) return;
    this.processEntityDestruction(entity, hitAssembly);
  }

  /**
   * Shared destruction cascade used by both laser hits and beam hits.
   * Call only after entity.takeDamage() has returned true (i.e. the entity is confirmed destroyed).
   */
  private processEntityDestruction(entity: Entity, assembly: Assembly): void {
    SoundSystem.getInstance().playBlockDestroyed();

    // Capture the old compound body BEFORE removeEntity() can replace assembly.rootBody
    // via createFreshBody().  We need it to properly swap the physics world entry.
    const oldRootBody = assembly.rootBody;
    const wasPlayerControlled = assembly.isPlayerControlled;
    // Capture entity count before removal so we can size the shockwave if this is the last block.
    const entityCountBeforeRemoval = assembly.entities.length;

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
      this.shockwaveRenderer.addShockwave(
        oldRootBody.position.x,
        oldRootBody.position.y,
        entityCountBeforeRemoval,
      );
      this.particleSystem.emitExplosion(
        oldRootBody.position.x,
        oldRootBody.position.y,
        entityCountBeforeRemoval,
        oldRootBody.velocity.x * 0.001,
        oldRootBody.velocity.y * 0.001,
      );
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
    this.particleSystem.emitImpact(entity.body.position.x, entity.body.position.y, 'beam');
    this.processEntityDestruction(entity, hitAssembly);
  }

  private handleMissileHit(missile: any, entity: Entity): void {
    const hitX: number = missile.body.position.x;
    const hitY: number = missile.body.position.y;
    const hit = this.missileSystem.handleMissileHit(missile, entity);
    if (hit) {
      this.particleSystem.emitImpact(hitX, hitY, 'missile');
    }
  }

  private handleLaserHitShield(laser: Matter.Body, shieldAssembly: Assembly, _hitPos: Matter.Vector): void {
    const LASER_DAMAGE = 10;
    const sourceAssemblyId = (laser as any).sourceAssemblyId;

    // Self-hit prevention — don't let a ship's own lasers hit its own shield.
    if (sourceAssemblyId && shieldAssembly.id === sourceAssemblyId) return;

    // Friendly fire prevention — same-team weapons pass through allied shields.
    if (sourceAssemblyId) {
      const sourceAssembly = this.assemblies.find(a => a.id === sourceAssemblyId);
      if (sourceAssembly && sourceAssembly.getTeam() >= 0 && sourceAssembly.getTeam() === shieldAssembly.getTeam()) return;
      shieldAssembly.lastHitByAssemblyId = sourceAssemblyId;
      shieldAssembly.lastHitByPlayer = sourceAssembly?.isPlayerControlled || false;
    }

    Matter.World.remove(this.world, laser);
    this.lasers = this.lasers.filter(l => l !== laser);
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

  private handleLaserHitAsteroid(laser: Matter.Body, hitPos: Matter.Vector): void {
    Matter.World.remove(this.world, laser);
    this.lasers = this.lasers.filter(l => l !== laser);
    SoundSystem.getInstance().playLaserImpact();
    this.particleSystem.emitImpact(hitPos.x, hitPos.y, 'laser');
  }

  private handleLaserHitStructure(laser: Matter.Body, structure: Structure, hitPos: Matter.Vector): void {
    const LASER_DAMAGE = 10;
    Matter.World.remove(this.world, laser);
    this.lasers = this.lasers.filter(l => l !== laser);
    SoundSystem.getInstance().playLaserImpact();
    this.particleSystem.emitImpact(hitPos.x, hitPos.y, 'laser');
    structure.takeDamage(LASER_DAMAGE);
  }

  private handleMissileHitStructure(missile: { age: number; launchCollisionDelay: number; getDamage: () => number; destroy: () => void }, structure: Structure): void {
    if (missile.age < missile.launchCollisionDelay) return;
    SoundSystem.getInstance().playMissileExplosion();
    this.particleSystem.emitImpact(structure.body.position.x, structure.body.position.y, 'missile');
    structure.takeDamage(missile.getDamage());
    missile.destroy();
  }

  private handleMissileHitShield(missile: any, shieldAssembly: Assembly): void {
    if (!missile || !shieldAssembly) return;

    // Launch delay — missiles shouldn't collide immediately after launch.
    if (missile.age < missile.launchCollisionDelay) return;

    // Self-hit prevention.
    if (missile.sourceAssemblyId === shieldAssembly.id) return;

    // Friendly fire prevention — same-team missiles pass through allied shields.
    const sourceAssembly = this.assemblies.find(a => a.id === missile.sourceAssemblyId);
    if (sourceAssembly && sourceAssembly.getTeam() >= 0 && sourceAssembly.getTeam() === shieldAssembly.getTeam()) return;

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

    // Friendly ships pass through allied shields with no interaction.
    // Team -1 (neutral/debris) is never "friendly".
    if (entityAssembly && entityAssembly.getTeam() >= 0 && entityAssembly.getTeam() === shieldAssembly.getTeam()) return;

    // Flash shield blocks on impact.
    shieldAssembly.entities
      .filter(e => (e.type === 'Shield' || e.type === 'LargeShield') && !e.destroyed)
      .forEach(e => { if (!e.isFlashing) e.triggerCollisionFlash(); });
    if (!entity.isFlashing) entity.triggerCollisionFlash();

    // Collision damage — the impact energy is absorbed by the shield as damage.
    // The shielded ship is unaffected (shield parts are sensors, no physical impulse).
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

    // Cleanup asteroid field
    this.asteroidFieldSystem?.dispose();
    this.asteroidFieldSystem = null;

    // Cleanup structure system
    this.structureManager?.dispose();
    this.structureManager = null;
    this.structurePlacementSystem = null;

  } private gameLoop(): void {
    if (!this.running) return;

    // Calculate delta time
    const currentTime = performance.now();
    const deltaTime = (currentTime - (this.lastFrameTime || currentTime)) / 1000; // Convert ms to seconds
    this.lastFrameTime = currentTime;

    // Count frames in a 1-second window for accurate FPS
    this.perfFrameCount++;
    if (this.perfFpsWindowStart === 0) this.perfFpsWindowStart = currentTime;
    const fpsDelta = currentTime - this.perfFpsWindowStart;
    if (fpsDelta >= 1000) {
      this.perfDisplayFps = Math.round(this.perfFrameCount * 1000 / fpsDelta);
      this.perfFrameCount = 0;
      this.perfFpsWindowStart = currentTime;
    }

    // Roll the 1-second collision window
    if (this.perfCollisionWindowStart === 0) this.perfCollisionWindowStart = currentTime;
    if (currentTime - this.perfCollisionWindowStart >= 1000) {
      this.perfCollisionsPerSecond = this.perfCollisionEventsInWindow;
      this.perfCollisionEventsInWindow = 0;
      this.perfCollisionWindowStart = currentTime;
    }

    // Sample memory once per second, keep a 5-sample rolling window (~5 s average)
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    if (mem && currentTime - this.perfMemoryLastSampleTime >= 1000) {
      this.perfMemorySamples.push(mem.usedJSHeapSize / 1048576);
      if (this.perfMemorySamples.length > 5) this.perfMemorySamples.shift();
      this.perfMemoryLastSampleTime = currentTime;
    }

    const tickStart = performance.now();

    // Update cursor position for weapon aiming (every frame)
    this.updateCursorWorldPosition();
    this.structurePlacementSystem?.updateCursor(this.mouseWorldPos);

    // Provide structure bodies to beam system for hit detection
    this.controllerManager.setBeamExtraBodies(
      this.structureManager?.getStructures().map(s => s.body) ?? [],
    );

    // Update controllers (handles both player input and AI)
    const newLasers = this.controllerManager.update(deltaTime, this.assemblies);

    // Add new lasers to physics world
    if (newLasers.length > 0) {
      // Play laser fire sound (once per batch to avoid audio spam)
      SoundSystem.getInstance().playLaserFire();
    }
    newLasers.forEach(laser => {
      Matter.World.add(this.world, laser);
      this.lasers.push(laser);
    });

    // Handle additional player input (mouse controls, etc.)
    this.handlePlayerInput();

    // Update assemblies (deltaTime is in seconds; update() expects milliseconds)
    const deltaTimeMs = deltaTime * 1000;
    this.assemblies.forEach(assembly => {
      assembly.update(deltaTimeMs);
      assembly.updateWeaponAiming();
    });

    // Process any body swaps queued by Assembly.update() (e.g. collision damage destroyed an
    // entity mid-frame).  handleLaserHit clears pendingBodySwap itself; this catches the
    // collision-damage path where Assembly.update() calls createFreshBody() independently.
    this.assemblies.forEach(assembly => {
      if (assembly.pendingBodySwap) {
        this.removeBodyWithParts(assembly.pendingBodySwap.oldBody);
        Matter.World.add(this.world, assembly.rootBody);
        assembly.pendingBodySwap = null;
      }
    });

    // Update BlockPickupSystem: reposition ghost and refresh snap candidate
    this.blockPickupSystem.update(this.mouseWorldPos, this.mousePosition, this.getBlockSnapTarget());

    // Update entity flash effects
    this.updateEntityFlashes(deltaTime);

    // Update lasers (TTL, out-of-bounds removal)
    this.updateLasers();

    // Update missile system (targeting, steering, fuel consumption)
    this.missileSystem.update(deltaTime, this.assemblies);

    // Update beam system (age out expired visual beams)
    this.beamSystem.update(deltaTime);

    // Clean up destroyed assemblies
    this.cleanupDestroyedAssemblies();

    // Transition to observer mode when the piloted ship is destroyed or loses its cockpit
    if (this.playerAssembly &&
        (this.playerAssembly.destroyed || !this.playerAssembly.hasControlCenter())) {
      this.observerPos = { ...this.playerAssembly.rootBody.position };
      if (this.blockPickupSystem.isHolding()) this.blockPickupSystem.forceDropAtCurrentPosition();
      this.controllerManager.removeController(this.playerAssembly.id);
      // If the cockpit survived as a fragment, hand it back to AI
      const cockpitFrag = this.assemblies.find(
        a => a.hasControlCenter() && a.isPlayerControlled && !a.destroyed
      );
      if (cockpitFrag) {
        cockpitFrag.isPlayerControlled = false;
        const ai = this.controllerManager.createAIController(cockpitFrag);
        ai.setAggressionLevel(0.8);
      }
      this.playerAssembly = null;
      this.flightController = null;
      PowerSystem.getInstance().setPlayerAssembly(null);
      this.toastSystem.showWarning('Ship destroyed — observer mode');
    }

    // Execute player commands (follow, orbit, lockOn, etc.)
    this.executePlayerCommands();

    // Update camera — pilot mode or observer mode
    this.updateCamera(deltaTime);

    // Update structure system (remove destroyed structures, tick turrets)
    if (this.structureManager) {
      const turretLasers = this.structureManager.update(deltaTimeMs, this.assemblies);
      for (const laser of turretLasers) {
        this.lasers.push(laser);
        Matter.World.add(this.world, laser);
      }
    }

    // Stream asteroid chunks in/out based on camera position
    if (this.asteroidFieldSystem) {
      const b = this.render.bounds;
      const halfW = (b.max.x - b.min.x) / 2;
      const halfH = (b.max.y - b.min.y) / 2;
      const viewportHalfDiag = Math.hypot(halfW, halfH);
      this.asteroidFieldSystem.update(this.getCameraCenter(), viewportHalfDiag);
    }

    // Update zoom based on speed
    this.updateSpeedBasedZoom();

    // Record game-loop tick duration (excludes rendering, which runs in RenderSystem)
    this.perfLastTickMs = performance.now() - tickStart;

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

  private updateLasers(): void {
    const lasersToRemove: Matter.Body[] = [];

    this.lasers.forEach(laser => {
      // Check time to live
      if (laser.timeToLive && Date.now() > laser.timeToLive) {
        lasersToRemove.push(laser);
      }

      // Check if laser is out of bounds
      const bounds = this.render.bounds;
      if (laser.position.x < bounds.min.x - 100 ||
        laser.position.x > bounds.max.x + 100 ||
        laser.position.y < bounds.min.y - 100 ||
        laser.position.y > bounds.max.y + 100) {
        lasersToRemove.push(laser);
      }
    });

    // Remove expired lasers
    lasersToRemove.forEach(laser => {
      Matter.World.remove(this.world, laser);
      this.lasers = this.lasers.filter(l => l !== laser);
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

      // Observer drag-to-pan
      if (this.observerDragLastScreenPos && !this.playerAssembly && !this.blockPickupSystem.isHolding()) {
        const sx = this.mousePosition.x;
        const sy = this.mousePosition.y;
        // Activate once moved > 5 CSS px from where the button went down
        if (!this.observerDragActive && this.observerDragStartScreenPos) {
          const ddx = sx - this.observerDragStartScreenPos.x;
          const ddy = sy - this.observerDragStartScreenPos.y;
          if (Math.sqrt(ddx * ddx + ddy * ddy) > 5) this.observerDragActive = true;
        }
        if (this.observerDragActive) {
          const prev = this.screenToWorld(this.observerDragLastScreenPos.x, this.observerDragLastScreenPos.y);
          const curr = this.screenToWorld(sx, sy);
          this.observerPos.x -= curr.x - prev.x;
          this.observerPos.y -= curr.y - prev.y;
          this.observerDragLastScreenPos = { x: sx, y: sy };
        }
      }

      if (this.blockPickupSystem.isHolding()) {
        // Actively dragging — skip hover detection and show grabbing cursor
        this.setHoveredAssembly(null);
        this.render.canvas.style.cursor = 'grabbing';
      } else if (this.blockPickupSystem.isPendingPickup()) {
        // Mousedown on a block, waiting for hold/drag threshold — keep grab cursor
        this.setHoveredAssembly(null);
        this.render.canvas.style.cursor = 'grab';
      } else if (this.observerDragActive) {
        this.render.canvas.style.cursor = 'grabbing';
      } else if (!this.playerAssembly && this.observerDragLastScreenPos) {
        // Mouse is down in observer mode but drag not yet started
        this.render.canvas.style.cursor = 'grab';
      } else {
        // Normal hover detection (assemblies and structures)
        const hoveredAssembly = this.getAssemblyAtPosition(this.mousePosition.x, this.mousePosition.y);
        this.setHoveredAssembly(hoveredAssembly);
        this.hoveredStructure = hoveredAssembly ? null : this.getStructureAtPosition(this.mousePosition.x, this.mousePosition.y);

        // Cursor style: grab hand over pickable blocks, crosshair otherwise
        if (hoveredAssembly && !hoveredAssembly.hasControlCenter() && hoveredAssembly !== this.playerAssembly) {
          this.render.canvas.style.cursor = 'grab';
        } else if (hoveredAssembly === this.playerAssembly && this.playerAssembly) {
          // Check if hovering a detachable block on the player's own ship
          const cursorWorld = this.screenToWorld(this.mousePosition.x, this.mousePosition.y);
          const isDetachable = this.playerAssembly.entities.some(e => {
            const b = e.body.bounds;
            return cursorWorld.x >= b.min.x && cursorWorld.x <= b.max.x &&
                   cursorWorld.y >= b.min.y && cursorWorld.y <= b.max.y &&
                   this.playerAssembly!.canDetachEntity(e);
          });
          this.render.canvas.style.cursor = isDetachable ? 'grab' : 'crosshair';
        } else if (!this.playerAssembly) {
          // Observer mode, hovering empty space — hint that panning is available
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

        // In observer mode, allow pre-detach from any friendly (team-0) cockpit ship under the cursor
        let pickupSource = this.playerAssembly;
        if (!pickupSource) {
          const hovered = this.getAssemblyAtPosition(screenX, screenY);
          if (hovered && hovered.team === 0 && hovered.hasControlCenter()) {
            pickupSource = hovered;
          }
        }
        // BlockPickupSystem intercepts clicks on non-cockpit assemblies (or pre-detach from source)
        if (this.blockPickupSystem.tryPickUp(worldPos, { x: screenX, y: screenY }, this.assemblies, pickupSource)) {
          this.mouseDown = false; // suppress weapon fire while holding
        } else {
          this.mouseDown = true;
          // Observer mode: begin tracking for drag-to-pan
          if (!this.playerAssembly) {
            this.observerDragLastScreenPos = { x: screenX, y: screenY };
            this.observerDragStartScreenPos = { x: screenX, y: screenY };
            this.observerDragActive = false;
          }
        }
      } else if (event.button === 2) { // Right mouse button
        if (this.structurePlacementSystem?.isActive()) {
          this.structurePlacementSystem.cancel();
        } else {
          this.handleRightClick(event);
        }
      }
    }); this.render.canvas.addEventListener('mouseup', (event) => {
      if (event.button === 0) {
        // Check before release — isDragging() is false after tryRelease() returns
        const wasDragging = this.blockPickupSystem.isDragging();
        // Always call tryRelease so pendingPickupState is cleared even on quick clicks
        this.blockPickupSystem.tryRelease();
        this.mouseDown = false;
        // Suppress the click event that fires after a drag pan or block drag
        this.dragJustCompleted = wasDragging || this.observerDragActive;
        // Reset observer drag state
        this.observerDragActive = false;
        this.observerDragLastScreenPos = null;
        this.observerDragStartScreenPos = null;
      }
    });    // Add click event for target selection
    this.render.canvas.addEventListener('click', (event) => {
      this.handleCanvasClick(event);
    });

    // Double-click locks on target (same as right-click targeting)
    this.render.canvas.addEventListener('dblclick', (event) => {
      if (this.blockPickupSystem.isHolding()) return;
      const rect = this.render.canvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const clickedAssembly = this.getAssemblyAtPosition(screenX, screenY);
      if (clickedAssembly && clickedAssembly !== this.playerAssembly) {
        this.handleTargetClick(clickedAssembly);
      }
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

    this.setupTouchControls();
  }

  private setupTouchControls(): void {
    const canvas = this.render.canvas;

    canvas.addEventListener('touchstart', (event: TouchEvent) => {
      event.preventDefault();
      SoundSystem.getInstance().resume();

      if (event.touches.length === 1) {
        const touch = event.touches[0];
        const rect = canvas.getBoundingClientRect();
        const screenX = touch.clientX - rect.left;
        const screenY = touch.clientY - rect.top;
        this.touchStartPos = { x: screenX, y: screenY };
        const worldPos = this.screenToWorld(screenX, screenY);
        let touchPickupSource = this.playerAssembly;
        if (!touchPickupSource) {
          const hovered = this.getAssemblyAtPosition(screenX, screenY);
          if (hovered && hovered.team === 0 && hovered.hasControlCenter()) touchPickupSource = hovered;
        }
        this.blockPickupSystem.tryPickUp(worldPos, { x: screenX, y: screenY }, this.assemblies, touchPickupSource);
      } else if (event.touches.length === 2) {
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        this.lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (event: TouchEvent) => {
      event.preventDefault();

      if (event.touches.length === 1) {
        const touch = event.touches[0];
        const rect = canvas.getBoundingClientRect();
        const screenX = touch.clientX - rect.left;
        const screenY = touch.clientY - rect.top;
        const worldPos = this.screenToWorld(screenX, screenY);

        if (this.blockPickupSystem.isHolding()) {
          this.mousePosition = { x: screenX, y: screenY };
          this.mouseWorldPos = worldPos;
        } else if (!this.playerAssembly && this.touchStartPos) {
          // Observer pan: drag moves the camera
          const prevWorld = this.screenToWorld(this.touchStartPos.x, this.touchStartPos.y);
          this.observerPos.x -= worldPos.x - prevWorld.x;
          this.observerPos.y -= worldPos.y - prevWorld.y;
          this.touchStartPos = { x: screenX, y: screenY };
        } else {
          // Pilot mode: touch moves aim cursor
          this.mousePosition = { x: screenX, y: screenY };
          this.mouseWorldPos = worldPos;
          if (this.playerAssembly && !this.playerAssembly.destroyed) {
            this.playerAssembly.cursorPosition = worldPos;
          }
        }
      } else if (event.touches.length === 2) {
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        const newDist = Math.sqrt(dx * dx + dy * dy);
        if (this.lastTouchDistance > 0) {
          const ratio = newDist / this.lastTouchDistance;
          this.targetBaseZoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetBaseZoomLevel * ratio));
          this.lastManualZoomTime = Date.now();
        }
        this.lastTouchDistance = newDist;
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (event: TouchEvent) => {
      event.preventDefault();
      const wasTouchDragging = this.blockPickupSystem.isDragging();
      this.blockPickupSystem.tryRelease();

      // Short tap (< 10 px movement) AND no drag completed → treat as click / selection
      if (!wasTouchDragging && this.touchStartPos && event.changedTouches.length === 1) {
        const touch = event.changedTouches[0];
        const rect = canvas.getBoundingClientRect();
        const screenX = touch.clientX - rect.left;
        const screenY = touch.clientY - rect.top;
        const dx = screenX - this.touchStartPos.x;
        const dy = screenY - this.touchStartPos.y;
        if (Math.sqrt(dx * dx + dy * dy) < 10) {
          const tapped = this.getAssemblyAtPosition(screenX, screenY);
          if (tapped) this.selectAssembly(tapped);
          else this.selectAssembly(null);
        }
      }
      this.touchStartPos = null;
      this.lastTouchDistance = 0;
    }, { passive: false });
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
    // Accumulate scroll in log-space so each notch is a consistent percentage change
    // regardless of current zoom level. 0.065 per notch ≈ 6.5% — gradual and smooth.
    const LOG_STEP = 0.065;
    const logTarget = Math.log(this.targetBaseZoomLevel) + (event.deltaY > 0 ? -LOG_STEP : LOG_STEP);
    this.targetBaseZoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, Math.exp(logTarget)));

    // Record that the player manually adjusted zoom (suppresses speed-based zoom briefly)
    this.lastManualZoomTime = Date.now();
  }
  /** Camera update dispatcher — pilot mode follows the player ship; observer mode pans freely. */
  private updateCamera(deltaTime: number): void {
    if (this.playerAssembly && !this.playerAssembly.destroyed) {
      this.updatePilotCamera();
    } else {
      this.updateObserverCamera(deltaTime);
    }
  }

  private updatePilotCamera(): void {
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

  private updateObserverCamera(deltaTime: number): void {
    const canvas = this.render.canvas;
    // Pan speed scales with zoom so it feels consistent at all zoom levels
    const panSpeed = this.OBSERVER_PAN_SPEED / this.zoomLevel;

    // WASD / Arrow key panning
    if (this.keys.has('w') || this.keys.has('arrowup'))    this.observerPos.y -= panSpeed * deltaTime;
    if (this.keys.has('s') || this.keys.has('arrowdown'))  this.observerPos.y += panSpeed * deltaTime;
    if (this.keys.has('a') || this.keys.has('arrowleft'))  this.observerPos.x -= panSpeed * deltaTime;
    if (this.keys.has('d') || this.keys.has('arrowright')) this.observerPos.x += panSpeed * deltaTime;

    // Edge-scroll: compare mouse position (CSS px) against CSS canvas dimensions,
    // NOT canvas.width/height which are physical pixels and DPR-scaled.
    const mx   = this.mousePosition.x;
    const my   = this.mousePosition.y;
    const rect = canvas.getBoundingClientRect();
    const w    = rect.width;
    const h    = rect.height;
    const edgeSpeed = panSpeed * 0.8;
    if (mx < this.EDGE_SCROLL_MARGIN)     this.observerPos.x -= edgeSpeed * deltaTime;
    if (mx > w - this.EDGE_SCROLL_MARGIN) this.observerPos.x += edgeSpeed * deltaTime;
    if (my < this.EDGE_SCROLL_MARGIN)     this.observerPos.y -= edgeSpeed * deltaTime;
    if (my > h - this.EDGE_SCROLL_MARGIN) this.observerPos.y += edgeSpeed * deltaTime;

    const viewW = canvas.width / this.zoomLevel;
    const viewH = canvas.height / this.zoomLevel;
    Matter.Render.lookAt(this.render, {
      min: { x: this.observerPos.x - viewW / 2, y: this.observerPos.y - viewH / 2 },
      max: { x: this.observerPos.x + viewW / 2, y: this.observerPos.y + viewH / 2 },
    });
  }

  private setupRenderSystem(): void {
    console.log('🎨 Setting up RenderSystem');

    this.renderSystem = new RenderSystem(
      this.container,
      this.render.canvas,
      () => this.render.bounds,
      this.stats,
    );

    this.renderSystem.register(new StarfieldRenderer());
    this.renderSystem.register(new GridRenderer(() => this.showGrid));
    this.renderSystem.register(new ConnectionRenderer(
      () => this.structureManager?.gridManager.getConnections() ?? [],
    ));
    this.renderSystem.register(new StructureRenderer(
      () => this.structureManager?.getStructures() ?? [],
      () => this.structureManager,
    ));
    this.renderSystem.register(new BlockBodyRenderer(
      () => this.assemblies,
      () => this.world,
    ));
    this.renderSystem.register(new StrategicIconRenderer(
      () => this.assemblies,
      () => this.getAsteroidBodies(),
      () => this.playerAssembly,
    ));
    this.renderSystem.register(new BlockFrillsRenderer(
      () => this.assemblies,
      () => this.blockPickupSystem.getHeldAssembly(),
    ));
    this.renderSystem.register(new ShieldRenderer(() => this.assemblies));
    this.renderSystem.register(new BeamRenderer(this.beamSystem));
    this.particleSystem = new ParticleSystem();
    this.renderSystem.register(new ParticleRenderer(this.particleSystem, () => this.assemblies));
    this.shockwaveRenderer = new ShockwaveRenderer();
    this.renderSystem.register(this.shockwaveRenderer);
    this.renderSystem.register(new ShipHighlightRenderer(
      () => this.playerAssembly,
      () => this.hoveredAssembly,
      () => this.getSelectedAssembly(),
      (assembly) => this.getLockedTargets(assembly),
      (assembly) => this.controllerManager.getAIStateLabelForAssembly(assembly.id),
      () => this.getHoveredStructure(),
      () => this.getSelectedStructure(),
      (structure) => this.structureManager?.gridManager.getGridPowerSummary(
        structure, this.structureManager.getStructures()) ?? null,
    ));
    this.renderSystem.register(new AimingDebugRenderer(() => this.playerAssembly));
    this.renderSystem.register(new BlockPickupRenderer(
      this.blockPickupSystem,
    ));
    this.renderSystem.register(new StructurePlacementRenderer(
      () => this.structurePlacementSystem,
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
    this.shipBuilderAssembly = null;

    // Drop any held block before clearing the scene
    if (this.blockPickupSystem.isHolding()) {
      this.blockPickupSystem.forceDropAtCurrentPosition();
    }

    // Tear down any existing asteroid field before rebuilding the scene
    this.asteroidFieldSystem?.dispose();
    this.asteroidFieldSystem = null;

    // Tear down any existing structure system
    this.structureManager?.dispose();
    this.structureManager = null;
    this.structurePlacementSystem = null;

    this.toastSystem.showGameEvent(`${cfg.label} — Battle Start!`);
    this.observerPos = { x: 0, y: 0 };

    if (cfg.spawnAsteroids) {
      this.asteroidFieldSystem = new AsteroidFieldSystem(
        (body) => Matter.World.add(this.world, body),
        (body) => Matter.World.remove(this.world, body),
      );
    }

    if (cfg.structuresSandboxMode) {
      this.spawnStructuresSandboxScenario();
    } else if (cfg.shipBuilderMode) {
      this.spawnShipBuilderScenario();
    } else if (cfg.sandboxMode) {
      this.spawnSandboxScenario();
    } else {
      this.spawnTeamLine(0, cfg);
      this.spawnTeamLine(1, cfg);

      if (cfg.spawnDebris) {
        this.spawnDebrisField(0, 0, cfg.debrisCount, 2000);
      }
    }

    this.setInitialCameraView();
  }

  // ── Debug spawn API (called from the UI debug panel) ──────────────────────

  /** Spawn `count` random scrap pieces near the current camera centre. */
  public debugSpawnScrap(count: number): void {
    const c = this.getCameraCenter();
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = 100 + Math.random() * 300;
      this.spawnDebris(c.x + Math.cos(angle) * dist, c.y + Math.sin(angle) * dist);
    }
  }

  /** Spawn `count` enemy ships (team 1) near the current camera centre. */
  public debugSpawnEnemy(count: number): void {
    const c     = this.getCameraCenter();
    const ships = shipsData.ships.filter(
      s => !s.parts.some(p => p.type.toLowerCase().includes('missile')),
    );
    for (let i = 0; i < count; i++) {
      const angle    = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const dist     = 300 + Math.random() * 300;
      const x        = c.x + Math.cos(angle) * dist;
      const y        = c.y + Math.sin(angle) * dist;
      const shipDef  = ships[Math.floor(Math.random() * ships.length)];
      const assembly = new Assembly(shipDef.parts as EntityConfig[], { x, y });
      assembly.setShipName(shipDef.name);
      assembly.setTeam(1);
      this.assemblies.push(assembly);
      Matter.World.add(this.world, assembly.rootBody);
      if (assembly.hasControlCenter()) {
        const ai = this.controllerManager.createAIController(assembly);
        ai.setAggressionLevel(0.8 + Math.random() * 0.4);
      }
    }
  }

  /** Returns { index, name } for every ship in ships.json. */
  public getShipList(): { index: number; name: string }[] {
    return shipsData.ships.map((s, i) => ({ index: i, name: s.name }));
  }

  /** Spawn a specific ship design near camera centre on the given team. */
  public debugSpawnShip(shipIndex: number, team: number): void {
    const ships = shipsData.ships;
    if (shipIndex < 0 || shipIndex >= ships.length) return;
    const shipDef = ships[shipIndex];
    const c     = this.getCameraCenter();
    const angle = Math.random() * Math.PI * 2;
    const dist  = 300 + Math.random() * 300;
    const x     = c.x + Math.cos(angle) * dist;
    const y     = c.y + Math.sin(angle) * dist;
    const assembly = new Assembly(shipDef.parts as EntityConfig[], { x, y });
    assembly.setShipName(shipDef.name);
    assembly.setTeam(team);
    this.assemblies.push(assembly);
    Matter.World.add(this.world, assembly.rootBody);
    if (assembly.hasControlCenter()) {
      const ai = this.controllerManager.createAIController(assembly);
      ai.setAggressionLevel(0.8 + Math.random() * 0.4);
    }
  }

  /** Returns the world-space centre of the current camera viewport. */
  private getCameraCenter(): { x: number; y: number } {
    const b = this.render.bounds;
    return { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 };
  }

  private spawnStructuresSandboxScenario(): void {
    // Create the structure manager
    this.structureManager = new StructureManager(
      (body) => Matter.World.add(this.world, body),
      (body) => Matter.World.remove(this.world, body),
    );

    // Create the placement system for player interaction
    this.structurePlacementSystem = new StructurePlacementSystem(
      this.structureManager,
      this.structureManager.gridManager,
      0, // team 0
    );

    // Spawn the Core at the world origin for team 0 with starter resources
    const core = this.structureManager.spawnCore({ x: 0, y: 0 }, 0);
    core.storedResources = 500;

    // Spawn a ring of connectors around the Core and link them
    const connectorCount = 4;
    const connectorDist = 150;
    const connectors: Structure[] = [];
    for (let i = 0; i < connectorCount; i++) {
      const angle = (i / connectorCount) * Math.PI * 2;
      const cx = Math.cos(angle) * connectorDist;
      const cy = Math.sin(angle) * connectorDist;
      const conn = this.structureManager.spawnStructure('Connector', { x: cx, y: cy }, 0);
      conn.markPreBuilt(); // initial base connectors start fully built
      connectors.push(conn);
      // Link each connector to the Core
      this.structureManager.gridManager.connect(core, conn);
    }

    // Link adjacent connectors to each other (ring topology)
    for (let i = 0; i < connectors.length; i++) {
      const next = connectors[(i + 1) % connectors.length];
      this.structureManager.gridManager.connect(connectors[i], next);
    }

    // Spawn a player cockpit nearby so the player can fly around and inspect
    const cockpitConfig: EntityConfig = { type: 'Cockpit', x: 0, y: 0, rotation: 0 };
    const playerShip = new Assembly([cockpitConfig], { x: 400, y: 0 });
    playerShip.setTeam(0);
    playerShip.setShipName('Scout');
    this.assemblies.push(playerShip);
    Matter.World.add(this.world, playerShip.rootBody);

    // Give the scout some basic blocks to attach (engines + gun)
    const starterBlocks: EntityConfig[] = [
      { type: 'Engine', x: 0, y: 0, rotation: 180 },
      { type: 'Engine', x: 0, y: 0, rotation: 180 },
      { type: 'Gun', x: 0, y: 0, rotation: 0 },
      { type: 'PowerCell', x: 0, y: 0, rotation: 0 },
    ];
    for (let i = 0; i < starterBlocks.length; i++) {
      const angle = (i / starterBlocks.length) * Math.PI * 2 + Math.PI * 0.25;
      const dist = 120 + Math.random() * 80;
      const x = 400 + Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;
      const block = new Assembly([starterBlocks[i]], { x, y });
      block.setTeam(-1);
      block.setShipName(`${starterBlocks[i].type} Block`);
      Matter.Body.setAngularVelocity(block.rootBody, (Math.random() - 0.5) * 0.1);
      this.assemblies.push(block);
      Matter.World.add(this.world, block.rootBody);
    }


  }

  private spawnSandboxScenario(): void {
    // All structural hull types (auto-populated from ENTITY_DEFINITIONS) + functional blocks
    const allTypes = Object.keys(ENTITY_DEFINITIONS) as EntityType[];
    const SANDBOX_BLOCK_TYPES: EntityType[] = [
      'Cockpit', 'Cockpit',
      ...allTypes.filter(t => isStructuralBlock(t)),
      'Beam', 'LargeBeam',
      'Gun', 'Gun',
      'Engine', 'Engine', 'Engine',
      'LargeEngine',
      'Shield', 'LargeShield',
      'PowerCell', 'PowerCell',
      'MissileLauncher',
    ];

    // Scatter ALL blocks — no count limit; this lets us test every hull size
    for (let i = 0; i < SANDBOX_BLOCK_TYPES.length; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 150 + Math.random() * 350; // 150–500 units from origin
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;

      const blockType = SANDBOX_BLOCK_TYPES[i];
      // Cockpits must always spawn at rotation 0 so the AI's nose-direction
      // (rootBody.angle) aligns with the laser firing angle
      // (rootBody.angle + entity.rotation). Any random rotation bakes a
      // permanent offset between the two, causing the ship to fly sideways.
      const rotation = blockType === 'Cockpit' ? 0 : Math.floor(Math.random() * 4) * 90;
      const config: EntityConfig = {
        type: blockType,
        x: 0,
        y: 0,
        rotation,
      };
      const blockAssembly = new Assembly([config], { x, y });
      if (blockType === 'Cockpit') {
        // Cockpit blocks are friendly AI-controlled ships the player can pilot
        blockAssembly.setTeam(0);
        blockAssembly.setShipName('Cockpit');
        const ai = this.controllerManager.createAIController(blockAssembly);
        ai.setAggressionLevel(0.5);
      } else {
        blockAssembly.setTeam(-1);
        blockAssembly.setShipName(`${blockType} Block`);
      }
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

    this.toastSystem.showGameEvent('Sandbox — Select a friendly ship and click Pilot!');
  }

  private spawnShipBuilderScenario(): void {
    // Single cockpit at origin — team 0 with a control center so getBlockSnapTarget() finds it
    const cockpit = new Assembly(
      [{ type: 'Cockpit', x: 0, y: 0, rotation: 0 }],
      { x: 0, y: 0 },
    );
    cockpit.setTeam(0);
    cockpit.setShipName('Builder Ship');
    this.shipBuilderAssembly = cockpit;
    this.assemblies.push(cockpit);
    Matter.World.add(this.world, cockpit.rootBody);
    this.toastSystem.showGameEvent('Ship Builder — Click blocks in the palette to place them');
  }

  /**
   * Spawn a single block of the given type near the builder assembly for the user to drag.
   * No-op when not in ship builder mode.
   */
  public spawnBlockForBuilder(type: EntityType): void {
    if (!this.shipBuilderMode) return;
    // Scatter in a small arc to the right of the builder assembly so blocks are easy to grab
    const angle = (Math.random() - 0.5) * Math.PI * 0.75; // ±67° from east
    const distance = 110 + Math.random() * 60;             // 110–170 world units out
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    const assembly = new Assembly([{ type, x: 0, y: 0, rotation: 0 }], { x, y });
    assembly.setTeam(-1);
    assembly.setShipName(`${type} Block`);
    this.assemblies.push(assembly);
    Matter.World.add(this.world, assembly.rootBody);
  }

  /**
   * Serialize the current builder assembly to ships.json-compatible JSON.
   * Returns null when not in ship builder mode or the assembly is destroyed.
   */
  public exportShipAsJson(): string | null {
    if (!this.shipBuilderMode || !this.shipBuilderAssembly || this.shipBuilderAssembly.destroyed) {
      return null;
    }
    const parts = this.shipBuilderAssembly.entities.map(entity => ({
      type: entity.type,
      x: entity.localOffset.x,
      y: entity.localOffset.y,
      rotation: entity.rotation,
      health: entity.health,
      maxHealth: entity.maxHealth,
    }));
    return JSON.stringify({ name: 'My Ship', parts }, null, 2);
  }

  public isShipBuilderMode(): boolean {
    return this.shipBuilderMode;
  }

  public isStructuresSandboxMode(): boolean {
    return this.scenarioConfig.structuresSandboxMode;
  }

  public getStructureManager(): StructureManager | null {
    return this.structureManager;
  }

  public getStructurePlacementSystem(): StructurePlacementSystem | null {
    return this.structurePlacementSystem;
  }

  /** Enter structure place mode — next click places a structure of this type. */
  public enterStructurePlaceMode(type: StructureType): void {
    this.structurePlacementSystem?.enterPlaceMode(type);
  }

  /** Enter structure link mode — first node selected, waiting for second click. */
  public enterStructureLinkMode(source: Structure): void {
    this.structurePlacementSystem?.enterLinkMode(source);
  }

  /** Cancel the current structure placement mode. */
  public cancelStructurePlacement(): void {
    this.structurePlacementSystem?.cancel();
  }

  private spawnTeamLine(team: number, cfg: ScenarioConfig): void {
    const ships = shipsData.ships;
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

      const selectedShip = ships[Math.floor(Math.random() * ships.length)];
      const assembly = new Assembly(selectedShip.parts as EntityConfig[], { x, y });
      assembly.setShipName(selectedShip.name);
      assembly.setTeam(team);

      // Rotate team 1 (right side) ships to face left so both teams start facing each other
      if (!isBlue) {
        Matter.Body.rotate(assembly.rootBody, Math.PI);
      }

      this.assemblies.push(assembly);
      Matter.World.add(this.world, assembly.rootBody);

      if (assembly.hasControlCenter()) {
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
    // Convert screen coordinates to world coordinates (proper scaled transform)
    const bounds = this.render.bounds;
    const worldX = (x / this.render.canvas.width) * (bounds.max.x - bounds.min.x) + bounds.min.x;
    const worldY = (y / this.render.canvas.height) * (bounds.max.y - bounds.min.y) + bounds.min.y;

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

  /** Find a structure at a screen position. */
  private getStructureAtPosition(screenX: number, screenY: number): Structure | null {
    if (!this.structureManager) return null;
    const bounds = this.render.bounds;
    const worldX = (screenX / this.render.canvas.width) * (bounds.max.x - bounds.min.x) + bounds.min.x;
    const worldY = (screenY / this.render.canvas.height) * (bounds.max.y - bounds.min.y) + bounds.min.y;

    let closest: Structure | null = null;
    let closestDist = Infinity;
    for (const s of this.structureManager.getStructures()) {
      if (s.isDestroyed()) continue;
      const dx = s.body.position.x - worldX;
      const dy = s.body.position.y - worldY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitRadius = Math.max(s.definition.widthPx, s.definition.heightPx) / 2 + 10;
      if (dist < hitRadius && dist < closestDist) {
        closest = s;
        closestDist = dist;
      }
    }
    return closest;
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

  public getSelectedStructure(): Structure | null {
    if (this.selectedStructure?.isDestroyed()) {
      this.selectedStructure = null;
    }
    return this.selectedStructure;
  }

  public getHoveredStructure(): Structure | null {
    if (this.hoveredStructure?.isDestroyed()) {
      this.hoveredStructure = null;
    }
    return this.hoveredStructure;
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

  public getPerformanceMetrics(): PerformanceMetrics {
    const avgMem = this.perfMemorySamples.length > 0
      ? Math.round(this.perfMemorySamples.reduce((a, b) => a + b, 0) / this.perfMemorySamples.length)
      : null;
    return {
      fps: this.perfDisplayFps,
      tickMs: Math.round(this.perfLastTickMs * 10) / 10,
      memoryMb: avgMem,
      physicsBodyCount: this.world.bodies.length,
      assemblyCount: this.assemblies.length,
      entityCount: this.assemblies.reduce((sum, a) => sum + a.entities.length, 0),
      laserCount: this.lasers.length,
      missileCount: this.missileSystem.getMissiles().filter(m => !m.destroyed).length,
      collisionsPerSecond: this.perfCollisionsPerSecond,
    };
  }

  /** Show or hide the stats.js FPS widget. Hide it when PerformanceBar is active. */
  public setStatsPanelVisible(visible: boolean): void {
    this.stats.dom.style.display = visible ? '' : 'none';
  }

  /** All asteroid Matter.Body objects currently streamed into the world. */
  public getAsteroidBodies(): Matter.Body[] {
    return this.asteroidFieldSystem?.getAllBodies() ?? [];
  }

  /** Asteroid world positions within `range` units of `center` — lightweight for UI polling. */
  public getAsteroidPositions(center: { x: number; y: number }, range: number): { x: number; y: number }[] {
    const bodies = this.asteroidFieldSystem?.getAllBodies() ?? [];
    const r2 = range * range;
    return bodies
      .filter(b => {
        const dx = b.position.x - center.x;
        const dy = b.position.y - center.y;
        return dx * dx + dy * dy <= r2;
      })
      .map(b => ({ x: b.position.x, y: b.position.y }));
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
    this.targetBaseZoomLevel = Math.min(this.targetBaseZoomLevel * 1.5, this.maxZoom);
    this.lastManualZoomTime = Date.now();
  }

  public zoomOut(): void {
    this.targetBaseZoomLevel = Math.max(this.targetBaseZoomLevel * 0.67, this.minZoom);
    this.lastManualZoomTime = Date.now();
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
    // Step 1: ease baseZoomLevel toward the scroll/pilot target (smooth scroll feel).
    // Use a moderate lerp factor so rapid scroll-wheel flicks accumulate gracefully.
    const BASE_EASE = 0.10;
    this.baseZoomLevel += (this.targetBaseZoomLevel - this.baseZoomLevel) * BASE_EASE;

    if (!this.speedBasedZoomEnabled || !this.playerAssembly) {
      // Observer mode: just ease zoomLevel toward baseZoomLevel
      const observerEase = 0.08;
      this.zoomLevel += (this.baseZoomLevel - this.zoomLevel) * observerEase;
      return;
    }

    const currentTime = Date.now();
    const timeSinceManualZoom = currentTime - this.lastManualZoomTime;

    // If player recently manually adjusted zoom, reduce or disable speed-based zoom temporarily
    let speedZoomInfluence = 1.0;
    if (timeSinceManualZoom < this.manualZoomCooldown) {
      speedZoomInfluence = timeSinceManualZoom / this.manualZoomCooldown;
    }

    const speed = this.getCurrentSpeed();

    // Scale the speed threshold by ship size so larger ships need higher speed to trigger zoom-out.
    // Reference radius ~80px (small fighter). Larger ships feel slower so their threshold rises.
    const assemblyRadius = this.getAssemblyBoundingRadius(this.playerAssembly);
    const SIZE_REFERENCE = 80;
    const sizeAdjustedThreshold = 20 * Math.sqrt(assemblyRadius / SIZE_REFERENCE);

    // Max 40% zoom-out at full speed (slightly reduced from 50% for a subtler feel)
    const maxSpeedZoomPercent = 0.40 * speedZoomInfluence;
    const speedPercent = Math.min(speed / sizeAdjustedThreshold, 1.0);
    const zoomOutPercent = speedPercent * maxSpeedZoomPercent;

    // Target zoom combines player's chosen base with speed adjustment
    const targetZoom = Math.max(this.minZoom, this.baseZoomLevel * (1 - zoomOutPercent));

    // Smooth ease-out for zoom-in (slower = more satisfying), faster ease-in for zoom-out
    const zoomingOut = targetZoom < this.zoomLevel;
    const smoothingFactor = zoomingOut ? 0.04 : 0.06;
    this.zoomLevel += (targetZoom - this.zoomLevel) * smoothingFactor;
  }

  /** Returns the bounding radius of an assembly (furthest entity edge from origin). */
  private getAssemblyBoundingRadius(assembly: Assembly): number {
    let maxR = 0;
    assembly.entities.forEach(entity => {
      const def = ENTITY_DEFINITIONS[entity.type];
      const r = Math.sqrt(entity.localOffset.x ** 2 + entity.localOffset.y ** 2)
               + Math.max(def.width, def.height) / 2;
      if (r > maxR) maxR = r;
    });
    return Math.max(maxR, 50);
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
    this.shipBuilderMode = config.shipBuilderMode;
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
    // If mouseup just completed a drag-and-drop, skip selection for this click event
    if (this.dragJustCompleted) {
      this.dragJustCompleted = false;
      return;
    }
    const rect = this.render.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    // Convert screen coordinates to world coordinates
    const worldX = screenX + this.render.bounds.min.x;
    const worldY = screenY + this.render.bounds.min.y;

    // Structure placement system intercepts clicks when active
    if (this.structurePlacementSystem?.isActive()) {
      const worldPos = this.screenToWorld(screenX, screenY);
      if (this.structurePlacementSystem.handleClick(worldPos)) return;
    }

    // Find assembly at click position
    const clickedAssembly = this.getAssemblyAtPosition(screenX, screenY);

    if (clickedAssembly) {
      this.selectedStructure = null; // Clear structure selection when clicking an assembly
      if (clickedAssembly === this.playerAssembly) {
        // Clicking the currently piloted ship deselects
        this.selectAssembly(null);
      } else if (this.playerAssembly && (event.button === 2 || event.ctrlKey)) {
        // Right-click / Ctrl+click targets (only when piloting a ship)
        this.handleTargetClick(clickedAssembly);
      } else {
        // Left-click selects any ship
        this.selectAssembly(clickedAssembly);
      }
    } else {
      // Check for structure click
      const clickedStructure = this.getStructureAtPosition(screenX, screenY);
      if (clickedStructure) {
        this.selectAssembly(null);
        this.selectedStructure = clickedStructure;
      } else {
        // Clicked empty space
        this.selectedStructure = null;
        if (this.playerAssembly) {
          this.mousePosition = { x: screenX, y: screenY };
          this.playerAssembly.cursorPosition = { x: worldX, y: worldY };
        }
        this.selectAssembly(null);
      }
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

  /**
   * Returns the assembly that block-drag snap/attach should target.
   * When piloting: the player's own ship.
   * When observing: the nearest team-0 (friendly) cockpit-having assembly to the held block.
   */
  private getBlockSnapTarget(): Assembly | null {
    if (this.playerAssembly && !this.playerAssembly.destroyed) return this.playerAssembly;

    const held = this.blockPickupSystem.getHeldAssembly();
    if (!held) return null;

    const heldPos = held.rootBody.position;
    let best: Assembly | null = null;
    let bestDist = Infinity;
    for (const a of this.assemblies) {
      if (a.destroyed || a.team !== 0 || !a.hasControlCenter() || a === held) continue;
      const dx = a.rootBody.position.x - heldPos.x;
      const dy = a.rootBody.position.y - heldPos.y;
      const dist = dx * dx + dy * dy; // squared distance — only comparing, no need for sqrt
      if (dist < bestDist) { bestDist = dist; best = a; }
    }
    return best;
  }

  // ── Observer / Pilot public API ────────────────────────────────────────────

  public isObserverMode(): boolean {
    return !this.playerAssembly;
  }

  /** Take control of a friendly assembly. */
  public pilotAssembly(assembly: Assembly): void {
    if (!assembly.hasControlCenter() || assembly.destroyed || assembly.isPlayerControlled) return;

    this.controllerManager.removeController(assembly.id);
    this.playerAssembly = assembly;
    assembly.isPlayerControlled = true;
    this.flightController = new FlightController(assembly);
    this.controllerManager.createPlayerController(assembly);
    PowerSystem.getInstance().setPlayerAssembly(assembly);
    this.toastSystem.showSuccess(`Piloting ${assembly.shipName}`);

    // Smoothly zoom to a ship-appropriate level (eases in over ~1 second)
    this.calculateZoomForAssembly(assembly);
  }

  /** Return the current ship to AI and go back to observer mode. */
  public exitPilot(): void {
    if (!this.playerAssembly) return;

    this.observerPos = { ...this.playerAssembly.rootBody.position };
    this.playerAssembly.isPlayerControlled = false;
    this.controllerManager.removeController(this.playerAssembly.id);
    const ai = this.controllerManager.createAIController(this.playerAssembly);
    ai.setAggressionLevel(0.8);
    this.playerAssembly = null;
    this.flightController = null;
    PowerSystem.getInstance().setPlayerAssembly(null);
    this.toastSystem.showGameEvent('Returned to observer mode');
  }

  /** Returns true when the assembly has an active controller (AI or player). */
  public isAIEnabled(assembly: Assembly): boolean {
    return this.controllerManager.hasController(assembly.id) && !assembly.isPlayerControlled;
  }

  /** Remove the AI controller from an assembly, leaving it drifting. */
  public disableAI(assembly: Assembly): void {
    this.controllerManager.removeController(assembly.id);
    this.toastSystem.showGameEvent(`AI disabled on ${assembly.shipName}`);
  }

  /** Restore an AI controller on an assembly. */
  public enableAI(assembly: Assembly): void {
    if (assembly.destroyed || assembly.isPlayerControlled) return;
    const ai = this.controllerManager.createAIController(assembly);
    ai.setAggressionLevel(0.8);
    this.toastSystem.showGameEvent(`AI enabled on ${assembly.shipName}`);
  }
}
