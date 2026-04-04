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

## FloatingPanel

`FloatingPanel.tsx` — generic draggable, resizable, localStorage-persistent panel. Use this for any always-on HUD panel that the user might want to reposition.

**Props:**
- `storageKey: string` — unique ID; saved as `eqx-panel-<key>` in localStorage
- `title: string` — shown in the drag bar
- `defaultPos?: { x, y }` — first-launch position. **Choose carefully to avoid fixed UI** (see below).
- `defaultSize?: { w, h }` — first-launch size (default 220×360)
- `minWidth?: number`, `minHeight?: number` — resize floor (defaults 160×120)
- `children` — scrollable panel content

**Fixed UI footprint** to avoid when choosing `defaultPos`:
| Element | Approximate area |
|---|---|
| MiniDrawer | x 0–60 |
| ObjectivesPanel (sector conquest) | x 68–330, y 16–220 |
| WaveInfoPanel (sector conquest) | right 16–270, y 16–110 |
| ModeToggle | bottom-center |
| ShipActionPanel / FlightControls | bottom 0–80 |

Recommended safe defaults: `{ x: 72, y: 230 }` (below ObjectivesPanel, right of sidebar); for modes without ObjectivesPanel use `{ x: 72, y: 80 }`.

**Persistence:** position and size are written to localStorage on every mouse-up (drag or resize end). Invalid/missing saved state silently falls back to defaults. Position is clamped to the current viewport on mount so panels are never off-screen after a window resize.

**Pattern:** wrap panel content in `<FloatingPanel ...>`. The children render inside a scrollable flex column; no internal layout wrappers needed.

## GenericModal

- Reusable draggable, resizable modal component (`GenericModal.tsx`).
- Props: `title`, `open`, `onClose`, `onOk?`, `showOkCancel?`, `okLabel?`, `cancelLabel?`, `initialWidth?`, `initialHeight?`, `children`.
- Drag via title bar, resize via bottom-right handle.
- Dark themed, fixed z-index 2000.

## Ship Builder UI

- `ShipBuilderPanel.tsx` — left sidebar palette offset by `MINI_DRAWER_CLOSED_WIDTH` (52 px) to avoid overlapping MiniDrawer. Footer has Save (floppy) + Load (folder) icon buttons.
- `ShipLibraryModal.tsx` — MUI Dialog (not GenericModal) for ship library CRUD. Table columns: Name, Blocks, Mass, Engines, Weapons, Created, Updated. Toolbar: Create | Edit | Delete. Create opens an inline name-input sub-dialog; Delete opens an inline confirm sub-dialog; Edit calls `onEditShip(record)` and closes.
- **BuilderSession state** (in ShipBuilderPanel): `{ name, savedId, isFromExisting, saveResolution }`. Save button:
  - No session → opens library modal.
  - Session + not from existing + no savedId → creates new record via `shipLibraryService.create()`.
  - Session + not from existing + has savedId → updates existing record.
  - Session + from existing + saveResolution='none' → opens overwrite/copy dialog.
  - After overwrite/copy choice → saves directly on subsequent clicks.
- Built-in ships (`isBuiltIn: true`) can be loaded for editing but save always creates a copy (they have no user-editable record to overwrite).
- `GameEngine.showSuccess(msg)` / `showError(msg)` — public wrappers for `ToastSystem` used by UI code.

## World-Space Overlay System

A generic mechanism for attaching action buttons to world-space entities that track camera movement with zero React re-render overhead for position.

### `useWorldOverlay` hook (`useWorldOverlay.ts`)
- Accepts `gameEngine` and a stable `getAnchor` callback.
- `getAnchor` is called **every rAF tick** and returns `{ wx, wy }` (world-space top-left of the target's bounding box) or `null` to hide.
- Imperatively updates `left`, `top`, `gap`, and `visibility` on the returned `containerRef` DOM element.
- Hidden below `MIN_OVERLAY_SCALE` (0.3) or when anchor is null / offscreen.
- Use a `useRef` to keep `getAnchor` stable; read store state with `useGameStore.getState()` inside the callback to avoid closure staleness without restarting the effect.

### `WorldOverlayPanel` component (`WorldOverlayPanel.tsx`)
- Wraps `useWorldOverlay` and renders a horizontal row of `OverlayButton` entries.
- Exports the `OverlayButton` interface: `{ key, icon, tooltip, onClick, color?, disabled? }`.
- Button size scales with `viewportScale` from the store (same formula as the hook's imperative sizing).
- `color` prop: when set, uses dark background + colored border (same visual language as `StructureActionPanel`).

### `StructureActionPanel.tsx`
- Refactored to use `WorldOverlayPanel` — no longer manages its own RAF loop or DOM manipulation.
- Retains modal state management (CargoModal, GenericModal/Settings).
- `getAnchor` reads `useGameStore.getState().selectedStructure` directly so it is a stable `useCallback` with no deps.

### `AssemblyOverlayPanel.tsx`
- World-space Pilot / Disable AI / Enable AI buttons above the selected friendly ship.
- Only rendered for team-0 assemblies that are not currently being piloted.
- Anchor = `assembly.rootBody.position ± assembly.getBoundingRadius()` (bounding-box top-left).
- Buttons call `gameEngine.pilotAssembly()`, `disableAI()`, `enableAI()` via `getSelectedAssembly()`.

### `ShipActionPanel.tsx`
- Simplified: ship name + health bar only (no action buttons — those moved to `AssemblyOverlayPanel`).
- `pointerEvents: 'none'` (read-only HUD; the world-space panel handles interaction).
- `CargoModal.tsx` — shows structure inventory in an MUI Table inside GenericModal.
- Settings modal is currently a placeholder for future per-type configuration.

## Removed Components (deprecated)

- `Radar.tsx`, `LockedTargets.tsx`, `PowerManagement.tsx` — removed during UI refactor.
- `PowerSystem` singleton — removed. Player ships now use the same `computeAIWeaponPowerEfficiency()` as AI ships; engines always operate at full efficiency.

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
