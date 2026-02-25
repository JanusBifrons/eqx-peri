# EQX Peri

A 2D space combat game built with React, TypeScript, and Matter.js physics. Ships are assembled from modular block components; players and AI fight in zero-gravity environments with missiles, guns, and power management.

## Commands

```bash
npm run dev        # Start Vite dev server (http://localhost:5173)
npm run build      # Type-check + production build
npm run lint       # ESLint (zero warnings enforced)
npm run preview    # Preview production build
node test-<name>.js  # Run individual physics/logic test scripts
```

## Project Structure

```
src/
  components/   # React UI overlay (HUD, radar, power management)
  game/         # Core game engine, physics systems, AI
  types/        # Shared TypeScript interfaces and enums
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

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
