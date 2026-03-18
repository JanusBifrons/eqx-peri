import { CONNECTION_THROUGHPUT } from '../../types/GameTypes';
import { Structure } from './Structure';

let nextConnectionId = 1;

/**
 * A network connection between two structures/connectors.
 * Purely data — no physics body. Visual lines are drawn by ConnectionRenderer.
 */
export class Connection {
  public readonly id: string;
  public readonly nodeA: Structure;
  public readonly nodeB: Structure;
  public readonly throughput: number; // max resource units per pulse

  /** Timestamp (ms) until which this connection should render a flash. */
  public flashUntil: number = 0;

  constructor(nodeA: Structure, nodeB: Structure, throughput: number = CONNECTION_THROUGHPUT) {
    this.id = `conn-${nextConnectionId++}`;
    this.nodeA = nodeA;
    this.nodeB = nodeB;
    this.throughput = throughput;
  }

  /** Returns the other end of this connection given one end. */
  public getOtherNode(node: Structure): Structure {
    return node === this.nodeA ? this.nodeB : this.nodeA;
  }

  /** World-space distance between the two connected nodes. */
  public getLength(): number {
    const dx = this.nodeA.body.position.x - this.nodeB.body.position.x;
    const dy = this.nodeA.body.position.y - this.nodeB.body.position.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Trigger a visual flash on this connection for the given duration. */
  public flash(durationMs: number = 300): void {
    this.flashUntil = Date.now() + durationMs;
  }

  /** Whether this connection is currently flashing. */
  public isFlashing(): boolean {
    return Date.now() < this.flashUntil;
  }
}
