# /src/game/rendering — PixiJS Renderer Classes

One renderer per visual concern. All renderers implement `IRenderer` and are registered with `RenderSystem` in `GameEngine.setupRenderSystem()`.

## IRenderer Contract

```ts
interface IRenderer {
  readonly renderPriority: number;
  init(stage: PIXI.Container): void;   // Called once on registration — create PIXI objects here
  render(viewport: Viewport, timestamp: number): void; // Called every frame
  dispose?(): void;
}
```

- Create persistent `PIXI.Graphics` / `PIXI.Text` / `PIXI.Sprite` objects in `init()`.
- Clear and redraw them every frame in `render()`.
- **No Canvas 2D context** — all drawing goes through PIXI.

## Viewport

`Viewport` wraps a `Matter.Bounds` + the PIXI canvas. Key API:
- `viewport.worldToScreen(wx, wy)` → `{ x, y }` in screen pixels
- `viewport.scale` → pixels per world unit (use for size scaling)

## Renderer Priority Table

| Priority | Renderer | Visual concern |
|----------|----------|----------------|
| 5  | `StarfieldRenderer` | Infinitely tiling parallax star field (4 depth layers) |
| 10 | `GridRenderer` | Background grid lines |
| 13 | `ConnectionRenderer` | Network connection lines between structures (flash on transfer) |
| 15 | `StructureRenderer` | Structure bodies, icons, progress bars, world-space power/storage readouts, deconstruction visuals |
| 20 | `BlockBodyRenderer` | Block bodies with glow; bullets/missiles without glow |
| 21 | `StrategicIconRenderer` | Diamond/circle icons for objects too small to render at zoom; greedy group-badge clustering |
| 22 | `ParticleRenderer` | Drives `ParticleSystem` thrust puffs per engine each frame |
| 30 | `BlockFrillsRenderer` | Decorative edge frills on blocks |
| 40 | `ShieldRenderer` | Shield gradient ring + collapse flash |
| 45 | `BeamRenderer` | Continuous beam visuals (glow + core line + impact flash) |
| 46 | `ShockwaveRenderer` | Expanding ring when an assembly is fully destroyed |
| 50 | `ShipHighlightRenderer` | Hover/selected bounding boxes, lock-on brackets |
| 60 | `AimingDebugRenderer` | Weapon arc, distance rings, aim line |
| 70 | `BlockPickupRenderer` | Block pickup ghost and snap overlay |
| 71 | `StructurePlacementRenderer` | Structure placement hologram + connection preview lines |

## Rules & Patterns

**Data injection** — each renderer receives only what it needs via getter closures passed in its constructor. No renderer holds a reference to `GameEngine`.

**Visual data contract** — `Entity.body.render.fillStyle`, `strokeStyle`, and `lineWidth` are written by `Entity.updateFlash()` / `Entity.updateVisualState()` and read by `BlockBodyRenderer`. Do not bypass this; write to entity state, not directly to PIXI objects.

**Compound bodies** — iterate `body.parts[1..N]` (skip index 0, the compound root) to get each part's vertex array.

**Text pooling** — `ShipHighlightRenderer` and `AimingDebugRenderer` keep a pool of `PIXI.Text` objects and toggle `visible` rather than creating/destroying per frame, avoiding GPU texture upload churn.

**Rotated rectangles** — `BlockPickupRenderer` uses a module-level `drawRotatedRect(gfx, cx, cy, w, h, angle)` helper (manually computes corners) because PIXI v7 Graphics has no transform stack equivalent.

**Radial gradients** — `ShieldRenderer` approximates them with concentric `drawCircle()` calls at decreasing alpha.

**Dashed lines** — approximated as short solid semi-transparent line segments (PIXI v7 has no native dash support).

**`PIXI.BLEND_MODES.ADD`** — used by `ParticleSystem`'s `ParticleContainer` and `ShockwaveRenderer` for additive glow blending.

**`pixi-filters@5`** is installed but no filters are currently active.

## Import Paths

From files in this directory:
- `../core/Assembly` (and `../core/Entity`)
- `../../types/GameTypes`

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
