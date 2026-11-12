// All persistence goes through this file. To add a real leaderboard later,
// replace the bodies of these functions with API calls.

const NAME_KEY = 'khelkood.pong.name';
const SCORES_KEY = 'khelkood.pong.scores';

export interface ScoreEntry {
  name: string;
  score: number;
  at: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode etc.): the game still works
  }
}

export function getName(): string {
  return read(NAME_KEY, '');
}

export function setName(name: string) {
  write(NAME_KEY, name);
}

export function getScores(): ScoreEntry[] {
  return read<ScoreEntry[]>(SCORES_KEY, []);
}

export function addScore(entry: ScoreEntry): ScoreEntry[] {
  const scores = [...getScores(), entry]
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, 20);
  write(SCORES_KEY, scores);
  return scores;
}
