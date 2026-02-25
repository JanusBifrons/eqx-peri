# /src/components — React UI Components

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

## Anti-Patterns to Avoid

- Do not manipulate game engine state from a component — components are read-only observers
- Do not import from `../game/` deeply-nested internals; access game state through `GameEngine`'s public interface
- Do not use CSS files or inline `style={{}}` props — use MUI `styled()` or `sx` prop consistently

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
