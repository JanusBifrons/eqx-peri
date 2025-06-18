# EQX Peri - Space Shooter Game

A single-player, top-down 2D space shooter built with TypeScript, React, PixiJS, and Matter.js physics.

## Game Features

- **Modular Ship Design**: Ships are built from individual entities (cockpit, engines, weapons, armor)
- **Realistic Physics**: Each entity has its own Matter.js body with proper mass and inertia
- **Destructible Ships**: Destroying parts can split ships into multiple assemblies
- **Grid-Based Building**: 32x32 pixel grid system for precise entity placement
- **Projectile System**: Weapons fire projectiles with collision detection

## Controls

### Movement
- **W / Arrow Up**: Thrust forward
- **S / Arrow Down**: Thrust backward  
- **A / Arrow Left**: Rotate left
- **D / Arrow Right**: Rotate right
- **Space**: Fire weapons

### Debug Controls
- **G**: Toggle grid overlay
- **1**: Spawn fighter ship
- **2**: Spawn cruiser ship
- **3**: Spawn debris block

## Architecture

### Entity System
- **Entity**: Individual ship components (32x32 grid-based)
- **Assembly**: Collection of connected entities forming a ship
- **Matter.js Integration**: Each entity has its own physics body

### Entity Types
- **Cockpit**: Required for player control
- **Engine**: Provides thrust
- **Weapon**: Fires projectiles
- **Armor**: Structural protection
- **Power Cell**: Energy storage (explodes when destroyed)
- **Structural**: Basic building blocks

### Ship Configuration
Ships are defined in JSON format in `src/data/ships.json`. Each ship template contains:
- Entity definitions with position, size, mass, and type
- Visual properties (color, custom vertices)
- Physics properties

## Development

### Prerequisites
- Node.js 16+
- npm

### Setup
```bash
npm install
npm run dev
```

### Building
```bash
npm run build
```

## Technical Details

- **Rendering**: PixiJS for hardware-accelerated 2D graphics
- **Physics**: Matter.js for realistic collision detection and dynamics
- **Architecture**: Object-oriented design with clear separation of concerns
- **TypeScript**: Full type safety throughout the codebase

## MVP Goals ✅

- [x] Functional game canvas with PixiJS + Matter.js sync
- [x] Ships defined via JSON with polygon rendering and physics
- [x] Keyboard-controlled cockpit logic with movement and firing
- [x] Destruction mechanics that split ships into assemblies
- [x] Test debris and multiple ship types
- [x] Debug overlays and grid system

## Future Features

- Mouse-based ship construction and part attachment
- Damage states and weapon variations
- Power system gameplay (capacitor drain, overloads)
- Background sector loading for large-scale worlds
- AI-controlled ships
- Particle effects and visual polish

## Enhanced Cockpit Survival System
- **10x Health**: All cockpit types have significantly increased health for survival
- **High Thrust-to-Weight**: Cockpits can outrun and outmaneuver most ships when separated
- **Built-in Weapon**: Cockpits can fire when nothing is connected on their top/north side
- **Built-in Engine**: Cockpits can provide thrust when nothing is connected on their bottom/south side
- **Visual Indicators**: Cockpits flash different colors when using built-in systems
- **Attachment Point System**: Robust connection detection using precise attachment points instead of distance

### Cockpit Specifications
- **Standard Cockpit**: 1000 HP, 4.0 thrust, excellent escape capability
- **Large Cockpit**: 2500 HP, 16.0 thrust, superior maneuverability  
- **Capital Core**: 10000 HP, 64.0 thrust, massive survival capability