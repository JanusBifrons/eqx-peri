# /src/game/rendering — PixiJS Renderer Classes

One renderer per visual concern. All renderers implement `IRenderer` and are registered with `RenderSystem` in `GameEngine.setupRenderSystem()`.

## IRenderer Contract

```ts
interface IRenderer {
  readonly renderPriority: number;
  readonly renderSpace?: 'world' | 'screen';  // defaults to 'screen'
  init(stage: PIXI.Container): void;   // Called once on registration — create PIXI objects here
  render(viewport: Viewport, timestamp: number): void; // Called every frame
  dispose?(): void;
}
```

- Create persistent `PIXI.Graphics` / `PIXI.Text` / `PIXI.Sprite` objects in `init()`.
- Clear and redraw them every frame in `render()`.
- **No Canvas 2D context** — all drawing goes through PIXI.

## World-Space vs Screen-Space Rendering

`RenderSystem` maintains two child containers on `app.stage`:
1. **`WorldContainer`** (`src/game/rendering/WorldContainer.ts`) — extends `PIXI.Container`, calls `syncWithBounds()` each frame to set `scale` and `position` from `Matter.Render.bounds`. Children draw in **world coordinates**; the PIXI scene graph handles the world-to-screen transform automatically.
2. **`screenContainer`** — plain `PIXI.Container` for renderers that draw in screen pixels.

**Renderer routing**: `RenderSystem.register()` reads `renderer.renderSpace` and adds the renderer's PIXI objects to the appropriate container. Defaults to `'screen'` for backwards compatibility.

**World-space renderers** (`renderSpace = 'world'`): GridRenderer, ConnectionRenderer, BlockBodyRenderer, ParticleRenderer, MissileRenderer, BlockFrillsRenderer, ShieldRenderer, HarpoonRenderer, BeamRenderer, OrderRenderer, EngagementRenderer, PathfindingDebugRenderer, StructurePlacementRenderer. These draw at world positions directly — no `viewport.worldToScreen()` calls.

**Screen-space renderers** (default): StarfieldRenderer, StructureRenderer, ShipHighlightRenderer, StrategicIconRenderer, AimingDebugRenderer, RingRadarRenderer, BlockPickupRenderer, ShockwaveRenderer.

### World-Space Patterns

**Line width compensation**: world-unit line widths become sub-pixel when zoomed out. Use `Math.max(minScreenPx / scale, worldUnitWidth)` to ensure minimum visibility. Example: `Math.max(1 / scale, 2.5)`.

**Filter zoom compensation**: PIXI filters (BlurFilter, GlowFilter, AdvancedBloomFilter) operate in local coordinate space. Inside WorldContainer, filter effects scale with zoom. Compensate by dividing parameters by `scale` each frame. `GlowFilter.distance` is immutable after construction — adjust `outerStrength` instead.

**Circle/dot sizes**: use `radius / scale` for elements that should remain constant screen-pixel size (e.g. order dots), or plain world-unit radius for elements that should scale with zoom (e.g. shield bubbles).

## Viewport

`Viewport` wraps a `Matter.Bounds` + the PIXI canvas. Still used by screen-space renderers and for `scale` access.
- `viewport.worldToScreen(wx, wy)` → `{ x, y }` in screen pixels (screen-space renderers only)
- `viewport.scale` → pixels per world unit (used by both world and screen renderers for compensation math)

## Renderer Priority Table

| Priority | Renderer | Space | Visual concern |
|----------|----------|-------|----------------|
| 5  | `StarfieldRenderer` | screen | Infinitely tiling parallax star field (4 depth layers) |
| 10 | `GridRenderer` | world | Background grid lines |
| 13 | `ConnectionRenderer` | world | Network connection lines between structures (flash on transfer) |
| 15 | `StructureRenderer` | screen | Structure bodies, icons, progress bars, power/storage readouts |
| 20 | `BlockBodyRenderer` | world | Block bodies with glow; bullets/missiles without glow |
| 21 | `StrategicIconRenderer` | screen | Diamond/circle icons for objects too small to render at zoom |
| 22 | `ParticleRenderer` | world | Drives `ParticleSystem` thrust puffs per engine each frame |
| 23 | `MissileRenderer` | world | Missile bodies as elongated arrows with thrust trails; color by variant |
| 30 | `BlockFrillsRenderer` | world | Decorative edge frills on blocks |
| 40 | `ShieldRenderer` | world | Shield gradient ring + collapse flash |
| 44 | `HarpoonRenderer` | world | In-flight harpoon darts + animated tether lines between connected assemblies |
| 45 | `BeamRenderer` | world | Continuous beam visuals (glow + core line + impact flash); tractor beam (green) |
| 46 | `ShockwaveRenderer` | screen | Expanding ring when an assembly is fully destroyed |
| 50 | `ShipHighlightRenderer` | screen | Hover/selected bounding boxes, lock-on brackets |
| 52 | `OrderRenderer` | world | AI move order lines (green line + dots from cockpit to target) |
| 53 | `EngagementRenderer` | world | Red line from selected AI ship to its combat target |
| 55 | `RingRadarRenderer` | screen | Ring radar directional arrows |
| 60 | `AimingDebugRenderer` | screen | Weapon arc, distance rings, aim line |
| 70 | `BlockPickupRenderer` | screen | Block pickup ghost and snap overlay |
| 71 | `StructurePlacementRenderer` | world | Structure placement hologram + connection preview lines |

## Rules & Patterns

**Data injection** — each renderer receives only what it needs via getter closures passed in its constructor. No renderer holds a reference to `GameEngine`.

**Visual data contract** — `Entity.body.render.fillStyle`, `strokeStyle`, and `lineWidth` are written by `Entity.updateFlash()` / `Entity.updateVisualState()` and read by `BlockBodyRenderer`. Do not bypass this; write to entity state, not directly to PIXI objects.

**Compound bodies** — iterate `body.parts[1..N]` (skip index 0, the compound root) to get each part's vertex array.

**Text pooling** — `ShipHighlightRenderer` and `AimingDebugRenderer` keep a pool of `PIXI.Text` objects and toggle `visible` rather than creating/destroying per frame, avoiding GPU texture upload churn.

**Rotated rectangles** — `BlockPickupRenderer` uses a module-level `drawRotatedRect(gfx, cx, cy, w, h, angle)` helper (manually computes corners) because PIXI v7 Graphics has no transform stack equivalent.

**Radial gradients** — `ShieldRenderer` approximates them with concentric `drawCircle()` calls at decreasing alpha.

**Dashed lines** — approximated as short solid semi-transparent line segments (PIXI v7 has no native dash support).

**`PIXI.BLEND_MODES.ADD`** — used by `ParticleSystem`'s `ParticleContainer` and `ShockwaveRenderer` for additive glow blending.

**`pixi-filters@5`** — active filters: `CRTFilter` (per-structure readout panels in `StructureRenderer`, one filter instance per structure), `GlowFilter` + `AdvancedBloomFilter` (beam glow in `BeamRenderer`), `ShockwaveFilter` (destruction rings in `ShockwaveRenderer`).

**Sensor area rendering** — `StructureRenderer.renderSensorAreas()` draws dashed circles + status text for Refinery deposit zones. `StructurePlacementRenderer` previews sensor radius when placing structures with `sensorRadius`.

## Import Paths

From files in this directory:
- `../core/Assembly` (and `../core/Entity`)
- `../../types/GameTypes`

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
