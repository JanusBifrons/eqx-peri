import * as Matter from 'matter-js';
import Stats from 'stats.js';
import { Assembly } from './Assembly';
import { Entity } from './Entity';
import { EntityConfig, GRID_SIZE, ENTITY_DEFINITIONS, EntityType } from '../types/GameTypes';
import { getBlockDefinition, BLOCK_SIZE } from './BlockSystem';
import shipsData from '../data/ships.json';
import { ControllerManager } from './ControllerManager';
import { FlightController } from './FlightController';
import { ControlInput } from './Controller';
import { PowerSystem } from './PowerSystem';
import { ToastSystem } from './ToastSystem';
import { MissileSystem } from './MissileSystem';

export class GameEngine {
  private engine: Matter.Engine;
  private render: Matter.Render; private world: Matter.World;
  private assemblies: Assembly[] = [];
  private bullets: Matter.Body[] = [];
  private missileSystem: MissileSystem;
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

  // Stats.js for FPS monitoring
  private stats: Stats;
  // Ship selection and player destruction callback
  public onPlayerDestroyed?: () => void;
  private selectedPlayerShipIndex: number = 0;

  // Toast system for game events
  private toastSystem: ToastSystem;

  constructor(container: HTMLElement) {
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
      body.frictionAir = 0.01; // Very small air resistance to dampen spinning debris
      body.friction = 0; // No surface friction in space
    });    // Add event listener to ensure all new bodies have realistic physics settings
    Matter.Events.on(this.engine, 'beforeUpdate', () => {
      this.engine.world.bodies.forEach(body => {
        // Apply minimal air resistance to prevent infinite spinning
        if (body.frictionAir < 0.01) body.frictionAir = 0.01;
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

    // Initialize mouse interaction
    this.setupMouseInteraction();
    this.setupEventListeners();
    this.setupCollisionDetection();
    this.setupRenderEvents();
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

  private setupEventListeners(): void {
    // Keyboard input
    document.addEventListener('keydown', (event) => {
      this.keys.add(event.key.toLowerCase());      // Handle special keys
      switch (event.key.toLowerCase()) {
        case '1':
          this.spawnShip(Math.random() * 400 - 200, Math.random() * 400 - 200, false);
          break; case '3':
          this.spawnDebris(Math.random() * 400 - 200, Math.random() * 400 - 200);
          break;
        case '4':
          this.spawnMissileCorvette(Math.random() * 400 - 200, Math.random() * 400 - 200, false);
          break;
        case 'r':
          this.initializeBattle(); // Restart battle
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
        const { bodyA, bodyB } = pair;        // Check for bullet/laser collisions
        if (bodyA.isBullet && bodyB.entity) {
          this.handleBulletHit(bodyA, bodyB.entity);
        } else if (bodyB.isBullet && bodyA.entity) {
          this.handleBulletHit(bodyB, bodyA.entity);
        }
        // Check for missile collisions
        else if ((bodyA as any).isMissile && bodyB.entity) {
          this.handleMissileHit((bodyA as any).missile, bodyB.entity);
        } else if ((bodyB as any).isMissile && bodyA.entity) {
          this.handleMissileHit((bodyB as any).missile, bodyA.entity);
        }
        // Check for entity-to-entity collisions (for flash effect)
        else if (bodyA.entity && bodyB.entity) {
          this.handleEntityCollision(bodyA.entity, bodyB.entity);
        }
      });
    });

    // Also listen for collision active (ongoing collisions) for more responsive flashing
    Matter.Events.on(this.engine, 'collisionActive', (event: { pairs: { bodyA: Matter.Body; bodyB: Matter.Body }[] }) => {
      event.pairs.forEach(pair => {
        const { bodyA, bodyB } = pair;

        // Only flash on entity-to-entity collisions, not bullets (since bullets are handled separately)
        if (bodyA.entity && bodyB.entity && !bodyA.isBullet && !bodyB.isBullet) {
          // Only trigger flash if entities aren't already flashing to avoid spam
          if (!bodyA.entity.isFlashing && !bodyA.entity.destroyed) {
            bodyA.entity.triggerCollisionFlash();
          }
          if (!bodyB.entity.isFlashing && !bodyB.entity.destroyed) {
            bodyB.entity.triggerCollisionFlash();
          }
        }
      });
    });
  } private handleEntityCollision(entityA: Entity, entityB: Entity): void {
    // Flash on impact for any entity collision
    if (!entityA.destroyed && !entityA.isFlashing) {
      entityA.triggerCollisionFlash();
    }
    if (!entityB.destroyed && !entityB.isFlashing) {
      entityB.triggerCollisionFlash();
    }    // Calculate realistic collision impact based on mass and velocity differences
    const massA = entityA.body.mass;
    const massB = entityB.body.mass;
    const velocityA = Matter.Vector.magnitude(entityA.body.velocity);
    const velocityB = Matter.Vector.magnitude(entityB.body.velocity);

    // Calculate relative impact force
    const relativeVelocity = Math.abs(velocityA - velocityB);
    const totalMass = massA + massB;
    const massRatio = Math.min(massA, massB) / Math.max(massA, massB);

    // Only cause collision damage if there's significant impact
    // Light debris hitting heavy ships should cause minimal damage
    if (relativeVelocity > 3 && massRatio > 0.1) { // Minimum speed and mass ratio for damage
      const impactForce = (relativeVelocity * Math.min(massA, massB)) / 1000; if (impactForce > 1) {
        const damage = Math.floor(impactForce);

        // Apply damage proportional to mass ratio - lighter objects take more damage
        const damageA = Math.floor(damage * (massB / totalMass));
        const damageB = Math.floor(damage * (massA / totalMass));

        if (damageA > 0) entityA.takeDamage(damageA);
        if (damageB > 0) entityB.takeDamage(damageB);
      }
    }
  } private handleBulletHit(bullet: Matter.Body, entity: Entity): void {
    // Check for self-hit prevention
    const sourceAssemblyId = (bullet as any).sourceAssemblyId;
    if (sourceAssemblyId) {
      // Find the assembly containing the hit entity
      const hitAssembly = this.assemblies.find(a => a.entities.includes(entity));
      if (hitAssembly && hitAssembly.id === sourceAssemblyId) {        // This is a self-hit, ignore it
        return;
      }

      // Track who hit this assembly for kill attribution
      if (hitAssembly) {
        const sourceAssembly = this.assemblies.find(a => a.id === sourceAssemblyId);
        hitAssembly.lastHitByAssemblyId = sourceAssemblyId;
        hitAssembly.lastHitByPlayer = sourceAssembly?.isPlayerControlled || false;
      }
    }

    // Remove bullet
    Matter.World.remove(this.world, bullet);
    this.bullets = this.bullets.filter(b => b !== bullet);

    // Trigger flash effect on hit (whether destroyed or not)
    if (!entity.destroyed) {
      entity.triggerCollisionFlash();
    }

    // Apply damage - more damage to make breaking easier
    const destroyed = entity.takeDamage(10); if (destroyed) {
      // Find the assembly containing this entity
      const assembly = this.assemblies.find(a => a.entities.includes(entity));
      if (assembly) {
        console.log(`💥 Part destroyed in assembly with ${assembly.entities.length} parts`);

        // Get new assemblies from the split BEFORE removing from physics world
        const newAssemblies = assembly.removeEntity(entity);
        console.log(`🔄 Split into ${newAssemblies.length} new assemblies`);

        // Remove the old assembly from physics world (it's marked as destroyed now)
        Matter.World.remove(this.world, assembly.rootBody);

        // Replace the old assembly with new ones in our list
        const assemblyIndex = this.assemblies.findIndex(a => a === assembly);
        if (assemblyIndex !== -1) {
          this.assemblies.splice(assemblyIndex, 1, ...newAssemblies);          // Add all new assemblies to physics world
          newAssemblies.forEach((newAssembly, index) => {
            console.log(`  Assembly ${index}: ${newAssembly.entities.length} parts`);
            Matter.World.add(this.world, newAssembly.rootBody);

            // Convert single-part assemblies without cockpits to debris
            if (newAssembly.entities.length === 1 && !newAssembly.hasControlCenter()) {
              newAssembly.setTeam(-1); // Mark as neutral debris
              newAssembly.setShipName(`${newAssembly.entities[0].type} Debris`);
              console.log(`🗑️ Converted single part to debris: ${newAssembly.shipName}`);
            }

            // If this was the player assembly, reassign player control
            if (assembly.isPlayerControlled && newAssembly.isPlayerControlled) {
              this.playerAssembly = newAssembly;
              this.toastSystem.showWarning(`⚠️ Ship damaged! Control transferred to ${newAssembly.shipName}`);
              console.log('👤 Player control transferred to new assembly');
            }
          });// If original was player assembly but no new assembly has control, find one
          if (assembly.isPlayerControlled && !this.playerAssembly) {
            const newPlayerAssembly = newAssemblies.find(a => a.hasControlCenter());
            if (newPlayerAssembly) {
              this.playerAssembly = newPlayerAssembly;
              newPlayerAssembly.isPlayerControlled = true;
              this.toastSystem.showSuccess(`✅ Control established with ${newPlayerAssembly.shipName}`);
              console.log('👤 Player control assigned to assembly with cockpit');
            }
          }
        }
      }
    }
  } private handleMissileHit(missile: any, entity: Entity): void {
    // Use the missile system to handle the hit
    this.missileSystem.handleMissileHit(missile, entity);
  }

  public start(): void {
    console.log('🚀 Starting GameEngine...');
    if (this.running) return;

    this.running = true;    // Start renderer
    console.log('🖼️  About to start renderer...');
    console.log('Render object:', this.render);
    console.log('Render canvas:', this.render.canvas);
    Matter.Render.run(this.render);
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
    Matter.Render.stop(this.render);
    Matter.Runner.stop(this.runner);
    Matter.Engine.clear(this.engine);

    // Cleanup missile system
    this.missileSystem.cleanup();
  } private gameLoop(): void {
    if (!this.running) return;

    // Calculate delta time
    const currentTime = performance.now();
    const deltaTime = (currentTime - (this.lastFrameTime || currentTime)) / 1000; // Convert ms to seconds
    this.lastFrameTime = currentTime;

    // Update cursor position for weapon aiming (every frame)
    this.updateCursorWorldPosition();

    // Update controllers (handles both player input and AI)
    const newBullets = this.controllerManager.update(deltaTime, this.assemblies);    // Add new bullets to physics world
    newBullets.forEach(bullet => {
      Matter.World.add(this.world, bullet);
      this.bullets.push(bullet);
    });

    // Handle missile launches from all assemblies
    this.assemblies.forEach(assembly => {
      const missileRequests = assembly.getMissileLaunchRequests();
      missileRequests.forEach(request => {
        this.missileSystem.createMissile(
          request.position,
          request.angle,
          request.missileType,
          request.sourceAssemblyId,
          request.targetAssembly
        );
      });
    });

    // Handle additional player input (mouse controls, etc.)
    this.handlePlayerInput();    // Update assemblies
    this.assemblies.forEach(assembly => {
      assembly.update();
      assembly.updateWeaponAiming(); // Update weapon aiming targets continuously
    });

    // Update entity flash effects
    this.updateEntityFlashes(deltaTime);    // Update bullets
    this.updateBullets();

    // Update missile system
    this.missileSystem.update(deltaTime, this.assemblies);

    // Clean up destroyed assemblies
    this.cleanupDestroyedAssemblies();    // Check if player is destroyed and call callback
    if (!this.playerAssembly || this.playerAssembly.destroyed || !this.playerAssembly.hasControlCenter()) {
      const wasPlayerDestroyed = this.playerAssembly?.destroyed || (this.playerAssembly && !this.playerAssembly.hasControlCenter());

      if (wasPlayerDestroyed && this.onPlayerDestroyed) {
        console.log('💀 Player destroyed - calling destruction callback');
        this.playerAssembly = null;
        this.onPlayerDestroyed();
      } else {
        this.findPlayerAssembly();
      }
    }

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
    this.controllerManager.setPlayerInput(input);

    // Apply rotational dampening directly (this is physics, not control)
    if (input.torque === 0) {
      const currentAngularVel = this.playerAssembly.rootBody.angularVelocity;
      const dampening = 0.95;
      Matter.Body.setAngularVelocity(this.playerAssembly.rootBody, currentAngularVel * dampening);
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
  } private cleanupDestroyedAssemblies(): void {
    const destroyedAssemblies = this.assemblies.filter(a => a.destroyed || a.entities.length === 0);

    destroyedAssemblies.forEach(assembly => {
      // Show toast notification for destroyed ships
      if (assembly.lastHitByPlayer) {
        // Player got the kill
        this.toastSystem.showKill("You", assembly.shipName);
      } else if (assembly.lastHitByAssemblyId) {
        // Find the assembly that got the kill
        const killerAssembly = this.assemblies.find(a => a.id === assembly.lastHitByAssemblyId);
        const killerName = killerAssembly ? killerAssembly.shipName : "Unknown";
        this.toastSystem.showKill(killerName, assembly.shipName);
      } else {
        // Unknown cause of death
        this.toastSystem.showKill("Unknown", assembly.shipName);
      }

      Matter.World.remove(this.world, assembly.rootBody);

      // Clear selection if the selected assembly is being destroyed
      if (this.selectedAssembly === assembly) {
        this.selectedAssembly = null;
        console.log('🎯 Cleared selection of destroyed assembly');
      }

      // Clear hover if the hovered assembly is being destroyed
      if (this.hoveredAssembly === assembly) {
        this.hoveredAssembly = null;
      }
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
  } private renderGrid(): void {
    const ctx = this.render.canvas.getContext('2d');
    if (!ctx) return;

    const bounds = this.render.bounds;

    // Calculate zoom level based on viewport size
    const viewportWidth = bounds.max.x - bounds.min.x;
    const viewportHeight = bounds.max.y - bounds.min.y;
    const rawZoomLevel = Math.min(viewportWidth, viewportHeight) / 1000;
    // Clamp zoom to discrete levels to prevent constant grid movement
    const zoomThresholds = [0.1, 0.25, 0.5, 1, 2, 4, 8, 16];
    let clampedZoomLevel = zoomThresholds[0];
    for (const threshold of zoomThresholds) {
      if (rawZoomLevel >= threshold) {
        clampedZoomLevel = threshold;
      } else {
        break;
      }
    }

    // Use much larger grid spacing that scales with clamped zoom levels
    const baseMinorGridSize = GRID_SIZE * 5 * clampedZoomLevel;
    const baseMajorGridSize = GRID_SIZE * 15 * clampedZoomLevel;

    const majorGridSize = baseMajorGridSize;
    const minorGridSize = baseMinorGridSize;

    const startXMajor = Math.floor(bounds.min.x / majorGridSize) * majorGridSize;
    const endXMajor = Math.ceil(bounds.max.x / majorGridSize) * majorGridSize;
    const startYMajor = Math.floor(bounds.min.y / majorGridSize) * majorGridSize;
    const endYMajor = Math.ceil(bounds.max.y / majorGridSize) * majorGridSize;

    const startXMinor = Math.floor(bounds.min.x / minorGridSize) * minorGridSize;
    const endXMinor = Math.ceil(bounds.max.x / minorGridSize) * minorGridSize;
    const startYMinor = Math.floor(bounds.min.y / minorGridSize) * minorGridSize;
    const endYMinor = Math.ceil(bounds.max.y / minorGridSize) * minorGridSize;
    // Save the current canvas state
    ctx.save();
    // Use destination-over to draw grid behind existing content
    ctx.globalCompositeOperation = 'destination-over';
    // Adjust opacity based on zoom level - fade out when too zoomed out
    const baseOpacity = Math.min(1, Math.max(0.1, 2 / clampedZoomLevel));
    // Draw minor grid lines (lighter, behind major lines)
    ctx.strokeStyle = '#444477';
    ctx.lineWidth = 1;
    ctx.globalAlpha = baseOpacity * 0.4; // Slightly more visible minor lines

    // Minor vertical lines
    for (let x = startXMinor; x <= endXMinor; x += minorGridSize) {
      if (x % majorGridSize !== 0) { // Skip major grid positions
        const screenX = (x - bounds.min.x) * this.render.canvas.width / (bounds.max.x - bounds.min.x);
        ctx.beginPath();
        ctx.moveTo(screenX, 0);
        ctx.lineTo(screenX, this.render.canvas.height);
        ctx.stroke();
      }
    }

    // Minor horizontal lines
    for (let y = startYMinor; y <= endYMinor; y += minorGridSize) {
      if (y % majorGridSize !== 0) { // Skip major grid positions
        const screenY = (y - bounds.min.y) * this.render.canvas.height / (bounds.max.y - bounds.min.y);
        ctx.beginPath();
        ctx.moveTo(0, screenY);
        ctx.lineTo(this.render.canvas.width, screenY);
        ctx.stroke();
      }
    }    // Draw major grid lines (more visible)
    ctx.strokeStyle = '#7788aa';
    ctx.lineWidth = 2;
    ctx.globalAlpha = baseOpacity * 0.8; // More visible major lines

    // Major vertical lines
    for (let x = startXMajor; x <= endXMajor; x += majorGridSize) {
      const screenX = (x - bounds.min.x) * this.render.canvas.width / (bounds.max.x - bounds.min.x);
      ctx.beginPath();
      ctx.moveTo(screenX, 0);
      ctx.lineTo(screenX, this.render.canvas.height);
      ctx.stroke();
    }

    // Major horizontal lines
    for (let y = startYMajor; y <= endYMajor; y += majorGridSize) {
      const screenY = (y - bounds.min.y) * this.render.canvas.height / (bounds.max.y - bounds.min.y);
      ctx.beginPath();
      ctx.moveTo(0, screenY);
      ctx.lineTo(this.render.canvas.width, screenY);
      ctx.stroke();
    }
    // Restore the canvas state
    ctx.restore();
  } private toggleGrid(): void {
    this.showGrid = !this.showGrid;
  }

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
  } private spawnMissileCorvette(x: number, y: number, isPlayer: boolean): void {
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
      };      // Update cursor position for weapon aiming if we have a player
      if (this.playerAssembly && !this.playerAssembly.destroyed) {
        this.updateCursorWorldPosition();
      }

      // Update hovered assembly
      const hoveredAssembly = this.getAssemblyAtPosition(this.mousePosition.x, this.mousePosition.y);
      this.setHoveredAssembly(hoveredAssembly);
    });// Left mouse button - primary fire and interactions (selection handled by Matter.js events)
    this.render.canvas.addEventListener('mousedown', (event) => {
      console.log('🖱️ DOM Mouse down detected, button:', event.button);
      if (event.button === 0) { // Left mouse button
        this.mouseDown = true;
        // Selection is now handled by Matter.js events above
        // this.handleLeftClick(event);
      } else if (event.button === 2) { // Right mouse button
        this.handleRightClick(event);
      }
    }); this.render.canvas.addEventListener('mouseup', (event) => {
      if (event.button === 0) {
        this.mouseDown = false;
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
  } private setupRenderEvents(): void {
    console.log('🎯 Setting up render events for grid and connection points');

    // Start stats monitoring before each render
    Matter.Events.on(this.render, 'beforeRender', () => {
      this.stats.begin();
    });    // Use afterRender for grid and connection points
    Matter.Events.on(this.render, 'afterRender', () => {
      if (this.showGrid) {
        this.renderGrid();
      } this.renderConnectionPoints();
      this.renderShipHighlights();
      this.renderAimingDebug(); // Add debug visuals for aiming system
      this.executePlayerCommands(); // Execute player commands each frame

      // End stats monitoring after each render
      this.stats.end();
    });
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

  private renderConnectionPoints(): void {
    const ctx = this.render.canvas.getContext('2d');
    if (!ctx) return;

    // Save canvas state
    ctx.save();

    // Get render bounds for culling
    const bounds = this.render.bounds;

    // Render connection points for all entities in all assemblies
    this.assemblies.forEach(assembly => {
      assembly.entities.forEach(entity => {
        if (entity.destroyed) return;

        const worldPos = entity.body.position;

        // Basic culling - skip if entity is way outside view
        if (worldPos.x < bounds.min.x - 100 || worldPos.x > bounds.max.x + 100 ||
          worldPos.y < bounds.min.y - 100 || worldPos.y > bounds.max.y + 100) {
          return;
        }

        this.renderEntityConnectionPoints(ctx, entity, bounds);
      });
    });

    // Restore canvas state
    ctx.restore();
  } private renderEntityConnectionPoints(ctx: CanvasRenderingContext2D, entity: Entity, bounds: Matter.Bounds): void {
    const definition = getBlockDefinition(entity.type);
    if (!definition) return;

    const worldPos = entity.body.position;
    const blockSizeWorld = BLOCK_SIZE * definition.size.width; // World size of the block

    // Calculate screen scaling factor
    const screenScale = this.render.canvas.width / (bounds.max.x - bounds.min.x);

    // Draw connection points
    definition.connectionPoints.forEach((cp: any) => {
      // Calculate connection point position relative to entity center
      const cpWorldX = worldPos.x + (cp.position.x * BLOCK_SIZE);
      const cpWorldY = worldPos.y + (cp.position.y * BLOCK_SIZE);

      // Convert to screen coordinates
      const cpScreenX = (cpWorldX - bounds.min.x) * this.render.canvas.width / (bounds.max.x - bounds.min.x);
      const cpScreenY = (cpWorldY - bounds.min.y) * this.render.canvas.height / (bounds.max.y - bounds.min.y);

      // Calculate extension distance beyond block edge
      const baseExtension = BLOCK_SIZE * 0.3; // How far beyond block edge
      const extensionWorld = baseExtension;

      // Calculate extended position based on direction
      let extendedWorldX = cpWorldX;
      let extendedWorldY = cpWorldY;

      switch (cp.direction) {
        case 'north': extendedWorldY -= extensionWorld; break;
        case 'south': extendedWorldY += extensionWorld; break;
        case 'east': extendedWorldX += extensionWorld; break;
        case 'west': extendedWorldX -= extensionWorld; break;
      }

      // Convert extended position to screen coordinates
      const extScreenX = (extendedWorldX - bounds.min.x) * this.render.canvas.width / (bounds.max.x - bounds.min.x);
      const extScreenY = (extendedWorldY - bounds.min.y) * this.render.canvas.height / (bounds.max.y - bounds.min.y);

      // Scale connection point size with zoom level
      const baseRadius = Math.max(4, blockSizeWorld * 0.12 * screenScale);
      const radius = Math.min(baseRadius, 15); // Cap maximum size

      // Set color based on connection direction with brighter colors
      let color = '#ffffff';
      let glowColor = '#ffffff';
      switch (cp.direction) {
        case 'north':
          color = '#00ff66';
          glowColor = '#88ffaa';
          break;
        case 'east':
          color = '#ff3366';
          glowColor = '#ff88aa';
          break;
        case 'south':
          color = '#3366ff';
          glowColor = '#88aaff';
          break;
        case 'west':
          color = '#ffff33';
          glowColor = '#ffff88';
          break;
      }      // Draw connection line from block edge to extended point (almost invisible)
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, radius * 0.1);
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.05; // Almost invisible
      ctx.beginPath();
      ctx.moveTo(cpScreenX, cpScreenY);
      ctx.lineTo(extScreenX, extScreenY);
      ctx.stroke();

      // Draw glow effect around connection point (barely visible)
      ctx.globalAlpha = 0.03;
      ctx.fillStyle = glowColor;
      ctx.beginPath();
      ctx.arc(extScreenX, extScreenY, radius * 1.2, 0, 2 * Math.PI);
      ctx.fill();

      // Draw outer circle (connection point) at extended position (very subtle)
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(0.5, radius * 0.05);
      ctx.beginPath();
      ctx.arc(extScreenX, extScreenY, radius * 0.4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();

      // Draw inner dot for better visibility (much smaller and more transparent)
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(extScreenX, extScreenY, radius * 0.1, 0, 2 * Math.PI);
      ctx.fill();

      // Reset alpha
      ctx.globalAlpha = 1.0;
    });
  } private renderShipHighlights(): void {
    const ctx = this.render.canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    const bounds = this.render.bounds;

    // Render hover bounding box
    if (this.hoveredAssembly && !this.hoveredAssembly.destroyed) {
      this.renderAssemblyBoundingBox(ctx, this.hoveredAssembly, bounds, {
        color: '#ffff00',
        alpha: 0.3,
        lineWidth: 2,
        dashPattern: [5, 5]
      });
    }    // Render selected assembly highlight
    if (this.selectedAssembly && !this.selectedAssembly.destroyed) {
      this.renderAssemblyBoundingBox(ctx, this.selectedAssembly, bounds, {
        color: '#00ffff',
        alpha: 0.6,
        lineWidth: 3,
        dashPattern: []
      });

      // Add pulsing effect for selected ship
      const pulse = Math.sin(Date.now() / 300) * 0.3 + 0.7;
      this.renderAssemblyBoundingBox(ctx, this.selectedAssembly, bounds, {
        color: '#ffffff',
        alpha: pulse * 0.2,
        lineWidth: 1,
        dashPattern: []
      });
    }

    // Render locked targets for player ship
    if (this.playerAssembly && !this.playerAssembly.destroyed) {
      const lockedTargets = this.getLockedTargets(this.playerAssembly);

      lockedTargets.forEach(target => {
        if (target.destroyed) return;

        // Determine target color based on team
        const isEnemy = target.team !== this.playerAssembly!.team;
        const targetColor = isEnemy ? '#ff4444' : '#44ff44'; // Red for enemies, green for allies

        // Draw target square
        this.renderTargetSquare(ctx, target, bounds, targetColor);
        // If this is the primary target, add extra highlighting
        if (this.playerAssembly!.primaryTarget?.id === target.id) {
          this.renderAssemblyBoundingBox(ctx, target, bounds, {
            color: targetColor,
            alpha: 0.8,
            lineWidth: 4,
            dashPattern: [10, 5]
          });

          // Add pulsing primary target indicator
          const primaryPulse = Math.sin(Date.now() / 200) * 0.4 + 0.6;
          this.renderAssemblyBoundingBox(ctx, target, bounds, {
            color: '#ffffff',
            alpha: primaryPulse * 0.3,
            lineWidth: 2,
            dashPattern: []
          });
        }
      });
    }

    ctx.restore();
  }

  private renderAssemblyBoundingBox(
    ctx: CanvasRenderingContext2D,
    assembly: Assembly,
    bounds: Matter.Bounds,
    style: { color: string; alpha: number; lineWidth: number; dashPattern: number[] }
  ): void {
    if (assembly.entities.length === 0) return;

    // Calculate assembly bounding box
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    assembly.entities.forEach(entity => {
      if (entity.destroyed) return;
      const entityBounds = entity.body.bounds;
      minX = Math.min(minX, entityBounds.min.x);
      minY = Math.min(minY, entityBounds.min.y);
      maxX = Math.max(maxX, entityBounds.max.x);
      maxY = Math.max(maxY, entityBounds.max.y);
    });

    // Add padding
    const padding = 20;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    // Convert to screen coordinates
    const screenMinX = (minX - bounds.min.x) * this.render.canvas.width / (bounds.max.x - bounds.min.x);
    const screenMinY = (minY - bounds.min.y) * this.render.canvas.height / (bounds.max.y - bounds.min.y);
    const screenMaxX = (maxX - bounds.min.x) * this.render.canvas.width / (bounds.max.x - bounds.min.x);
    const screenMaxY = (maxY - bounds.min.y) * this.render.canvas.height / (bounds.max.y - bounds.min.y);

    // Draw bounding box
    ctx.globalAlpha = style.alpha;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.lineWidth;
    ctx.setLineDash(style.dashPattern);

    ctx.beginPath();
    ctx.rect(screenMinX, screenMinY, screenMaxX - screenMinX, screenMaxY - screenMinY);
    ctx.stroke();

    ctx.globalAlpha = 1.0;
    ctx.setLineDash([]);
  }

  public initializeBattle(): void {
    console.log('🚀 Initializing team-based AI battle...');

    // Clear existing assemblies
    this.assemblies.forEach(assembly => {
      Matter.World.remove(this.world, assembly.rootBody);
    });
    this.assemblies = [];
    this.playerAssembly = null;

    // Show battle start notification
    this.toastSystem.showGameEvent("🚀 Battle Initialized!");    // Spawn player team (Team 0) - Blue team close left
    this.spawnTeam(0, -800, 0, 1, true); // Only spawn 1 player ship

    // Spawn enemy team (Team 1) - Red team on the right
    this.spawnTeam(1, 800, 0, 1, false); // 1 enemy AI ship    console.log('⚔️ Battle initialized with player and AI teams!');
    this.toastSystem.showSuccess("Teams deployed - engage!");    // Add floating debris to make the sector more interesting
    console.log('🗑️ Adding sector debris...');
    this.spawnDebrisField(0, 0, 12, 2000); // 12 pieces of debris scattered across 2000 unit radius
    this.toastSystem.showGameEvent("Debris field detected in sector");
  }
  private spawnTeam(team: number, centerX: number, centerY: number, count: number, hasPlayer: boolean): void {
    const ships = shipsData.ships;
    let playerAssigned = false;

    for (let i = 0; i < count; i++) {
      // Spread ships around the center position with reasonable spacing
      const angle = (i / count) * Math.PI * 2;
      const radius = 200; // Much smaller radius for closer combat
      const x = centerX + Math.cos(angle) * radius + (Math.random() - 0.5) * 150; // Less random spread
      const y = centerY + Math.sin(angle) * radius + (Math.random() - 0.5) * 150;      // Pick a ship - use selected ship for player, random for others
      let selectedShip;
      if (hasPlayer && !playerAssigned) {
        // Use the selected ship for the player
        selectedShip = ships[this.selectedPlayerShipIndex] || ships[0];
      } else {
        // Pick a random ship for AI
        selectedShip = ships[Math.floor(Math.random() * ships.length)];
      }

      const assembly = new Assembly(selectedShip.parts as EntityConfig[], { x, y });

      // Set ship name for radar display
      assembly.setShipName(selectedShip.name);

      // Set team
      assembly.setTeam(team); // This now also applies team colors

      // Add to world and our list
      this.assemblies.push(assembly);
      Matter.World.add(this.world, assembly.rootBody);      // Create appropriate controller
      if (hasPlayer && !playerAssigned && assembly.hasControlCenter()) {
        // Make this the player assembly
        this.playerAssembly = assembly;
        assembly.isPlayerControlled = true;
        this.flightController = new FlightController(assembly); // Initialize advanced flight control
        this.controllerManager.createPlayerController(assembly);
        playerAssigned = true;
        console.log(`👤 Player assigned to ${selectedShip.name} on team ${team} with flight controller`);
      } else {
        // Create AI controller
        const aiController = this.controllerManager.createAIController(assembly);
        aiController.setAggressionLevel(0.8 + Math.random() * 0.4); // Vary aggression
        console.log(`🤖 AI ${selectedShip.name} spawned on team ${team}`);
      }
    }
  }  // Method to get radar data for the UI
  public getRadarData() {
    const radarData = this.assemblies.map(assembly => ({
      x: assembly.rootBody.position.x,
      y: assembly.rootBody.position.y,
      team: assembly.team,
      isPlayer: assembly.isPlayerControlled,
      id: assembly.id,
      shipName: assembly.shipName,
      shipType: assembly.isPlayerControlled ? 'Player Ship' :
        assembly.team === -1 ? 'Debris' :
          'AI Ship',
      isDebris: assembly.entities.length === 1 && !assembly.hasControlCenter() || assembly.team === -1 // Single part without cockpit OR neutral team = debris
    }));

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

  // @ts-ignore - Currently unused but may be needed later
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
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    // Apply torque to face target
    if (Math.abs(angleDiff) > 0.1) {
      const torque = Math.sign(angleDiff) * Math.min(0.8, Math.abs(angleDiff) * 2);
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
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    // Apply torque to face target
    if (Math.abs(angleDiff) > 0.05) { // More precise aiming for lock on
      const torque = Math.sign(angleDiff) * Math.min(1.0, Math.abs(angleDiff) * 3);
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
    // Reset to the calculated default zoom for the current window size
    this.calculateDefaultZoom(this.render.canvas.width, this.render.canvas.height);
    this.lastManualZoomTime = Date.now();
    console.log(`🔍 Reset Zoom to calculated default: ${this.baseZoomLevel.toFixed(3)}`);
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

    // Calculate speed-based zoom adjustment as a percentage (max 15% zoom out)
    const maxSpeedZoomPercent = 0.15 * speedZoomInfluence; // Reduced by manual zoom influence
    const speedThreshold = 15; // Speed at which max zoom out is reached
    const speedPercent = Math.min(speed / speedThreshold, 1.0);
    const zoomOutPercent = speedPercent * maxSpeedZoomPercent;

    // Apply the zoom out percentage to the player's chosen base zoom level
    // This way, speed-based zoom works as an offset from the player's preference
    const targetZoom = this.baseZoomLevel * (1 - zoomOutPercent);
    const clampedTargetZoom = Math.max(this.minZoom, targetZoom);

    // Very smooth transition to target zoom
    const smoothingFactor = 0.02; // Much smoother transitions
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

  public setPlayerShipIndex(shipIndex: number): void {
    this.selectedPlayerShipIndex = shipIndex;
  }

  public spawnPlayerShip(shipIndex: number): void {
    this.selectedPlayerShipIndex = shipIndex;

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

  private renderTargetSquare(
    ctx: CanvasRenderingContext2D,
    target: Assembly,
    bounds: Matter.Bounds,
    color: string
  ): void {
    if (target.entities.length === 0) return;

    // Calculate center position of the target
    const centerPos = target.rootBody.position;

    // Convert to screen coordinates
    const screenX = (centerPos.x - bounds.min.x) * this.render.canvas.width / (bounds.max.x - bounds.min.x);
    const screenY = (centerPos.y - bounds.min.y) * this.render.canvas.height / (bounds.max.y - bounds.min.y);

    // Draw targeting square
    const squareSize = 20;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;

    // Draw square
    ctx.beginPath();
    ctx.rect(screenX - squareSize / 2, screenY - squareSize / 2, squareSize, squareSize);
    ctx.stroke();

    // Draw corner brackets for targeting feel
    const bracketSize = 8;
    const bracketOffset = squareSize / 2 + 2;

    ctx.lineWidth = 3;

    // Top-left bracket
    ctx.beginPath();
    ctx.moveTo(screenX - bracketOffset, screenY - bracketOffset + bracketSize);
    ctx.lineTo(screenX - bracketOffset, screenY - bracketOffset);
    ctx.lineTo(screenX - bracketOffset + bracketSize, screenY - bracketOffset);
    ctx.stroke();

    // Top-right bracket
    ctx.beginPath();
    ctx.moveTo(screenX + bracketOffset - bracketSize, screenY - bracketOffset);
    ctx.lineTo(screenX + bracketOffset, screenY - bracketOffset);
    ctx.lineTo(screenX + bracketOffset, screenY - bracketOffset + bracketSize);
    ctx.stroke();

    // Bottom-left bracket
    ctx.beginPath();
    ctx.moveTo(screenX - bracketOffset, screenY + bracketOffset - bracketSize);
    ctx.lineTo(screenX - bracketOffset, screenY + bracketOffset);
    ctx.lineTo(screenX - bracketOffset + bracketSize, screenY + bracketOffset);
    ctx.stroke();

    // Bottom-right bracket
    ctx.beginPath();
    ctx.moveTo(screenX + bracketOffset - bracketSize, screenY + bracketOffset);
    ctx.lineTo(screenX + bracketOffset, screenY + bracketOffset);
    ctx.lineTo(screenX + bracketOffset, screenY + bracketOffset - bracketSize);
    ctx.stroke();

    // Add target name text
    ctx.fillStyle = color;
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(target.shipName, screenX, screenY + bracketOffset + 15);

    ctx.globalAlpha = 1.0;
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
  } private renderAimingDebug(): void {
    if (!this.playerAssembly || this.playerAssembly.destroyed) return;

    const ctx = this.render.canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    const bounds = this.render.bounds;
    const currentAngle = this.playerAssembly.rootBody.angle;

    // Get ship center position for reference lines
    const shipPos = this.playerAssembly.rootBody.position;
    const shipScreenX = (shipPos.x - bounds.min.x) * this.render.canvas.width / (bounds.max.x - bounds.min.x);
    const shipScreenY = (shipPos.y - bounds.min.y) * this.render.canvas.height / (bounds.max.y - bounds.min.y);

    const distanceRanges = [100, 200, 300, 500]; // World units
    const maxDistance = Math.max(...distanceRanges);

    // Draw weapon aiming visualization
    const weapons = this.playerAssembly.entities.filter(e => e.canFire());
    weapons.forEach((weapon) => {
      const weaponPos = weapon.body.position;

      // Convert weapon position to screen coordinates
      const weaponScreenX = (weaponPos.x - bounds.min.x) * this.render.canvas.width / (bounds.max.x - bounds.min.x);
      const weaponScreenY = (weaponPos.y - bounds.min.y) * this.render.canvas.height / (bounds.max.y - bounds.min.y);

      // Calculate weapon angles
      const weaponNaturalAngle = currentAngle + (weapon.rotation * Math.PI / 180);
      const aimingArc = this.playerAssembly!.getWeaponAimingArc(weapon.type);      // Draw distance guide arcs from this weapon's position within its aiming arc
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6; distanceRanges.forEach((worldDistance) => {
        const screenDistance = worldDistance * this.render.canvas.width / (bounds.max.x - bounds.min.x);

        // Draw arc only within the weapon's aiming range
        const arcStartAngle = weaponNaturalAngle - aimingArc / 2;
        const arcEndAngle = weaponNaturalAngle + aimingArc / 2;

        ctx.beginPath();
        ctx.arc(weaponScreenX, weaponScreenY, screenDistance, arcStartAngle, arcEndAngle);
        ctx.stroke();
      });

      // Draw radial lines to cap off the arcs (pizza slice edges)
      const largestScreenDistance = maxDistance * this.render.canvas.width / (bounds.max.x - bounds.min.x);
      const leftBoundaryAngle = weaponNaturalAngle - aimingArc / 2;
      const rightBoundaryAngle = weaponNaturalAngle + aimingArc / 2;

      // Left boundary line
      ctx.beginPath();
      ctx.moveTo(weaponScreenX, weaponScreenY);
      const leftEndX = weaponScreenX + Math.cos(leftBoundaryAngle) * largestScreenDistance;
      const leftEndY = weaponScreenY + Math.sin(leftBoundaryAngle) * largestScreenDistance;
      ctx.lineTo(leftEndX, leftEndY);
      ctx.stroke();

      // Right boundary line
      ctx.beginPath();
      ctx.moveTo(weaponScreenX, weaponScreenY);
      const rightEndX = weaponScreenX + Math.cos(rightBoundaryAngle) * largestScreenDistance;
      const rightEndY = weaponScreenY + Math.sin(rightBoundaryAngle) * largestScreenDistance;
      ctx.lineTo(rightEndX, rightEndY);
      ctx.stroke(); ctx.globalAlpha = 1.0;

      // Draw distance labels for this weapon (only for the largest arc to avoid clutter)
      const largestDistance = distanceRanges[distanceRanges.length - 1];
      const largestLabelScreenDistance = largestDistance * this.render.canvas.width / (bounds.max.x - bounds.min.x);

      ctx.fillStyle = '#888888';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.8;      // Place label at the center of the weapon's aiming arc
      const labelAngle = weaponNaturalAngle;
      const labelX = weaponScreenX + Math.cos(labelAngle) * (largestLabelScreenDistance + 15);
      const labelY = weaponScreenY + Math.sin(labelAngle) * (largestLabelScreenDistance + 15);
      ctx.fillText(`${largestDistance}u`, labelX, labelY);
      ctx.globalAlpha = 1.0;      // Draw line from ship center to weapon position
      ctx.strokeStyle = '#aaaaaa';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(shipScreenX, shipScreenY);
      ctx.lineTo(weaponScreenX, weaponScreenY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;

      // Draw weapon position marker
      ctx.fillStyle = '#dddddd';
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(weaponScreenX, weaponScreenY, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // Draw weapon type label
      ctx.fillStyle = '#bbbbbb';
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.9;
      ctx.fillText(weapon.type, weaponScreenX, weaponScreenY - 12);
      ctx.globalAlpha = 1.0;

      // Draw line from weapon to furthest distance arc
      const maxDistanceScreen = maxDistance * this.render.canvas.width / (bounds.max.x - bounds.min.x);
      const currentAimAngle = weapon.getCurrentFiringAngle(currentAngle);
      ctx.strokeStyle = '#999999';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(weaponScreenX, weaponScreenY);

      // Extend line in the direction of current weapon aim to the furthest arc
      const extensionEndX = weaponScreenX + Math.cos(currentAimAngle) * maxDistanceScreen;
      const extensionEndY = weaponScreenY + Math.sin(currentAimAngle) * maxDistanceScreen;
      ctx.lineTo(extensionEndX, extensionEndY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;
    });

    ctx.restore();
  }

  private updateCursorWorldPosition(): void {
    if (!this.playerAssembly || this.playerAssembly.destroyed) return;

    // Convert screen coordinates to world coordinates
    // Account for zoom level in the coordinate conversion
    const zoomFactor = this.render.options.hasBounds ?
      (this.render.bounds.max.x - this.render.bounds.min.x) / this.render.canvas.width : 1;

    const worldX = this.render.bounds.min.x + this.mousePosition.x * zoomFactor;
    const worldY = this.render.bounds.min.y + this.mousePosition.y * zoomFactor;

    this.playerAssembly.cursorPosition = { x: worldX, y: worldY };
  }
}
