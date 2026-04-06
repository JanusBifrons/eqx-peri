import Matter from 'matter-js';
import { Vector2 } from '../../types/GameTypes';

/**
 * Check line of sight between two world-space points.
 * Returns true if no obstacle body blocks the ray.
 *
 * @param from         Origin point (e.g. barrel tip)
 * @param to           Target point (e.g. asteroid center)
 * @param obstacles    Bodies that could block the ray (asteroids, structures, etc.)
 * @param excludeIds   Body IDs to skip (e.g. the source structure's own body)
 */
export function checkLineOfSight(
  from: Vector2,
  to: Vector2,
  obstacles: Matter.Body[],
  excludeIds?: Set<number>,
): boolean {
  if (obstacles.length === 0) return true;

  const hits = Matter.Query.ray(obstacles, from, to);
  if (hits.length === 0) return true;

  // If all hit bodies are in the exclude set, the path is clear
  if (excludeIds) {
    for (const hit of hits) {
      const body = (hit as unknown as { body: Matter.Body }).body;
      if (!excludeIds.has(body.id)) return false;
    }
    return true;
  }

  return false;
}
