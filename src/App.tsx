import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createGame, ROUND_TIME, type Game } from './game/engine';
import { addScore, getName, getScores, setName, type ScoreEntry } from './storage';

type Phase = 'menu' | 'playing' | 'over';

interface Result {
  score: number;
  at: number;
  prevBest: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const nameRef = useRef(getName());

  const [phase, setPhase] = useState<Phase>('menu');
  const [name, setNameInput] = useState(nameRef.current);
  const [score, setScore] = useState(0);
  const [time, setTime] = useState(ROUND_TIME);
  const [scores, setScores] = useState<ScoreEntry[]>(getScores);
  const [result, setResult] = useState<Result | null>(null);
  // only ask for a name when none is saved, or when the player chooses to change it
  const [editingName, setEditingName] = useState(!nameRef.current);

  useEffect(() => {
    const game = createGame(canvasRef.current!, {
      onScore: setScore,
      onTime: setTime,
      onEnd(finalScore) {
        const prevBest = getScores()[0]?.score ?? 0;
        const at = Date.now();
        setScores(addScore({ name: nameRef.current, score: finalScore, at }));
        setResult({ score: finalScore, at, prevBest });
        setPhase('over');
      },
    });
    gameRef.current = game;
    return () => game.destroy();
  }, []);

  function play(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    nameRef.current = trimmed;
    setName(trimmed);
    setNameInput(trimmed);
    setEditingName(false);
    (document.activeElement as HTMLElement | null)?.blur();
    gameRef.current?.start();
    setPhase('playing');
  }

  const isBest = result != null && result.score > 0 && result.score > result.prevBest;

  return (
    <div className="game">
      <div className="hud">
        <span className="who">{phase === 'menu' ? '' : nameRef.current}</span>
        <span className="stat">
          <small>SCORE</small>
          {score}
        </span>
        <span className={`stat${time <= 5 ? ' low' : ''}`}>
          <small>TIME</small>
          {time.toFixed(1)}
        </span>
      </div>

      <div className="wrap">
        <canvas ref={canvasRef} />

        {phase !== 'playing' && (
          <div className="overlay">
            <form className="card" onSubmit={play}>
              {result ? (
                <>
                  <h1>Time's up!</h1>
                  <div className="big">{result.score}</div>
                  <p>
                    {isBest
                      ? 'New best on this device!'
                      : `Best on this device: ${Math.max(result.prevBest, result.score)}`}
                  </p>
                </>
              ) : (
                <>
                  <h1>Squish Shot</h1>
                  <p>
                    Drag the black ball around and knock the colour ball through the opening at the
                    top. Every wall it
                    touches on the way doubles the goal: 1, 2, 4, 8, 16. You have {ROUND_TIME} seconds.
                  </p>
                </>
              )}

              {editingName ? (
                <>
                  <label htmlFor="name">YOUR NAME</label>
                  <input
                    id="name"
                    value={name}
                    onChange={(e) => setNameInput(e.target.value)}
                    maxLength={16}
                    autoComplete="off"
                    placeholder="Type your name"
                    autoFocus
                    required
                  />
                </>
              ) : (
                <p className="as">
                  Playing as <strong>{nameRef.current}</strong>
                  <button type="button" className="link" onClick={() => setEditingName(true)}>
                    Change
                  </button>
                </p>
              )}
              <button type="submit">{result ? 'Play again' : 'Play'}</button>

              {scores.length > 0 && (
                <ol>
                  {scores.slice(0, 5).map((s, i) => (
                    <li key={s.at} className={s.at === result?.at ? 'me' : undefined}>
                      <span>
                        {i + 1}. {s.name}
                      </span>
                      <span>{s.score}</span>
                    </li>
                  ))}
                </ol>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
