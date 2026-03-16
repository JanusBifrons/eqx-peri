# /src — Source Root

Entry points and top-level layer boundaries.

## Entry Points

| File | Role |
|------|------|
| `main.tsx` | React app mount; calls `ReactDOM.createRoot` on `#root` |
| `App.tsx` | Root component; owns `GameEngine` instance, `ThemeProvider`, and top-level routing (menu ↔ game) |

## Layer Rules

```
ui/         React components — read-only observers of game state
game/       All game logic — framework-agnostic, no React imports
types/      Shared interfaces/enums/constants — no runtime logic
data/       Static JSON assets (ships.json)
```

- `ui/` may import from `game/` and `types/`. The reverse is forbidden.
- `game/` subdirectories may import from `types/` and `data/`. They may **not** import from `ui/`.
- Circular imports between `game/core/`, `game/ai/`, `game/weapons/`, `game/systems/`, and `game/rendering/` are forbidden — `game/core/GameEngine` is the only file that wires them together.

## Global Theme

`App.tsx` wraps the entire tree in a MUI dark `ThemeProvider`. Do not re-declare themes or override the palette in child components.

---

MAINTENANCE MANDATE: If you add a new top-level `src/` subdirectory, update the layer table above and create a `CLAUDE.md` in that directory.
