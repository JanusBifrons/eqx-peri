# /src/game/systems — Singletons & Support Services

Cross-cutting runtime systems that are not pure game-logic (physics, AI, weapons) but are needed by many parts of the engine. Most are singletons or long-lived objects instantiated by `GameEngine`.

## Systems Overview

| System | Pattern | Accessed via |
|--------|---------|--------------|
| `SoundSystem` | Singleton | `SoundSystem.getInstance()` |
| `ToastSystem` | Instance | `GameEngine.toastSystem` |
| `ParticleSystem` | Instance | `GameEngine.particleSystem` |
| `BlockPickupSystem` | Instance | `GameEngine` (internal) |
| `AsteroidFieldSystem` | Instance | `GameEngine` (conditional) |
| `StructurePlacementSystem` | Instance | `GameEngine` (conditional, structures sandbox only) |

Do not create additional singletons without documenting them here and in `/src/game/CLAUDE.md`.

---

## SoundSystem

Procedural SFX via Web Audio API + background music via **Howler** (`howler` package). Must be initialised after a user gesture — call `init()` once.

- SFX: `playLaserFire()`, `playImpact()`, `playExplosion()`, `playBeamFire()` — each synthesises a short Web Audio buffer.
- Music: `playBackgroundMusic()` / `stopMusic()` — streamed via Howler's own AudioContext (separate from the SFX chain).
- Beam sound throttle: `lastBeamFireSoundAt` prevents a new buffer every physics tick (~60 fps).
- Volume levels controlled via `SoundSettings` (`masterVolume`, `musicVolume`, `sfxVolume`).

---

## ToastSystem

Lightweight in-game notification queue. Instantiated by `GameEngine`; accessed via `gameEngine.toastSystem`.

- `showToast(message, duration?)` — queues a notification for the HUD.
- `getToasts()` — polled by the `ToastNotification` UI component.

---

## ParticleSystem

Manages all in-game particle effects through a single `PIXI.ParticleContainer` (additive blend).

- Pool of `MAX_PARTICLES = 5000` sprites; O(1) acquire/release via free/active lists.
- Texture atlas (64×16 canvas, four 16×16 frames): circle, diamond, streak, triangle — all from one `BaseTexture`, batched into a single draw call.
- **Public emitters**:
  - `emitThrust(wx, wy, exhaustDirX, exhaustDirY, level, shipVx, shipVy)` — called by `ParticleRenderer` each frame per engine.
  - `emitImpact(wx, wy, 'laser'|'missile'|'beam')` — called by `GameEngine` on hit events.
  - `emitExplosion(wx, wy, entityCount, vx, vy)` — called by `GameEngine.processEntityDestruction()`.
- `update(deltaMs, viewport)` — advances all live particles and converts world → screen positions. Called by `ParticleRenderer.render()`.
- `dispose()` — destroys the `PIXI.ParticleContainer` and all pooled sprites.

---

## BlockPickupSystem

Physics-spring drag system for in-game block building (sandbox and detach-and-reattach). Instantiated by `GameEngine`.

Constructor takes 6 callbacks: `removeBodyWithParts`, `addBodyToWorld`, `onPickUp`, `onDrop`, `addConstraintToWorld`, `removeConstraintFromWorld`.

Key behaviours — see root `CLAUDE.md` "Block pickup / assembly building" section for full detail.

- `update(mouseWorldPos, mouseScreenPos, playerAssembly)` — must be called every frame.
- `tryPickUp(worldPos, screenPos, assemblies, playerAssembly)` — call on mouse-down.
- `drop()` — call on mouse-up.
- `rotateHeld()` — cycles the held block through 4 × 90° orientation steps (R key).

---

## AsteroidFieldSystem

Chunk-based streaming asteroid field. Instantiated by `GameEngine` when `ScenarioConfig.spawnAsteroids` is `true`.

Constructor: `(addBodyToWorld, removeBodyFromWorld)`.

- `update(cameraCenter, viewportHalfDiag)` — call every game loop frame; loads/unloads chunks based on camera position.
- `dispose()` — removes all asteroid bodies on scene teardown.
- Chunks: `CHUNK_SIZE = 2000` world units; load radius `10000`, unload radius `14000` (hysteresis prevents thrashing).
- Bodies are `isStatic: true` plain `Matter.Body` objects — **not entities or assemblies**. Rendered automatically by `BlockBodyRenderer`'s non-entity world-body loop.
- Deterministic PRNG (mulberry32 seeded from chunk coords) so chunks regenerate identically on re-entry.
- `body.label = 'asteroid'` tags bodies for collision routing in `GameEngine`.
- **Asteroid classification**: three classes (`C-Type`, `S-Type`, `M-Type`) with distinct color palettes. Class is deterministically chosen per-chunk from the seeded PRNG and tagged on the body as `(body as unknown as Record<string, unknown>).asteroidClass`.
- `spawnAsteroid(wx, wy, radius, asteroidClass)` — public method for scenario hand-placement of specific typed asteroids.

---

## StructurePlacementSystem

Two-mode player interaction system for placing structures and creating connections. Instantiated by `GameEngine` only in structures sandbox mode.

Constructor: `(structureManager, gridManager, team)`.

- **Place mode**: `enterPlaceMode(type)` — next click spawns a structure of that type at the cursor. Stays in place mode for rapid placement.
- **Link mode**: `enterLinkMode(source)` — click a second structure to create a connection. Returns to none mode after attempt.
- `cancel()` — exits current mode.
- `handleClick(worldPos)` — dispatches click to the active mode handler. Returns `true` if consumed.
- `updateCursor(worldPos)` — called every frame to track cursor position.
- Preview getters: `getPlacingType()`, `getLinkSource()`, `getLinkTargetAtCursor()`, `getLinkCandidates()`.
- `findStructureAtPosition(worldPos)` — hit detection using `widthPx/2 + 10` radius.

---

## Import Paths

From files in this directory:
- `../core/Assembly` (and `../core/Entity`)
- `../../types/GameTypes`
- `../rendering/Viewport` (ParticleSystem only)

---

MAINTENANCE MANDATE: If you establish a new pattern, change a library, or fix a systemic bug within the scope of this directory, you must update this CLAUDE.md file to reflect the new standard before concluding your task.
