import * as Matter from 'matter-js';
import { Assembly } from './Assembly';
import { Entity } from './Entity';
import { EntityConfig, GRID_SIZE } from '../types/GameTypes';
import { getBlockDefinition, BLOCK_SIZE } from './BlockSystem';
import shipsData from '../data/ships.json';
import { ControllerManager } from './ControllerManager';
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
  private runner: Matter.Runner;
  // Mouse interaction properties
  private mouse!: Matter.Mouse;
  private mouseConstraint!: Matter.MouseConstraint; private mousePosition: { x: number, y: number } = { x: 0, y: 0 };
  private mouseDown: boolean = false;
  private mouseMovementInfluence: number = 0.05; // Much more subtle mouse influence
  private maxMouseOffset: number = 100; // Maximum distance camera can be offset by mouse
  private zoomLevel: number = 1.5; // Start zoomed in to see ships clearly
  private minZoom: number = 0.1; // Allow zooming out much further
  private maxZoom: number = 4; // Allow zooming in more
  private lastFrameTime: number = 0;
  private controllerManager: ControllerManager = new ControllerManager();

  constructor(container: HTMLElement) {
    console.log('🎮 Creating GameEngine...');

    // Create engine
    this.engine = Matter.Engine.create();
    this.world = this.engine.world;
    this.runner = Matter.Runner.create();
    console.log('⚙️  Matter.js engine created');    // Configure engine for space-like physics
    this.engine.world.gravity.y = 0; // No gravity in space
    this.engine.world.gravity.x = 0; // Ensure no horizontal gravity either

    // Set global air resistance to zero for space-like physics
    this.engine.world.bodies.forEach(body => {
      body.frictionAir = 0; // No air resistance in space
    });

    // Create renderer with debug options - matching MVP spec
    const containerWidth = container.clientWidth || 800;
    const containerHeight = container.clientHeight || 600;

    console.log(`📐 Container dimensions: ${containerWidth}x${containerHeight}`);

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

    // Initialize mouse interaction
    this.setupMouseInteraction();
    this.setupEventListeners();
    this.setupCollisionDetection();
    this.setupRenderEvents();
  }

  private setupEventListeners(): void {
    // Keyboard input
    document.addEventListener('keydown', (event) => {
      this.keys.add(event.key.toLowerCase());        // Handle special keys
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
  }

  private handleEntityCollision(entityA: Entity, entityB: Entity): void {
    // Flash on impact for any entity collision
    if (!entityA.destroyed && !entityA.isFlashing) {
      entityA.triggerCollisionFlash();
    }
    if (!entityB.destroyed && !entityB.isFlashing) {
      entityB.triggerCollisionFlash();
    }

    // Optional: Add some impact damage for hard collisions
    // You can uncomment this if you want collisions to cause damage
    // const impactForce = Math.min(entityA.body.speed + entityB.body.speed, 10);
    // if (impactForce > 5) {
    //   entityA.takeDamage(1);
    //   entityB.takeDamage(1);
    // }
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

    this.running = true;

    // Start renderer
    console.log('🖼️  About to start renderer...');
    console.log('Render object:', this.render);
    console.log('Render canvas:', this.render.canvas);
    Matter.Render.run(this.render);
    console.log('🖼️  Renderer started');
    // Start engine with runner
    Matter.Runner.run(this.runner, this.engine);
    console.log('⚙️  Engine runner started');    // Start game loop
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
    this.handlePlayerInput();

    // Update assemblies
    this.assemblies.forEach(assembly => assembly.update());

    // Update entity flash effects
    this.updateEntityFlashes(deltaTime);

    // Update bullets
    this.updateBullets();

    // Clean up destroyed assemblies
    this.cleanupDestroyedAssemblies();

    // Find player assembly if we don't have one
    if (!this.playerAssembly || this.playerAssembly.destroyed || !this.playerAssembly.hasControlCenter()) {
      this.findPlayerAssembly();
    }

    // Update camera with mouse influence
    this.updateCameraWithMouse();

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
    };

    // Keyboard thrust controls
    if (this.keys.has('w') || this.keys.has('arrowup')) {
      const angle = this.playerAssembly.rootBody.angle;
      input.thrust = {
        x: Math.cos(angle) * 0.08,
        y: Math.sin(angle) * 0.08
      };
    }

    // Reverse thrust
    if (this.keys.has('s') || this.keys.has('arrowdown')) {
      const angle = this.playerAssembly.rootBody.angle;
      input.thrust = {
        x: Math.cos(angle) * -0.04,
        y: Math.sin(angle) * -0.04
      };
    }

    // Manual rotation
    if (this.keys.has('a') || this.keys.has('arrowleft')) {
      input.torque = -0.5;
    }
    if (this.keys.has('d') || this.keys.has('arrowright')) {
      input.torque = 0.5;
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
      console.log(`🌍 Added to world, total assemblies: ${this.assemblies.length}`);

      // Set as player if requested
      if (isPlayer && (!this.playerAssembly || this.playerAssembly.destroyed)) {
        this.playerAssembly = assembly;
        assembly.isPlayerControlled = true;
        console.log('👤 Set as player assembly');
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
    });
    // Add event listener to filter dragging - only allow debris objects (cockpitless assemblies)
    Matter.Events.on(this.mouseConstraint, 'startdrag', (event: any) => {
      const body = event.body;
      const assembly = this.getAssemblyFromBody(body);

      if (assembly && assembly.hasControlCenter()) {
        // This assembly has a cockpit, prevent dragging by removing the constraint
        this.mouseConstraint.constraint.bodyB = null;
      }
    });

    Matter.World.add(this.world, this.mouseConstraint);// Track mouse position for camera and targeting
    this.render.canvas.addEventListener('mousemove', (event) => {
      const rect = this.render.canvas.getBoundingClientRect();
      this.mousePosition = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
    });

    // Left mouse button - primary fire and interactions
    this.render.canvas.addEventListener('mousedown', (event) => {
      if (event.button === 0) { // Left mouse button
        this.mouseDown = true;
        this.handleLeftClick(event);
      } else if (event.button === 2) { // Right mouse button
        this.handleRightClick(event);
      }
    });

    this.render.canvas.addEventListener('mouseup', (event) => {
      if (event.button === 0) {
        this.mouseDown = false;
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

    // Keep mouse constraint in sync with render bounds
    this.render.mouse = this.mouse;
  } private handleLeftClick(_event: MouseEvent): void {
    // Fire weapons in the direction the ship is facing
    if (this.playerAssembly && !this.playerAssembly.destroyed) {
      // Fire weapons in ship's current direction (no mouse aiming)
      const newBullets = this.playerAssembly.fireWeapons();
      newBullets.forEach(bullet => {
        Matter.World.add(this.world, bullet);
        this.bullets.push(bullet);
      });
    }
  }

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

    // Use afterRender for grid and connection points
    Matter.Events.on(this.render, 'afterRender', () => {
      if (this.showGrid) {
        this.renderGrid();
      }
      this.renderConnectionPoints();
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

  public initializeBattle(): void {
    console.log('🚀 Initializing team-based AI battle...');

    // Clear existing assemblies
    this.assemblies.forEach(assembly => {
      Matter.World.remove(this.world, assembly.rootBody);
    });
    this.assemblies = [];
    this.playerAssembly = null;    // Spawn player team (Team 0) - Blue team MASSIVELY far left
    this.spawnTeam(0, -40000, 0, 4, true); // Player team 10x further left

    // Spawn enemy team (Team 1) - Red team MASSIVELY far right  
    this.spawnTeam(1, 40000, 0, 4, false); // AI team 10x further right

    console.log('⚔️ Battle initialized with player and AI teams!');
  }

  private spawnTeam(team: number, centerX: number, centerY: number, count: number, hasPlayer: boolean): void {
    const ships = shipsData.ships;
    let playerAssigned = false; for (let i = 0; i < count; i++) {
      // Spread ships MASSIVELY around the center position (10x more spread)
      const angle = (i / count) * Math.PI * 2;
      const radius = 1500; // 10x larger radius
      const x = centerX + Math.cos(angle) * radius + (Math.random() - 0.5) * 1000; // 10x more random spread
      const y = centerY + Math.sin(angle) * radius + (Math.random() - 0.5) * 1000;

      // Pick a random ship
      const randomShip = ships[Math.floor(Math.random() * ships.length)];
      const assembly = new Assembly(randomShip.parts as EntityConfig[], { x, y });      // Set team
      assembly.setTeam(team); // This now also applies team colors

      // Add to world and our list
      this.assemblies.push(assembly);
      Matter.World.add(this.world, assembly.rootBody);

      // Create appropriate controller
      if (hasPlayer && !playerAssigned && assembly.hasControlCenter()) {
        // Make this the player assembly
        this.playerAssembly = assembly;
        assembly.isPlayerControlled = true;
        this.controllerManager.createPlayerController(assembly);
        playerAssigned = true;
        console.log(`👤 Player assigned to ${randomShip.name} on team ${team}`);
      } else {
        // Create AI controller
        const aiController = this.controllerManager.createAIController(assembly);
        aiController.setAggressionLevel(0.8 + Math.random() * 0.4); // Vary aggression
        console.log(`🤖 AI ${randomShip.name} spawned on team ${team}`);
      }
    }
  }  // Method to get radar data for the UI
  public getRadarData() {
    console.log('📡 getRadarData called, assemblies count:', this.assemblies.length);

    const radarData = this.assemblies.map(assembly => ({
      x: assembly.rootBody.position.x,
      y: assembly.rootBody.position.y,
      team: assembly.team,
      isPlayer: assembly.isPlayerControlled,
      id: assembly.id
    }));

    console.log('📡 Returning radar data:', radarData.length, 'entries');
    if (radarData.length > 0) {
      console.log('📡 Sample entry:', radarData[0]);
    }

    return radarData;
  }
}
