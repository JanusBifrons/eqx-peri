import * as Matter from 'matter-js';
import { Assembly } from './Assembly';
import { Entity } from './Entity';
import { EntityConfig, GRID_SIZE } from '../types/GameTypes';
import shipsData from '../data/ships.json';

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
  private mouseConstraint!: Matter.MouseConstraint;
  private mousePosition: { x: number, y: number } = { x: 0, y: 0 };
  private mouseDown: boolean = false;
  private mouseMovementInfluence: number = 0.05; // Much more subtle mouse influence
  private maxMouseOffset: number = 100; // Maximum distance camera can be offset by mouse
  private zoomLevel: number = 1;
  private minZoom: number = 0.3;
  private maxZoom: number = 3;

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
      engine: this.engine,
      options: {
        width: containerWidth,
        height: containerHeight,
        wireframes: false, // Turn off wireframes to see colors
        background: '#000011',
        showVelocity: true,
        showCollisions: true,
        showBounds: true,
        showAxes: true,
        showAngleIndicator: true,
        showIds: true // Show IDs to help debug
      }
    });    console.log('🖼️  Renderer created');
    console.log('Canvas element:', this.render.canvas);
    
    // Initialize mouse interaction
    this.setupMouseInteraction();
    this.setupEventListeners();
    this.setupCollisionDetection();
  }

  private setupEventListeners(): void {
    // Keyboard input
    document.addEventListener('keydown', (event) => {
      this.keys.add(event.key.toLowerCase());        // Handle special keys
      switch (event.key.toLowerCase()) {
        case '1':
          this.spawnShip(Math.random() * 400 - 200, Math.random() * 400 - 200, false);
          break;        case 'g':
          this.toggleGrid();
          break;
      }
    });

    document.addEventListener('keyup', (event) => {
      this.keys.delete(event.key.toLowerCase());
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      this.render.canvas.width = this.render.element.clientWidth;
      this.render.canvas.height = this.render.element.clientHeight;
    });
  }
  private setupCollisionDetection(): void {
    Matter.Events.on(this.engine, 'collisionStart', (event: { pairs: { bodyA: Matter.Body; bodyB: Matter.Body }[] }) => {
      event.pairs.forEach(pair => {
        const { bodyA, bodyB } = pair;
        
        // Check for bullet collisions
        if (bodyA.isBullet && bodyB.entity) {
          this.handleBulletHit(bodyA, bodyB.entity);
        } else if (bodyB.isBullet && bodyA.entity) {
          this.handleBulletHit(bodyB, bodyA.entity);
        }
      });
    });
  }

  private handleBulletHit(bullet: Matter.Body, entity: Entity): void {
    // Remove bullet
    Matter.World.remove(this.world, bullet);
    this.bullets = this.bullets.filter(b => b !== bullet);
      // Apply damage - more damage to make breaking easier to demonstrate
    const destroyed = entity.takeDamage(50);    if (destroyed) {
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
  }  public start(): void {
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
    console.log('⚙️  Engine runner started');
      // Start game loop
    this.gameLoop();
    console.log('🔄 Game loop started');
    
    // Spawn ships to demonstrate breaking mechanics
    console.log('🛸 About to spawn demo ships...');
    this.spawnDemoShips();
  }

  public stop(): void {
    this.running = false;
    Matter.Render.stop(this.render);
    Matter.Runner.stop(this.runner);
    Matter.Engine.clear(this.engine);
  }
  private gameLoop(): void {
    if (!this.running) return;
    
    // Handle input
    this.handleInput();
    
    // Update assemblies
    this.assemblies.forEach(assembly => assembly.update());
    
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
    
    // Render grid if enabled
    if (this.showGrid) {
      this.renderGrid();
    }
    
    // Continue loop
    requestAnimationFrame(() => this.gameLoop());
  }
  private handleInput(): void {
    if (!this.playerAssembly || this.playerAssembly.destroyed) return;
    
    // Mouse-based rotation - automatically face mouse cursor
    if (this.mousePosition.x !== 0 || this.mousePosition.y !== 0) {
      const playerPos = this.playerAssembly.rootBody.position;
      const worldMouseX = this.mousePosition.x + this.render.bounds.min.x;
      const worldMouseY = this.mousePosition.y + this.render.bounds.min.y;
      
      const targetAngle = Math.atan2(worldMouseY - playerPos.y, worldMouseX - playerPos.x);
      const currentAngle = this.playerAssembly.rootBody.angle;
      
      // Smooth rotation towards mouse
      let angleDiff = targetAngle - currentAngle;
      
      // Normalize angle difference to [-π, π]
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      
      // Apply smooth rotation
      const rotationSpeed = 0.1;
      this.playerAssembly.applyTorque(angleDiff * rotationSpeed);
    }
    
    // Keyboard thrust controls
    if (this.keys.has('w') || this.keys.has('arrowup')) {
      const angle = this.playerAssembly.rootBody.angle;
      const thrust = {
        x: Math.cos(angle) * 0.003,
        y: Math.sin(angle) * 0.003
      };
      this.playerAssembly.applyThrust(thrust);
    }
    
    // Reverse thrust
    if (this.keys.has('s') || this.keys.has('arrowdown')) {
      const angle = this.playerAssembly.rootBody.angle;
      const thrust = {
        x: Math.cos(angle) * -0.0015,
        y: Math.sin(angle) * -0.0015
      };
      this.playerAssembly.applyThrust(thrust);
    }
    
    // Manual rotation (override mouse rotation)
    if (this.keys.has('a') || this.keys.has('arrowleft')) {
      this.playerAssembly.applyTorque(-0.15);
    }
    if (this.keys.has('d') || this.keys.has('arrowright')) {
      this.playerAssembly.applyTorque(0.15);
    }

    // Firing (keyboard space bar)
    if (this.keys.has(' ')) {
      const newBullets = this.playerAssembly.fireWeapons();
      newBullets.forEach(bullet => {
        Matter.World.add(this.world, bullet);
        this.bullets.push(bullet);
      });
    }
      // Continuous firing with left mouse button held down
    if (this.mouseDown) {
      const now = Date.now();
      if (now - this.playerAssembly.lastFireTime > this.playerAssembly.fireRate) {
        // Calculate angle from player to mouse for continuous fire
        const playerPos = this.playerAssembly.rootBody.position;
        const worldMouseX = this.mousePosition.x + this.render.bounds.min.x;
        const worldMouseY = this.mousePosition.y + this.render.bounds.min.y;
        
        const angle = Math.atan2(worldMouseY - playerPos.y, worldMouseX - playerPos.x);
        
        const newBullets = this.playerAssembly.fireWeapons(angle);
        newBullets.forEach(bullet => {
          Matter.World.add(this.world, bullet);
          this.bullets.push(bullet);
        });
        this.playerAssembly.lastFireTime = now;
      }
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
  }

  private renderGrid(): void {
    const ctx = this.render.canvas.getContext('2d');
    if (!ctx) return;
    
    const bounds = this.render.bounds;
    const startX = Math.floor(bounds.min.x / GRID_SIZE) * GRID_SIZE;
    const endX = Math.ceil(bounds.max.x / GRID_SIZE) * GRID_SIZE;
    const startY = Math.floor(bounds.min.y / GRID_SIZE) * GRID_SIZE;
    const endY = Math.ceil(bounds.max.y / GRID_SIZE) * GRID_SIZE;
    
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    
    // Vertical lines
    for (let x = startX; x <= endX; x += GRID_SIZE) {
      const screenX = x - bounds.min.x;
      ctx.beginPath();
      ctx.moveTo(screenX, 0);
      ctx.lineTo(screenX, this.render.canvas.height);
      ctx.stroke();
    }
    
    // Horizontal lines
    for (let y = startY; y <= endY; y += GRID_SIZE) {
      const screenY = y - bounds.min.y;
      ctx.beginPath();
      ctx.moveTo(0, screenY);
      ctx.lineTo(this.render.canvas.width, screenY);
      ctx.stroke();
    }
    
    ctx.globalAlpha = 1;
  }  private toggleGrid(): void {
    this.showGrid = !this.showGrid;  }  private spawnDemoShips(): void {
    console.log('🚀 spawnDemoShips called');    // Create complex player ship with multiple weapons (designed to face RIGHT, 0 degrees)
    const playerShip: EntityConfig[] = [
      // Core structure
      { type: 'Cockpit', x: 0, y: 0, rotation: 0 },
      { type: 'Hull', x: 0, y: -32, rotation: 0 },     // Above cockpit
      { type: 'Hull', x: 0, y: 32, rotation: 0 },      // Below cockpit
      { type: 'Hull', x: 32, y: 0, rotation: 0 },      // Right of cockpit (front)
      { type: 'Hull', x: -32, y: 0, rotation: 0 },     // Left of cockpit (rear)
      
      // Engines for propulsion (at the back - LEFT side since ship faces RIGHT)
      { type: 'Engine', x: -64, y: -32, rotation: 180 },  // Rear upper engine (pointing left for thrust)
      { type: 'Engine', x: -64, y: 32, rotation: 180 },   // Rear lower engine (pointing left for thrust)
      
      // Multiple weapon systems (all pointing RIGHT - forward direction)
      { type: 'Gun', x: 32, y: -32, rotation: 0 },     // Upper right gun
      { type: 'Gun', x: 32, y: 32, rotation: 0 },      // Lower right gun
      { type: 'Gun', x: 64, y: 0, rotation: 0 },       // Front center gun
      { type: 'Gun', x: 0, y: -64, rotation: 0 },      // Top gun
      { type: 'Gun', x: 0, y: 64, rotation: 0 },       // Bottom gun
      
      // Power systems
      { type: 'PowerCell', x: -32, y: -32, rotation: 0 },
      { type: 'PowerCell', x: -32, y: 32, rotation: 0 },
      
      // Additional hull for structure
      { type: 'Hull', x: 32, y: -64, rotation: 0 },
      { type: 'Hull', x: 32, y: 64, rotation: 0 },
      { type: 'Hull', x: -64, y: 0, rotation: 0 }
    ];
    
    const screenCenterX = this.render.canvas.width / 2;
    const screenCenterY = this.render.canvas.height / 2;
    
    const playerAssembly = new Assembly(playerShip, { x: screenCenterX, y: screenCenterY });
    this.assemblies.push(playerAssembly);
    Matter.World.add(this.world, playerAssembly.rootBody);
    this.playerAssembly = playerAssembly;
    playerAssembly.isPlayerControlled = true;// Create longer target ships with more parts for better breaking demonstration
    const targetShip: EntityConfig[] = [
      { type: 'Cockpit', x: 0, y: 0, rotation: 0, health: 30 },
      { type: 'Hull', x: -32, y: 0, rotation: 0, health: 25 },
      { type: 'Hull', x: -64, y: 0, rotation: 0, health: 25 },
      { type: 'Hull', x: 32, y: 0, rotation: 0, health: 25 },
      { type: 'Hull', x: 64, y: 0, rotation: 0, health: 25 },
      { type: 'Engine', x: -96, y: 0, rotation: 270, health: 20 },
      { type: 'Engine', x: 96, y: 0, rotation: 90, health: 20 },
      { type: 'Gun', x: 0, y: -32, rotation: 0, health: 15 },
      { type: 'Gun', x: 0, y: 32, rotation: 180, health: 15 }
    ];
    
    // Spawn targets around the player
    const targets = [
      { x: screenCenterX - 200, y: screenCenterY - 100 },
      { x: screenCenterX + 200, y: screenCenterY - 100 },
      { x: screenCenterX - 200, y: screenCenterY + 150 },
      { x: screenCenterX + 200, y: screenCenterY + 150 }
    ];
    
    targets.forEach(pos => {
      const assembly = new Assembly(targetShip, pos);
      this.assemblies.push(assembly);
      Matter.World.add(this.world, assembly.rootBody);
    });
    
    console.log(`✅ Created ${this.assemblies.length} ships`);
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
      console.error('❌ Error spawning ship:', error);    }
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
    Matter.World.add(this.world, this.mouseConstraint);    // Track mouse position for camera and targeting
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
  }
  private handleLeftClick(event: MouseEvent): void {
    // Fire weapons towards mouse position
    if (this.playerAssembly && !this.playerAssembly.destroyed) {
      const rect = this.render.canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left + this.render.bounds.min.x;
      const mouseY = event.clientY - rect.top + this.render.bounds.min.y;
      
      // Calculate angle from player to mouse
      const playerPos = this.playerAssembly.rootBody.position;
      const angle = Math.atan2(mouseY - playerPos.y, mouseX - playerPos.x);
      
      // Fire weapons in that direction using the new target angle parameter
      const newBullets = this.playerAssembly.fireWeapons(angle);
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
  }
}
