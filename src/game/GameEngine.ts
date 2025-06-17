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
  constructor(container: HTMLElement) {
    console.log('🎮 Creating GameEngine...');
    
    // Create engine
    this.engine = Matter.Engine.create();
    this.world = this.engine.world;
    this.runner = Matter.Runner.create();
    console.log('⚙️  Matter.js engine created');    // Configure engine
    this.engine.world.gravity.y = 0; // No gravity in space

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
    
    // Render grid if enabled
    if (this.showGrid) {
      this.renderGrid();
    }
    
    // Continue loop
    requestAnimationFrame(() => this.gameLoop());
  }

  private handleInput(): void {
    if (!this.playerAssembly || this.playerAssembly.destroyed) return;
      // Thrust
    if (this.keys.has('w') || this.keys.has('arrowup')) {
      const angle = this.playerAssembly.rootBody.angle;
      const thrust = {
        x: Math.cos(angle) * 0.003, // Increased from 0.001 to 0.003
        y: Math.sin(angle) * 0.003
      };
      this.playerAssembly.applyThrust(thrust);
    }
    
    // Reverse thrust
    if (this.keys.has('s') || this.keys.has('arrowdown')) {
      const angle = this.playerAssembly.rootBody.angle;
      const thrust = {
        x: Math.cos(angle) * -0.0015, // Increased from -0.0005 to -0.0015
        y: Math.sin(angle) * -0.0015
      };
      this.playerAssembly.applyThrust(thrust);
    }
      // Rotation
    if (this.keys.has('a') || this.keys.has('arrowleft')) {
      this.playerAssembly.applyTorque(-0.15); // Increased from -0.1 to -0.15
    }
    if (this.keys.has('d') || this.keys.has('arrowright')) {
      this.playerAssembly.applyTorque(0.15); // Increased from 0.1 to 0.15
    }// Firing
    if (this.keys.has(' ')) {
      const newBullets = this.playerAssembly.fireWeapons();
      newBullets.forEach(bullet => {
        Matter.World.add(this.world, bullet);
        this.bullets.push(bullet);
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
}
