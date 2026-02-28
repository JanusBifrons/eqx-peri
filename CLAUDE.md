# EQX Peri

A 2D space combat game built with React, TypeScript, and Matter.js physics. Ships are assembled from modular block components; players and AI fight in zero-gravity environments with missiles, guns, and power management.

## Commands

```bash
npm run dev        # Start Vite dev server (http://localhost:5173)
npm run build      # Type-check + production build
npm run lint       # ESLint (zero warnings enforced)
npm run preview    # Preview production build
node scripts/<name>.js  # Run individual physics/logic test scripts
```

## Project Structure

```
scripts/        # Node.js test/debug scripts (node scripts/<name>.js)
src/
  ui/           # React UI overlay (HUD, radar, power management)
  game/
    core/       # Fundamental physics objects: GameEngine, Assembly, Entity
    ai/         # Control & decision-making: AIController, FlightController, ControllerManager, Controller
    weapons/    # Missile and MissileSystem
    ship/       # Ship design: BlockSystem, ShipDesigner, ShipDesignManager
    systems/    # Singletons & services: PowerSystem, ToastSystem, BlockPickupSystem
  types/        # Shared TypeScript interfaces and enums (GameTypes.ts)
  data/         # Ship definitions (ships.json)
```

## Universal Coding Standards

**Naming:**
- Classes and interfaces: `PascalCase`
- Functions and variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Files: `PascalCase.ts` for classes, `camelCase.ts` for utilities, `PascalCase.tsx` for components

**TypeScript:**
- Strict mode is enforced — no `any`, no unused locals/parameters
- Define interfaces for all prop types and config objects
- Use `resolveJsonModule` for JSON imports (already configured)

**Git Commits:**
- Format: `<type>: <short imperative description>` (e.g. `fix: correct missile thrust scaling`)
- Types: `feat`, `fix`, `refactor`, `chore`, `docs`
- Keep subject line under 72 characters; no period at end

**General:**
- One class per `.ts` file
- No magic numbers — extract to named constants
- Prefer explicit return types on exported functions

**Ship coordinates (`ships.json`):**
- Ships face **east (right)** by default. X = forward (nose → tail); Y = lateral (wingspan).
- "Width" of a ship = its Y extent in grid units, not its part count.
- `applyThrust` takes **ship-local** input. World-space vectors must be rotated by `−shipAngle` first.

**Block pickup / assembly building (`BlockPickupSystem`):**
- Lives in `src/game/systems/BlockPickupSystem.ts`; instantiated by `GameEngine` (not a singleton).
- `GameEngine.removeBodyWithParts` is **public** — required so BlockPickupSystem can remove a picked-up assembly's compound body and all its part bodies from the physics world in one call.
- `Assembly.attachExternalAssembly(source, newLocalOffsets)` merges a source assembly's entities into the receiver at the caller-supplied grid offsets, then calls `buildConnectionGraph()` + `createFreshBody()`.  The source assembly is discarded after this call.
- `ScenarioConfig.sandboxMode: boolean` — when true, `GameEngine.initializeBattle` calls `spawnSandboxScenario` instead of the normal team-spawn path (player gets a bare Cockpit; loose blocks are scattered nearby).
- Snap detection uses player-local `localOffset` arithmetic, not world positions, so it is rotation-independent.

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
