// How a goal happened. The engine fills this in for every goal.
export interface ShotInfo {
  /** Colour-ball wall hits since it was last struck by the black ball. */
  wallBounces: number;
  /** Consecutive goals without the black ball falling through the opening. */
  streak: number;
  /** Seconds since the previous goal (or since the round started). */
  sinceLast: number;
}

/** Most wall touches that still raise the value of a goal (2^6 = 64 points). */
export const MAX_COUNTED_BOUNCES = 6;

// Every wall the colour ball touches after its last strike doubles the goal:
// 0 touches = 1, 1 = 2, 2 = 4, 3 = 8, 4 = 16 ...
export function goalPoints(shot: ShotInfo): number {
  return 2 ** Math.min(shot.wallBounces, MAX_COUNTED_BOUNCES);
}
