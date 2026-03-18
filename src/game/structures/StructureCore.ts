import { Vector2 } from '../../types/GameTypes';
import { Structure } from './Structure';

/**
 * The Core is the foundational structure for a team's base.
 * It provides baseline power output and storage, and serves as the
 * anchor point from which all other structures connect.
 */
export class StructureCore extends Structure {
  constructor(position: Vector2, team: number) {
    super('Core', position, team);
  }
}
