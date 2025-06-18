import * as Matter from 'matter-js';
import Stats from 'stats.js';
import { Assembly } from './Assembly';
import { Entity } from './Entity';
import { EntityConfig, GRID_SIZE } from '../types/GameTypes';
import { getBlockDefinition, BLOCK_SIZE } from './BlockSystem';
import shipsData from '../data/ships.json';
import { ControllerManager } from './ControllerManager';
import { FlightController } from './FlightController';
import { ControlInput } from './Controller';

export class GameEngine {
  private engine: Matter.Engine;
  private render: Matter.Render;
  private world: Matter.World;
  private assemblies: Assembly[] = [];
  private bullets: Matter.Body[] = [];
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
  private zoomLevel: number = 1.5; // Will be calculated based on window size
  private minZoom: number = 0.1; // Allow zooming out much further
  private maxZoom: number = 4; // Allow zooming in more
  private lastFrameTime: number = 0;
  private controllerManager: ControllerManager = new ControllerManager();
  private flightController: FlightController | null = null; // Advanced flight control  // Zoom control properties
  private baseZoomLevel: number = 0.2; // Start closer so speed-based zoom out is more noticeable
  private speedBasedZoomEnabled: boolean = true;
  // private zoomSmoothingFactor: number = 0.02; // Smooth transitions - currently unused

  // Stats.js for FPS monitoring
  private stats: Stats;

  // Ship selection and player destruction callback
  public onPlayerDestroyed?: () => void;
  private selectedPlayerShipIndex: number = 0;

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
    console.log('Canvas element:', this.render.canvas);

    // Initialize Stats.js for FPS monitoring
    this.stats = new Stats();
    this.stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
    this.stats.dom.style.position = 'absolute';
    this.stats.dom.style.right = '10px';
    this.stats.dom.style.top = '10px';
    this.stats.dom.style.zIndex = '1000';
    container.appendChild(this.stats.dom);

    // Initialize mouse interaction
    this.setupMouseInteraction();
    this.setupEventListeners();
    this.setupCollisionDetection();
    this.setupRenderEvents();
  }

  private calculateDefaultZoom(containerWidth: number, containerHeight: number): void {
    // Base zoom calculation - larger windows should zoom out more to show more battlefield
    const minDimension = Math.min(containerWidth, containerHeight);
    const maxDimension = Math.max(containerWidth, containerHeight);

    // Calculate base zoom - smaller windows get closer zoom, larger windows get further zoom
    let baseZoom = 1.5; // Default for small screens

    if (minDimension >= 800) {
      // Large screens - zoom out more to show more of the battlefield
      const sizeMultiplier = Math.min(minDimension / 800, 2.5); // Cap at 2.5x multiplier
      baseZoom = 1.5 / sizeMultiplier; // Inverse relationship - larger screen = smaller zoom = more zoomed out
    } else if (minDimension >= 600) {
      // Medium screens - moderate zoom out
      const sizeMultiplier = minDimension / 600;
      baseZoom = 1.5 / (1 + (sizeMultiplier - 1) * 0.5);
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
    }

    // Debug collision physics - THIS IS THE KEY DEBUG INFO!
    const assemblyA = this.getAssemblyFromBody(entityA.body);
    const assemblyB = this.getAssemblyFromBody(entityB.body);

    console.log('🥊 COLLISION DEBUG:');
    console.log(`  Entity A: ${entityA.type} (individual mass: ${entityA.body.mass})`);
    console.log(`  Entity B: ${entityB.type} (individual mass: ${entityB.body.mass})`);

    if (assemblyA) {
      const totalMassA = assemblyA.entities.reduce((sum, e) => sum + e.body.mass, 0);
      console.log(`  Assembly A: ${assemblyA.entities.length} parts, total calculated mass: ${totalMassA}, Matter.js root body mass: ${assemblyA.rootBody.mass}`);
      console.log(`  Assembly A velocity: ${Math.sqrt(assemblyA.rootBody.velocity.x ** 2 + assemblyA.rootBody.velocity.y ** 2).toFixed(2)}`);
      console.log(`  Assembly A angular velocity: ${assemblyA.rootBody.angularVelocity.toFixed(3)}`);
    }

    if (assemblyB) {
      const totalMassB = assemblyB.entities.reduce((sum, e) => sum + e.body.mass, 0);
      console.log(`  Assembly B: ${assemblyB.entities.length} parts, total calculated mass: ${totalMassB}, Matter.js root body mass: ${assemblyB.rootBody.mass}`);
      console.log(`  Assembly B velocity: ${Math.sqrt(assemblyB.rootBody.velocity.x ** 2 + assemblyB.rootBody.velocity.y ** 2).toFixed(2)}`);
      console.log(`  Assembly B angular velocity: ${assemblyB.rootBody.angularVelocity.toFixed(3)}`);
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
    // Light debris hitting heavy ships should cause minimal damage
    if (relativeVelocity > 3 && massRatio > 0.1) { // Minimum speed and mass ratio for damage
      const impactForce = (relativeVelocity * Math.min(massA, massB)) / 1000;

      if (impactForce > 1) {
        const damage = Math.floor(impactForce);
        console.log(`💥 Collision damage: ${damage} (masses: ${massA}/${massB}, velocities: ${velocityA.toFixed(1)}/${velocityB.toFixed(1)})`);

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
      if (hitAssembly && hitAssembly.id === sourceAssemblyId) {
        // This is a self-hit, ignore it
        console.log('🛡️ Self-hit prevented');
        return;
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
          this.assemblies.splice(assemblyIndex, 1, ...newAssemblies);

          // Add all new assemblies to physics world
          newAssemblies.forEach((newAssembly, index) => {
            console.log(`  Assembly ${index}: ${newAssembly.entities.length} parts`);
            Matter.World.add(this.world, newAssembly.rootBody);

            // If this was the player assembly, reassign player control
            if (assembly.isPlayerControlled && newAssembly.isPlayerControlled) {
              this.playerAssembly = newAssembly;
              console.log('👤 Player control transferred to new assembly');
            }
          });

          // If original was player assembly but no new assembly has control, find one
          if (assembly.isPlayerControlled && !this.playerAssembly) {
            const newPlayerAssembly = newAssemblies.find(a => a.hasControlCenter());
            if (newPlayerAssembly) {
              this.playerAssembly = newPlayerAssembly;
              newPlayerAssembly.isPlayerControlled = true;
              console.log('👤 Player control assigned to assembly with cockpit');
            }
          }
        }
      }
    }
  } public start(): void {
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
  } private gameLoop(): void {
    if (!this.running) return;

    // Calculate delta time
    const currentTime = performance.now();
    const deltaTime = currentTime - (this.lastFrameTime || currentTime);
    this.lastFrameTime = currentTime;
    // Update controllers (handles both player input and AI)
    const newBullets = this.controllerManager.update(deltaTime, this.assemblies);

    // Add new bullets to physics world
    newBullets.forEach(bullet => {
      Matter.World.add(this.world, bullet);
      this.bullets.push(bullet);
    });
    // Handle additional player input (mouse controls, etc.)
    this.handlePlayerInput();    // Update assemblies
    this.assemblies.forEach(assembly => assembly.update());

    // Update entity flash effects
    this.updateEntityFlashes(deltaTime);

    // Update bullets
    this.updateBullets();

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
      });
    });
  } private handlePlayerInput(): void {
    if (!this.playerAssembly || this.playerAssembly.destroyed) return;

    // Create control input based on keyboard and mouse
    const input: ControlInput = {
      thrust: { x: 0, y: 0 },
      torque: 0,
      fire: false
    };    // Keyboard thrust controls - ship-local coordinates
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
    }// Manual rotation
    if (this.keys.has('a') || this.keys.has('arrowleft')) {
      input.torque = -1.0; // Increased from -0.15 to -1.0 (6.7x stronger)
    }
    if (this.keys.has('d') || this.keys.has('arrowright')) {
      input.torque = 1.0; // Increased from 0.15 to 1.0 (6.7x stronger)
    }

    // Firing
    if (this.keys.has(' ') || this.mouseDown) {
      input.fire = true;
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
  }

  private cleanupDestroyedAssemblies(): void {
    const destroyedAssemblies = this.assemblies.filter(a => a.destroyed || a.entities.length === 0);

    destroyedAssemblies.forEach(assembly => {
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
    );

    if (controllableAssembly) {
      this.playerAssembly = controllableAssembly;
      this.playerAssembly.isPlayerControlled = true;
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

      // Update hovered assembly
      const hoveredAssembly = this.getAssemblyAtPosition(this.mousePosition.x, this.mousePosition.y);
      this.setHoveredAssembly(hoveredAssembly);
    });    // Left mouse button - primary fire and interactions (selection handled by Matter.js events)
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
    });

    // Add a simple click event for testing
    this.render.canvas.addEventListener('click', (event) => {
      console.log('🖱️ Simple click event detected at:', event.clientX, event.clientY);
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

  private handleRightClick(event: MouseEvent): void {
    // Right click for alternative actions - rotate to face mouse
    if (this.playerAssembly && !this.playerAssembly.destroyed) {
      const rect = this.render.canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left + this.render.bounds.min.x;
      const mouseY = event.clientY - rect.top + this.render.bounds.min.y;

      // Calculate angle from player to mouse
      const playerPos = this.playerAssembly.rootBody.position;
      const targetAngle = Math.atan2(mouseY - playerPos.y, mouseX - playerPos.x);

      // Set the rotation to face the mouse
      Matter.Body.setAngle(this.playerAssembly.rootBody, targetAngle);
    }
  }
  private handleMouseWheel(event: WheelEvent): void {
    // Zoom in/out based on wheel direction (inverted for natural feel)
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1; // Wheel down = zoom out, wheel up = zoom in
    this.zoomLevel *= zoomFactor;

    // Clamp zoom level
    this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel));

    // Apply zoom to render bounds
    const centerX = (this.render.bounds.min.x + this.render.bounds.max.x) / 2;
    const centerY = (this.render.bounds.min.y + this.render.bounds.max.y) / 2;
    const width = this.render.canvas.width / this.zoomLevel;
    const height = this.render.canvas.height / this.zoomLevel;

    Matter.Render.lookAt(this.render, {
      min: { x: centerX - width / 2, y: centerY - height / 2 },
      max: { x: centerX + width / 2, y: centerY + height / 2 }
    });
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
    });

    // Use afterRender for grid and connection points
    Matter.Events.on(this.render, 'afterRender', () => {
      if (this.showGrid) {
        this.renderGrid();
      }
      this.renderConnectionPoints();
      this.renderShipHighlights();
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
  }

  private renderShipHighlights(): void {
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
    }

    // Render selected assembly highlight
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

  // ...existing code...
  public initializeBattle(): void {
    console.log('🚀 Initializing team-based AI battle...');

    // Clear existing assemblies
    this.assemblies.forEach(assembly => {
      Matter.World.remove(this.world, assembly.rootBody);
    }); this.assemblies = [];
    this.playerAssembly = null;

    // Spawn player team (Team 0) - Blue team close left
    this.spawnTeam(0, -800, 0, 4, true); // Much closer - only 800 units left

    // Spawn enemy team (Team 1) - Red team close right  
    this.spawnTeam(1, 800, 0, 4, false); // Much closer - only 800 units right

    console.log('⚔️ Battle initialized with player and AI teams!');
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
    console.log('📡 getRadarData called, assemblies count:', this.assemblies.length); const radarData = this.assemblies.map(assembly => ({
      x: assembly.rootBody.position.x,
      y: assembly.rootBody.position.y,
      team: assembly.team,
      isPlayer: assembly.isPlayerControlled,
      id: assembly.id,
      shipName: assembly.shipName,
      shipType: assembly.isPlayerControlled ? 'Player Ship' : 'AI Ship',
      isDebris: assembly.entities.length === 1 && !assembly.hasControlCenter() // Single part without cockpit = debris
    }));

    console.log('📡 Returning radar data:', radarData.length, 'entries');
    if (radarData.length > 0) {
      console.log('📡 Sample entry:', radarData[0]);
    }

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
          break;
        case 'lockOn':
          console.log('🔒 Setting player to lock onto target:', this.playerCommandTarget?.shipName);
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
    console.log(`🔍 Zoom In: ${this.baseZoomLevel.toFixed(2)}`);
  }

  public zoomOut(): void {
    this.baseZoomLevel = Math.max(this.baseZoomLevel * 0.67, this.minZoom);
    console.log(`🔍 Zoom Out: ${this.baseZoomLevel.toFixed(2)}`);
  } public resetZoom(): void {
    this.baseZoomLevel = 0.2;
    console.log(`🔍 Reset Zoom: ${this.baseZoomLevel.toFixed(2)}`);
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
      this.zoomLevel = this.baseZoomLevel;
      return;
    }

    const speed = this.getCurrentSpeed();    // Calculate speed-based zoom adjustment as a percentage (max 15% zoom out)
    const maxSpeedZoomPercent = 0.15; // Maximum 15% zoom out
    const speedThreshold = 15; // Reduced from 50 to 15 - speed at which max zoom out is reached
    const speedPercent = Math.min(speed / speedThreshold, 1.0);
    const zoomOutPercent = speedPercent * maxSpeedZoomPercent;

    // Apply the zoom out percentage to the base zoom level
    const targetZoom = this.baseZoomLevel * (1 - zoomOutPercent);
    const clampedTargetZoom = Math.max(this.minZoom, targetZoom);

    // Very smooth transition to target zoom
    const smoothingFactor = 0.02; // Much smoother transitions
    this.zoomLevel += (clampedTargetZoom - this.zoomLevel) * smoothingFactor;

    // Debug logging (uncomment to see zoom changes)
    // if (speed > 1) {
    //   console.log(`🔍 Speed: ${speed.toFixed(1)}, ZoomOut%: ${(zoomOutPercent * 100).toFixed(1)}%, Target: ${clampedTargetZoom.toFixed(3)}, Current: ${this.zoomLevel.toFixed(3)}`);
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

    // Remove current player assembly from world
    const playerIndex = this.assemblies.findIndex(a => a === this.playerAssembly);
    if (playerIndex !== -1) {
      Matter.World.remove(this.world, this.playerAssembly!.rootBody);
      this.assemblies.splice(playerIndex, 1);
    }

    // Perform ejection
    const newAssemblies = this.playerAssembly!.ejectNonControlParts();

    // Add all new assemblies to world and our list
    newAssemblies.forEach(assembly => {
      this.assemblies.push(assembly);
      Matter.World.add(this.world, assembly.rootBody);
    });

    // The first assembly should be the cockpit with player control
    const cockpitAssembly = newAssemblies.find(a => a.isPlayerControlled);
    if (cockpitAssembly) {
      this.playerAssembly = cockpitAssembly;
      this.flightController = new FlightController(cockpitAssembly);
      this.controllerManager.createPlayerController(cockpitAssembly);
      console.log('👤 Player control transferred to ejected cockpit');
    } else {
      console.warn('⚠️ No cockpit assembly found after ejection');
      this.playerAssembly = null;
    }
  }
}
