# /src/ui — React UI Components

HUD overlay components rendered on top of the game canvas. Components receive `gameEngine: GameEngine | null` (or derived state) as props and poll it via `useEffect` intervals to sync UI with game state.

## Component Rules

**Structure:**
- One component per file; export as default
- Define a `Props` interface directly above the component function
- Use `React.FC<Props>` for the component type signature
- Styled subcomponents (via MUI `styled()`) go at the top of the file, above the component

**Props & State:**
- Accept `gameEngine: GameEngine | null` and guard against null before reading game state
- Use `useState` for local UI state; do NOT store game engine objects in React state
- Use `useRef` only for DOM/canvas references
- Poll game engine with `setInterval` inside `useEffect`; always return a cleanup that clears the interval

**Styling:**
- Use MUI `styled(Box)` / `styled(Paper)` for layout containers — do not use inline `sx` for structural styles
- Colour palette: primary cyan `#00ccff`, status green `#00ff00`, warning amber (MUI default), danger red (MUI default)
- All panels use `position: 'absolute'` with fixed pixel offsets; document corner placement in a comment (e.g. `// bottom-left HUD panel`)
- Dark theme is applied globally via `ThemeProvider` in `App.tsx` — do not re-declare themes per component

**Icons:**
- Source icons exclusively from `@mui/icons-material`

**Imports:**
- Import `GameEngine` from `../game/core/GameEngine`
- Import `Assembly` from `../game/core/Assembly`

## Anti-Patterns to Avoid

- Do not manipulate game engine state from a component — components are read-only observers
- Do not import from `../game/` deeply-nested internals; access game state through `GameEngine`'s public interface
- Do not use CSS files or inline `style={{}}` props — use MUI `styled()` or `sx` prop consistently

## Navigation: MiniDrawer

- `MiniDrawer.tsx` — persistent MUI Mini Variant Drawer on the left side of the screen.
- Toggle: hamburger icon at top switches between collapsed (icons only, 52px) and expanded (icons + text labels, 180px).
- **Top section** (gameplay actions): Research, Builder, Crew — currently placeholders.
- **Bottom section** (system actions): Settings (opens SettingsPanel dialog), Exit (opens return-to-menu confirm dialog). Separated from gameplay actions by a MUI Divider.
- Props: `visible`, `onSettingsClick`, `onExitClick`.

## Settings Panel

- `SettingsPanel.tsx` — MUI Dialog with General/Audio/Debug tabs. No longer has its own gear button; opened externally via `open`/`onOpenChange` props (controlled by App.tsx, triggered from MiniDrawer).
- General tab: Physics Debug, Performance Bar toggles.
- Audio tab: Music enable, Master/Music/SFX volume sliders with live preview.
- Debug tab: Spawn scrap/enemies, ship spawner with team toggle.

## Select / Build Mode Toggle

- `ModeToggle.tsx` — MUI ToggleButtonGroup positioned at bottom-center.
- Two modes: **Select** (camera pan, ship selection, piloting) and **Build** (block drag, structure placement, construction).
- State: `interactionMode` in `gameStore` (`'select' | 'build'`).
- In select mode: `BlockPickupSystem.tryPickUp()` and `StructurePlacementSystem.handleClick()` are skipped by `GameEngine`'s mouse handlers. Cursor shows pointer instead of grab for loose blocks.
- In build mode: StructuresPanel is shown, block drag/snap/detach work normally.
- Switching to select cancels any active structure placement.

## GenericModal

- Reusable draggable, resizable modal component (`GenericModal.tsx`).
- Props: `title`, `open`, `onClose`, `onOk?`, `showOkCancel?`, `okLabel?`, `cancelLabel?`, `initialWidth?`, `initialHeight?`, `children`.
- Drag via title bar, resize via bottom-right handle.
- Dark themed, fixed z-index 2000.

## Structure Action Panel

- `StructureActionPanel.tsx` — world-space-tracking MUI icon buttons shown when a structure is selected.
- Polls `gameEngine.getSelectedStructure()` at ~30fps; uses `gameEngine.worldToScreen()` to position buttons.
- Buttons scale with viewport zoom level (world-space feel).
- Generic actions: Deconstruct, Power toggle, Open Cargo, Settings/Drill-down.
- `CargoModal.tsx` — shows structure inventory in an MUI Table inside GenericModal.
- Settings modal is currently a placeholder for future per-type configuration.

## Removed Components (deprecated)

- `Radar.tsx`, `LockedTargets.tsx`, `PowerManagement.tsx` — removed during UI refactor.
- `PowerSystem` singleton — removed. Player ships now use the same `computeAIWeaponPowerEfficiency()` as AI ships; engines always operate at full efficiency.

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
