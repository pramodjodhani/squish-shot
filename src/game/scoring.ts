// How a goal happened. The engine fills this in for every goal.
export interface ShotInfo {
  /** Colour-ball wall hits since it was last struck by the black ball. */
  wallBounces: number;
  /** Consecutive goals without the black ball falling through the opening. */
  streak: number;
  /** Seconds since the previous goal (or since the round started). */
  sinceLast: number;
}

// The single place to add scoring leverage in the next version.
// Linear for now: every goal is worth 1.
export function goalPoints(_shot: ShotInfo): number {
  return 1;
}
