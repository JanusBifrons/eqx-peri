# /src/types — Shared TypeScript Definitions

Central location for interfaces, enums, and constants shared across both `/game` and `/components`. Nothing in this directory should contain runtime logic.

## Rules

**What belongs here:**
- Interfaces and types used by more than one file across different subdirectories
- Enums that define fixed value sets (`EntityType`, `MissileType`, `AIBehavior`, etc.)
- Shared constants (e.g. `GRID_SIZE`) that both game logic and UI need

**What does NOT belong here:**
- Types used only within a single file — define those locally
- Classes or functions with any runtime logic — those go in `/game`
- React prop types — define those inline in the component file

**Conventions:**
- Primary file is `GameTypes.ts`; keep it as the single source of truth for core game types
- Do not split types arbitrarily across multiple files — only create a new types file if there is a clear, distinct domain (e.g. a future networking layer)
- `GameTypes_new.ts` is a transitional file — any stable types in it should be migrated to `GameTypes.ts` and the file removed
- Enums over string literals for values that appear in `switch` statements or need exhaustiveness checking
- Prefer `interface` over `type` alias for object shapes; use `type` for unions and mapped types

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
