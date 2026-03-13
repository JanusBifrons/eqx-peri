import * as PIXI from 'pixi.js';
import { Viewport } from '../rendering/Viewport';

// ─── Pool ────────────────────────────────────────────────────────────────────
const MAX_PARTICLES = 5000;

// ─── Texture atlas ───────────────────────────────────────────────────────────
// One 64×16 canvas, four 16×16 frames, all sharing the same BaseTexture so
// PIXI.ParticleContainer can batch them into a single draw call.
//
//  frame 0 (x=0):  Soft radial-gradient circle
//  frame 1 (x=16): Diamond (rotated square)
//  frame 2 (x=32): Horizontal streak bar (bright centre, tapered ends) — rotated at runtime
//  frame 3 (x=48): Filled triangle pointing right
//
const ATLAS_W = 64;
const ATLAS_H = 16;
const FRAME_SIZE = 16; // each frame is 16×16

// ─── Particle record ─────────────────────────────────────────────────────────
interface Particle {
  sprite: PIXI.Sprite;
  worldX: number; worldY: number;
  vx: number; vy: number;         // world units / ms
  life: number; maxLife: number;  // ms
  sizeStart: number;              // world-unit radius at birth
  sizeEnd: number;                // world-unit radius at death
  scaleX: number;                 // non-uniform X multiplier (for streaks)
  scaleY: number;                 // non-uniform Y multiplier
  tintStart: number; tintEnd: number;
  alphaStart: number; alphaEnd: number;
  rotation: number;               // radians, current
  rotVel: number;                 // radians / ms
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

/**
 * Manages all in-game particle effects via a single PIXI.ParticleContainer.
 *
 * Shapes: circle · diamond · streak (elongated) · triangle — all from one atlas texture.
 * Properties: position · scale (non-uniform) · rotation · tint · alpha — all per particle.
 * Pool: 5 000 sprites; O(1) acquire/release via free/active lists.
 * Particles live in world space; converted to screen coords inside update().
 */
export class ParticleSystem {
  private container!: PIXI.ParticleContainer;
  private frames: PIXI.Texture[] = [];

  private free: Particle[] = [];
  private active: Particle[] = [];

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  init(stage: PIXI.Container): void {
    this.frames = this.buildAtlas();

    this.container = new PIXI.ParticleContainer(MAX_PARTICLES, {
      position: true,
      scale: true,
      alpha: true,
      tint: true,
      rotation: true,
      uvs: true,
    });
    this.container.blendMode = PIXI.BLEND_MODES.ADD;
    stage.addChild(this.container);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const sprite = new PIXI.Sprite(this.frames[0]);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.container.addChild(sprite);
      this.free.push({
        sprite, worldX: 0, worldY: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1,
        sizeStart: 4, sizeEnd: 0,
        scaleX: 1, scaleY: 1,
        tintStart: 0xffffff, tintEnd: 0xffffff,
        alphaStart: 1, alphaEnd: 0,
        rotation: 0, rotVel: 0,
      });
    }
  }

  private buildAtlas(): PIXI.Texture[] {
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_W;
    canvas.height = ATLAS_H;
    const ctx = canvas.getContext('2d')!;

    // ── Frame 0: soft radial circle ──
    const g0 = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g0.addColorStop(0,    'rgba(255,255,255,1)');
    g0.addColorStop(0.45, 'rgba(255,255,255,0.9)');
    g0.addColorStop(0.85, 'rgba(255,255,255,0.3)');
    g0.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.fillStyle = g0;
    ctx.beginPath();
    ctx.arc(8, 8, 8, 0, Math.PI * 2);
    ctx.fill();

    // ── Frame 1: diamond ──
    ctx.save();
    ctx.translate(24, 8);
    ctx.rotate(Math.PI / 4);
    // Draw a soft square that, when rotated 45°, looks like a diamond
    const g1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 6);
    g1.addColorStop(0,   'rgba(255,255,255,1)');
    g1.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    g1.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(-6, -6, 12, 12);
    ctx.restore();

    // ── Frame 2: horizontal streak bar (bright centre, tapered ends) ──
    // Drawn in a 16×16 cell at x=32. The bar is horizontal so rotation at runtime
    // aligns it with the velocity vector.
    const g2 = ctx.createLinearGradient(32, 0, 48, 0);
    g2.addColorStop(0,    'rgba(255,255,255,0)');
    g2.addColorStop(0.25, 'rgba(255,255,255,0.85)');
    g2.addColorStop(0.5,  'rgba(255,255,255,1)');
    g2.addColorStop(0.75, 'rgba(255,255,255,0.85)');
    g2.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.fillStyle = g2;
    // Draw a thin, bright elliptical strip centred vertically
    ctx.beginPath();
    ctx.ellipse(40, 8, 7, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── Frame 3: solid triangle pointing right ──
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.moveTo(62, 8);   // right tip
    ctx.lineTo(50, 2);   // top-left
    ctx.lineTo(50, 14);  // bottom-left
    ctx.closePath();
    ctx.fill();

    const base = PIXI.BaseTexture.from(canvas);
    return [0, 1, 2, 3].map(i =>
      new PIXI.Texture(base, new PIXI.Rectangle(i * FRAME_SIZE, 0, FRAME_SIZE, FRAME_SIZE)),
    );
  }

  // ── Internal acquire ──────────────────────────────────────────────────────

  private spawn(
    frame: number,
    worldX: number, worldY: number,
    vx: number, vy: number,
    maxLife: number,
    sizeStart: number, sizeEnd: number,
    scaleX: number, scaleY: number,
    tintStart: number, tintEnd: number,
    rotation: number = 0,
    rotVel: number = 0,
    alphaStart: number = 1,
    alphaEnd: number = 0,
  ): void {
    const p = this.free.pop();
    if (!p) return;

    p.worldX = worldX; p.worldY = worldY;
    p.vx = vx;         p.vy = vy;
    p.life = maxLife;  p.maxLife = maxLife;
    p.sizeStart = sizeStart; p.sizeEnd = sizeEnd;
    p.scaleX = scaleX; p.scaleY = scaleY;
    p.tintStart = tintStart; p.tintEnd = tintEnd;
    p.alphaStart = alphaStart; p.alphaEnd = alphaEnd;
    p.rotation = rotation; p.rotVel = rotVel;
    p.sprite.texture = this.frames[frame];
    p.sprite.tint = tintStart;
    p.sprite.alpha = alphaStart;
    p.sprite.rotation = rotation;
    p.sprite.visible = true;
    this.active.push(p);
  }

  // ── Public emitters ───────────────────────────────────────────────────────

  /**
   * Emit one thrust-exhaust burst. ParticleRenderer calls this multiple times per
   * frame per engine; rate-limiting lives in the renderer.
   *
   * Emits 3 particles per call (blob + streak + spark) to maximise visual density
   * without tripling the renderer call rate.
   */
  emitThrust(
    wx: number, wy: number,
    exhaustDirX: number, exhaustDirY: number,
    thrustLevel: number,
    shipVx: number, shipVy: number,
  ): void {
    const baseAngle = Math.atan2(exhaustDirY, exhaustDirX);

    // ── 1. Large hot blob (circle) — bright near the nozzle ──
    {
      const angle = baseAngle + rand(-0.25, 0.25);
      const speed = rand(0.10, 0.28) * thrustLevel;
      const hot = thrustLevel > 0.6;
      this.spawn(
        0,                                          // circle
        wx + rand(-4, 4), wy + rand(-4, 4),
        Math.cos(angle) * speed + shipVx * 0.3,
        Math.sin(angle) * speed + shipVy * 0.3,
        rand(200, 480),
        rand(6, 14) * Math.max(0.4, thrustLevel), 0,
        1, 1,
        hot ? 0xffffff : 0xffdd66,                 // white-hot → dim orange
        0xff2200,
      );
    }

    // ── 2. Elongated streak aligned with exhaust axis ──
    {
      const angle = baseAngle + rand(-0.15, 0.15);
      const speed = rand(0.18, 0.38) * thrustLevel;
      this.spawn(
        2,                                          // streak
        wx + rand(-2, 2), wy + rand(-2, 2),
        Math.cos(angle) * speed + shipVx * 0.25,
        Math.sin(angle) * speed + shipVy * 0.25,
        rand(150, 380),
        rand(10, 22) * Math.max(0.4, thrustLevel), 0,
        3.5, 0.35,                                  // long and thin
        0xffaa22, 0xff1100,
        angle,                                      // rotate to point along exhaust
        0,
      );
    }

    // ── 3. Small flying spark (diamond) ──
    {
      const angle = baseAngle + rand(-0.7, 0.7);
      const speed = rand(0.06, 0.20) * thrustLevel;
      this.spawn(
        1,                                          // diamond
        wx + rand(-6, 6), wy + rand(-6, 6),
        Math.cos(angle) * speed + shipVx * 0.2,
        Math.sin(angle) * speed + shipVy * 0.2,
        rand(120, 320),
        rand(3, 9) * Math.max(0.3, thrustLevel), 0,
        1, 1,
        0xffcc44, 0xff4400,
        Math.random() * Math.PI * 2,
        rand(-0.015, 0.015),
      );
    }
  }

  /**
   * Emit sparks at a weapon impact point.
   */
  emitImpact(wx: number, wy: number, type: 'laser' | 'missile' | 'beam'): void {
    switch (type) {
      case 'laser': {
        const count = randInt(22, 38);
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = rand(0.10, 0.35);
          const frame = Math.random() < 0.5 ? 1 : 0; // diamond or circle
          this.spawn(
            frame,
            wx + rand(-8, 8), wy + rand(-8, 8),
            Math.cos(angle) * speed, Math.sin(angle) * speed,
            rand(150, 420),
            rand(3, 10), 0,
            1, 1,
            Math.random() < 0.4 ? 0xffffff : 0x44ffff,
            0x0033cc,
            Math.random() * Math.PI * 2,
            rand(-0.02, 0.02),
          );
        }
        // A few fast streak sparks
        for (let i = 0; i < randInt(4, 8); i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = rand(0.25, 0.55);
          this.spawn(
            2, // streak
            wx, wy,
            Math.cos(angle) * speed, Math.sin(angle) * speed,
            rand(80, 200),
            rand(8, 18), 0,
            2.5, 0.3,
            0xffffff, 0x0088ff,
            angle,
          );
        }
        break;
      }

      case 'beam': {
        const count = randInt(16, 28);
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = rand(0.08, 0.28);
          this.spawn(
            Math.random() < 0.5 ? 1 : 3, // diamond or triangle
            wx + rand(-6, 6), wy + rand(-6, 6),
            Math.cos(angle) * speed, Math.sin(angle) * speed,
            rand(120, 320),
            rand(3, 9), 0,
            1, 1,
            Math.random() < 0.35 ? 0xffffff : 0x88ddff,
            0x0022ff,
            Math.random() * Math.PI * 2,
            rand(-0.025, 0.025),
          );
        }
        // Blue streak sparks
        for (let i = 0; i < randInt(3, 6); i++) {
          const angle = Math.random() * Math.PI * 2;
          this.spawn(
            2,
            wx, wy,
            Math.cos(angle) * rand(0.20, 0.45),
            Math.sin(angle) * rand(0.20, 0.45),
            rand(100, 220),
            rand(10, 20), 0,
            3, 0.3,
            0xaaccff, 0x0000ff,
            angle,
          );
        }
        break;
      }

      case 'missile': {
        // Central white flash burst
        for (let i = 0; i < randInt(10, 16); i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = rand(0.05, 0.18);
          this.spawn(
            0,
            wx + rand(-12, 12), wy + rand(-12, 12),
            Math.cos(angle) * speed, Math.sin(angle) * speed,
            rand(300, 700),
            rand(10, 24), 0,
            1, 1,
            0xffffff, 0xff4400,
          );
        }
        // Orange/red flying debris (circles + diamonds)
        const debrisCount = randInt(55, 90);
        for (let i = 0; i < debrisCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = rand(0.08, 0.32);
          const frame = Math.random() < 0.4 ? 1 : 0;
          const pick = Math.random();
          const tintS = pick < 0.25 ? 0xffffff : pick < 0.6 ? 0xff8800 : 0xff3300;
          this.spawn(
            frame,
            wx + rand(-18, 18), wy + rand(-18, 18),
            Math.cos(angle) * speed, Math.sin(angle) * speed,
            rand(350, 900),
            rand(4, 14), 0,
            1, 1,
            tintS, 0x440000,
            Math.random() * Math.PI * 2,
            rand(-0.02, 0.02),
          );
        }
        // Streak shards flying outward
        for (let i = 0; i < randInt(8, 14); i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = rand(0.20, 0.50);
          this.spawn(
            2,
            wx + rand(-10, 10), wy + rand(-10, 10),
            Math.cos(angle) * speed, Math.sin(angle) * speed,
            rand(200, 500),
            rand(12, 26), 0,
            3.5, 0.3,
            0xffffff, 0xff2200,
            angle,
          );
        }
        // Triangle chunks
        for (let i = 0; i < randInt(5, 10); i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = rand(0.06, 0.22);
          this.spawn(
            3,
            wx + rand(-14, 14), wy + rand(-14, 14),
            Math.cos(angle) * speed, Math.sin(angle) * speed,
            rand(400, 900),
            rand(6, 16), 0,
            1, 1,
            0xff6600, 0x330000,
            Math.random() * Math.PI * 2,
            rand(-0.015, 0.015),
          );
        }
        break;
      }
    }
  }

  /**
   * Emit a dramatic radial debris burst when an assembly is fully destroyed.
   */
  emitExplosion(
    wx: number, wy: number,
    entityCount: number,
    assemblyVx: number = 0,
    assemblyVy: number = 0,
  ): void {
    const total = Math.min(60 + entityCount * 14, 200);

    // ── Large slow fireballs (circles) ──
    const fireball = Math.floor(total * 0.30);
    for (let i = 0; i < fireball; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = rand(0.02, 0.09 + entityCount * 0.003);
      const pick = Math.random();
      const tS = pick < 0.2 ? 0xffffff : pick < 0.55 ? 0xff8800 : 0xff3300;
      this.spawn(
        0,
        wx + rand(-20, 20), wy + rand(-20, 20),
        Math.cos(angle) * speed + assemblyVx * 0.15,
        Math.sin(angle) * speed + assemblyVy * 0.15,
        rand(500, 1400),
        rand(8, Math.min(14 + entityCount * 0.5, 28)), 0,
        1, 1,
        tS, 0x110000,
      );
    }

    // ── Fast diamond shards ──
    const shards = Math.floor(total * 0.25);
    for (let i = 0; i < shards; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = rand(0.06, 0.22 + entityCount * 0.004);
      this.spawn(
        1,
        wx + rand(-24, 24), wy + rand(-24, 24),
        Math.cos(angle) * speed + assemblyVx * 0.1,
        Math.sin(angle) * speed + assemblyVy * 0.1,
        rand(400, 1100),
        rand(4, 12), 0,
        1, 1,
        Math.random() < 0.3 ? 0xffdd88 : 0xff5500,
        0x220000,
        Math.random() * Math.PI * 2,
        rand(-0.02, 0.02),
      );
    }

    // ── Streak debris (long flying shards) ──
    const streaks = Math.floor(total * 0.25);
    for (let i = 0; i < streaks; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = rand(0.08, 0.28 + entityCount * 0.004);
      const pick = Math.random();
      const tS = pick < 0.2 ? 0xffffff : 0xff6600;
      this.spawn(
        2,
        wx + rand(-20, 20), wy + rand(-20, 20),
        Math.cos(angle) * speed + assemblyVx * 0.12,
        Math.sin(angle) * speed + assemblyVy * 0.12,
        rand(300, 900),
        rand(10, Math.min(22 + entityCount * 0.5, 36)), 0,
        rand(2.5, 4.5), 0.25,
        tS, 0x110000,
        angle,
        rand(-0.008, 0.008),
      );
    }

    // ── Triangle chunks tumbling ──
    const tris = Math.floor(total * 0.20);
    for (let i = 0; i < tris; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = rand(0.04, 0.16 + entityCount * 0.003);
      this.spawn(
        3,
        wx + rand(-18, 18), wy + rand(-18, 18),
        Math.cos(angle) * speed + assemblyVx * 0.12,
        Math.sin(angle) * speed + assemblyVy * 0.12,
        rand(450, 1200),
        rand(6, Math.min(16 + entityCount * 0.4, 24)), 0,
        1, 1,
        Math.random() < 0.35 ? 0xffaa44 : 0xff4400,
        0x220000,
        Math.random() * Math.PI * 2,
        rand(-0.025, 0.025),
      );
    }
  }

  // ── Frame update ─────────────────────────────────────────────────────────

  update(deltaMs: number, viewport: Viewport): void {
    const { bounds, canvas } = viewport;
    const bw = bounds.max.x - bounds.min.x;
    const bh = bounds.max.y - bounds.min.y;
    const toSX = (wx: number) => (wx - bounds.min.x) / bw * canvas.width;
    const toSY = (wy: number) => (wy - bounds.min.y) / bh * canvas.height;
    const vpScale = canvas.width / bw; // px per world unit

    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= deltaMs;
      if (p.life <= 0) {
        p.sprite.visible = false;
        this.free.push(p);
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
        continue;
      }

      const t = 1 - p.life / p.maxLife; // 0 at birth → 1 at death

      p.worldX += p.vx * deltaMs;
      p.worldY += p.vy * deltaMs;
      p.sprite.x = toSX(p.worldX);
      p.sprite.y = toSY(p.worldY);

      const worldSize = p.sizeStart + (p.sizeEnd - p.sizeStart) * t;
      const base = Math.max(0.3, worldSize * vpScale) / (FRAME_SIZE / 2);
      p.sprite.scale.set(base * p.scaleX, base * p.scaleY);

      p.rotation += p.rotVel * deltaMs;
      p.sprite.rotation = p.rotation;

      p.sprite.alpha = p.alphaStart + (p.alphaEnd - p.alphaStart) * t;
      p.sprite.tint = lerpColor(p.tintStart, p.tintEnd, t);
    }
  }

  dispose(): void {
    for (const p of this.active) p.sprite.visible = false;
    this.free.push(...this.active);
    this.active = [];
  }
}
