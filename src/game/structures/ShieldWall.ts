import Matter from 'matter-js';
import { SHIELD_WALL_THICKNESS, SHIELD_WALL_STUN_MS } from '../../types/GameTypes';
import { Structure } from './Structure';

let nextWallId = 1;

/**
 * A physical shield barrier spanning between two ShieldFence posts.
 * Created automatically when two ShieldFence structures are connected.
 * Blocks all movement and weapons (no friendly pass-through by design).
 *
 * Damage resolution is grid-powered (no HP on the wall itself):
 * 1. If grid netPower absorbs the hit → no effect.
 * 2. If damage exceeds netPower → excess drains grid batteries.
 * 3. If damage exceeds netPower + batteries → wall is stunned for SHIELD_WALL_STUN_MS.
 */
export class ShieldWall {
  public readonly id: string;
  public readonly body: Matter.Body;
  public readonly postA: Structure;
  public readonly postB: Structure;
  public readonly team: number;

  /** Whether the wall is currently stunned (disabled by damage overload). */
  public isStunned: boolean = false;
  /** Timestamp (ms) when the stun expires and the wall reactivates. */
  public stunUntil: number = 0;
  /** Whether the wall is currently powered by the grid. Unpowered walls are offline. */
  public isPowered: boolean = true;

  constructor(postA: Structure, postB: Structure) {
    this.id = `shield-wall-${nextWallId++}`;
    this.postA = postA;
    this.postB = postB;
    this.team = postA.team;

    // Compute wall geometry — rectangle spanning between the two posts
    const ax = postA.body.position.x;
    const ay = postA.body.position.y;
    const bx = postB.body.position.x;
    const by = postB.body.position.y;
    const midX = (ax + bx) / 2;
    const midY = (ay + by) / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    this.body = Matter.Bodies.rectangle(midX, midY, length, SHIELD_WALL_THICKNESS, {
      isStatic: true,
      friction: 0,
      frictionAir: 0,
      restitution: 0.8,
      label: 'shield-wall',
      render: {
        fillStyle: '#4488ff',
        strokeStyle: '#88bbff',
        lineWidth: 1,
      },
    });

    Matter.Body.setAngle(this.body, angle);

    // Back-reference so collision handlers can look up the wall from the body
    (this.body as unknown as Record<string, unknown>).shieldWall = this;
  }

  /** Enter stunned state — wall becomes non-blocking for a cooldown period. */
  public stun(): void {
    this.isStunned = true;
    this.stunUntil = Date.now() + SHIELD_WALL_STUN_MS;
  }

  /** Whether the wall is currently active (not stunned and powered). */
  public isActive(): boolean {
    return !this.isStunned && this.isPowered;
  }
}
