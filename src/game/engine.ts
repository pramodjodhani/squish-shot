import { goalPoints, type ShotInfo } from './scoring';

// ---------- constants ----------
const W = 420;
const H = 640; // logical field size
const L = 10;
const R = W - 10;
const T = 34;
const B = H - 10; // wall positions
const GAP = 330;
const GX1 = (W - GAP) / 2;
const GX2 = (W + GAP) / 2; // opening in the top wall
const K_WALL = 5200; // wall spring stiffness (soft contact)
const FRICTION = 0.85; // velocity decay per second (exponent)
const MAX_SPEED = 1500;
const DRAG_GAIN = 28; // how tightly the black ball follows the pointer
const DRAG_MAX = 2400; // top speed while dragged
const STEP = 1 / 240;
const BOUNCE_MIN_HIT = 120; // slower taps on the floor don't trigger the trampoline
const BOUNCE_LAUNCH = 720; // minimum speed the colour ball leaves the floor with
const INK = '#17171c';
const FONT = 'ui-rounded, system-ui, sans-serif';

export const ROUND_TIME = 30;

type WallId = 'l' | 'r' | 't' | 'b';

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  isStriker: boolean;
  hue: number;
  // wall squash springs (per axis) and the side the wall is on
  dx: number;
  vdx: number;
  dy: number;
  vdy: number;
  nx: number;
  ny: number;
  // ball-to-ball squash spring along angle `ha`
  h: number;
  vh: number;
  ha: number;
  touch: Record<WallId, boolean>;
  pop: number;
  /** Speed the ball hit the bottom wall with; 0 when not pressing on it. */
  bounce: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
  r: number;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  life: number;
}

export interface GameCallbacks {
  onScore(score: number): void;
  onTime(secondsLeft: number): void;
  onEnd(score: number): void;
}

export interface Game {
  start(): void;
  destroy(): void;
}

function makeBall(x: number, y: number, r: number, isStriker: boolean): Ball {
  return {
    x, y, vx: 0, vy: 0, r, isStriker, hue: Math.random() * 360,
    dx: 0, vdx: 0, dy: 0, vdy: 0, nx: 1, ny: 1,
    h: 0, vh: 0, ha: 0,
    touch: { l: false, r: false, t: false, b: false },
    pop: 1,
    bounce: 0,
  };
}

export function createGame(canvas: HTMLCanvasElement, cb: GameCallbacks): Game {
  const ctx = canvas.getContext('2d')!;
  let scale = 1;

  const striker = makeBall(W / 2, H - 110, 46, true);
  const target = makeBall(W / 2, H / 2, 48, false);
  const balls = [striker, target];
  const wallFlash: Record<WallId, number> = { l: 0, r: 0, t: 0, b: 0 };
  const wallHue: Record<WallId, number> = { l: 0, r: 0, t: 0, b: 0 };
  let particles: Particle[] = [];
  let popups: Popup[] = [];
  let playing = false;
  let started = false; // the clock starts on the first touch
  let score = 0;
  let timeLeft = ROUND_TIME;
  let shownTime = '';
  let shot: ShotInfo = { wallBounces: 0, streak: 0, sinceLast: 0 };
  // While the pointer is down the black ball chases (tx, ty); (ox, oy) is the
  // ball's offset from the pointer at grab time, so it never jumps under the finger.
  let drag: { ox: number; oy: number; tx: number; ty: number } | null = null;
  let shake = 0;

  // ---------- sizing ----------
  function resize() {
    scale = Math.min((window.innerWidth - 20) / W, (window.innerHeight - 70) / H, 1.5);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
  }

  // ---------- audio ----------
  let ac: AudioContext | null = null;
  function initAudio() {
    if (!ac) {
      try {
        ac = new AudioContext();
      } catch {
        ac = null;
      }
    }
    if (ac && ac.state === 'suspended') void ac.resume();
  }
  function blip(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slide = 0) {
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    const t = ac.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(Math.min(vol, 0.4), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur);
  }

  // ---------- events ----------
  function resetStriker() {
    drag = null;
    Object.assign(striker, { x: W / 2, y: H - 110, vx: 0, vy: 0, pop: 0 });
  }

  function respawnTarget() {
    let x = 0;
    let y = 0;
    let tries = 0;
    do {
      x = 80 + Math.random() * (W - 160);
      y = H * 0.38 + Math.random() * H * 0.4;
    } while (Math.hypot(x - striker.x, y - striker.y) < 190 && ++tries < 30);
    Object.assign(target, { x, y, vx: 0, vy: 0, pop: 0, hue: Math.random() * 360 });
    shot.wallBounces = 0;
  }

  function onWallHit(b: Ball, id: WallId, speed: number) {
    const v = Math.min(speed / 1200, 1);
    wallFlash[id] = Math.max(wallFlash[id], 0.35 + v * 0.65);
    wallHue[id] = b.hue;
    if (!b.isStriker) {
      shot.wallBounces++;
      // show what a goal is worth right now
      if (playing) popups.push({ x: b.x, y: Math.max(b.y - b.r - 50, T + 10), text: `×${goalPoints(shot)}`, life: 1 });
    }
    blip(b.isStriker ? 110 : 170 + Math.random() * 40, 0.12, 0.05 + v * 0.25, 'sine', -60);
  }

  function burst(x: number, y: number, hue: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 320;
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 120,
        life: 1, hue: hue + Math.random() * 60 - 30, r: 2 + Math.random() * 4,
      });
    }
  }

  function goal() {
    const pts = goalPoints({ ...shot });
    score += pts;
    shot.streak++;
    shot.sinceLast = 0;
    cb.onScore(score);
    burst(target.x, T + 6, target.hue, 26);
    popups.push({ x: target.x, y: T + 40, text: `+${pts}`, life: 1 });
    shake = 8;
    [523, 659, 784].forEach((f, i) => setTimeout(() => blip(f, 0.18, 0.18, 'triangle'), i * 60));
    respawnTarget();
  }

  // ---------- physics ----------
  // Soft wall: the ball sinks into the wall, a spring pushes it back out.
  // Returns the compression as a fraction of the ball's diameter.
  function press(b: Ball, axis: 'x' | 'y', dir: number, p: number, id: WallId, h: number): number {
    if (p <= 0) {
      if (id === 'b' && b.touch.b && !b.isStriker && b.bounce > BOUNCE_MIN_HIT) {
        // Trampoline floor: a colour ball knocked into the bottom wall squashes,
        // then springs back fast enough to reach the top, and mostly straight up.
        b.vy = -Math.min(Math.max(-b.vy, b.bounce, BOUNCE_LAUNCH), MAX_SPEED);
        b.vx *= 0.5;
        blip(200, 0.16, 0.2, 'sine', 260);
      }
      if (id === 'b') b.bounce = 0;
      b.touch[id] = false;
      return 0;
    }
    const vk = axis === 'x' ? 'vx' : 'vy';
    if (!b.touch[id]) {
      b.touch[id] = true;
      const sp = Math.abs(b[vk]);
      if (id === 'b') b.bounce = sp;
      if (sp > 45) onWallHit(b, id, sp);
    }
    const max = b.r * 0.7;
    if (p > max) {
      b[axis] += dir * (p - max);
      p = max;
      if (b[vk] * dir < 0) b[vk] *= -0.6;
    }
    // weaker on the way out, so a little energy is lost like a real soft ball
    b[vk] += dir * K_WALL * p * (b[vk] * dir < 0 ? 1 : 0.72) * h;
    if (axis === 'x') b.nx = dir;
    else b.ny = dir;
    return p / (2 * b.r);
  }

  // The two ends of the opening are rigid posts.
  function post(b: Ball, px: number, py: number) {
    const ox = b.x - px;
    const oy = b.y - py;
    const d = Math.hypot(ox, oy);
    if (d >= b.r || d === 0) return;
    const nx = ox / d;
    const ny = oy / d;
    const vn = b.vx * nx + b.vy * ny;
    b.x += nx * (b.r - d);
    b.y += ny * (b.r - d);
    if (vn < 0) {
      b.vx -= 1.7 * vn * nx;
      b.vy -= 1.7 * vn * ny;
      b.ha = Math.atan2(ny, nx);
      b.vh += Math.min(-vn * 0.011, 16);
      if (-vn > 60) blip(320, 0.06, Math.min(-vn / 3000, 0.2), 'square');
    }
  }

  function stepBall(b: Ball, h: number) {
    const inGap = b.x > GX1 && b.x < GX2;
    const tx = Math.max(press(b, 'x', 1, L + b.r - b.x, 'l', h), press(b, 'x', -1, b.x + b.r - R, 'r', h));
    let ty = press(b, 'y', -1, b.y + b.r - B, 'b', h);
    if (!inGap) ty = Math.max(ty, press(b, 'y', 1, T + b.r - b.y, 't', h));
    else b.touch.t = false;
    post(b, GX1, T);
    post(b, GX2, T);

    const f = Math.exp(-FRICTION * h);
    b.vx *= f;
    b.vy *= f;
    b.x += b.vx * h;
    b.y += b.vy * h;

    // jelly springs: follow the real compression, then overshoot and wobble
    b.vdx += (2600 * (tx - b.dx) - 20 * b.vdx) * h;
    b.dx += b.vdx * h;
    b.vdy += (2600 * (ty - b.dy) - 20 * b.vdy) * h;
    b.dy += b.vdy * h;
    b.vh += (-2600 * b.h - 20 * b.vh) * h;
    b.h = Math.max(-0.35, Math.min(0.4, b.h + b.vh * h));
    b.pop += (1 - b.pop) * Math.min(1, 14 * h);
  }

  function collide(a: Ball, b: Ball) {
    const ox = b.x - a.x;
    const oy = b.y - a.y;
    const d = Math.hypot(ox, oy);
    const min = a.r + b.r;
    if (d >= min || d === 0) return;
    const nx = ox / d;
    const ny = oy / d;
    const pen = min - d;
    a.x -= (nx * pen) / 2;
    a.y -= (ny * pen) / 2;
    b.x += (nx * pen) / 2;
    b.y += (ny * pen) / 2;
    const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rel >= 0) return;
    const j = (-(1 + 0.94) * rel) / 2;
    a.vx -= j * nx;
    a.vy -= j * ny;
    b.vx += j * nx;
    b.vy += j * ny;
    const kick = Math.min(-rel * 0.011, 17);
    a.ha = b.ha = Math.atan2(ny, nx);
    a.vh += kick;
    b.vh += kick;
    shot.wallBounces = 0;
    const v = Math.min(-rel / 1400, 1);
    blip(240 + v * 160, 0.09, 0.08 + v * 0.25, 'triangle', -80);
    if (v > 0.5) shake = Math.max(shake, v * 5);
  }

  function step(h: number) {
    if (drag && playing) {
      let vx = (drag.tx - striker.x) * DRAG_GAIN;
      let vy = (drag.ty - striker.y) * DRAG_GAIN;
      const sp = Math.hypot(vx, vy);
      if (sp > DRAG_MAX) {
        vx *= DRAG_MAX / sp;
        vy *= DRAG_MAX / sp;
      }
      striker.vx = vx;
      striker.vy = vy;
    }
    balls.forEach((b) => stepBall(b, h));
    collide(striker, target);
    if (target.y < T - target.r * 0.3) {
      if (playing) goal();
      else respawnTarget();
    }
    if (striker.y < T - striker.r * 0.3) {
      // black ball fell out: the reset costs time and breaks the streak
      burst(striker.x, T + 6, 0, 10);
      blip(90, 0.25, 0.2, 'sawtooth', -40);
      shot.streak = 0;
      resetStriker();
    }
  }

  // ---------- drawing ----------
  function drawBall(b: Ball) {
    const sx = (1 - b.dx) * (1 + b.dy * 0.8) * b.pop;
    const sy = (1 - b.dy) * (1 + b.dx * 0.8) * b.pop;
    ctx.save();
    ctx.translate(b.x + b.nx * b.dx * b.r, b.y + b.ny * b.dy * b.r);
    ctx.scale(sx, sy);
    ctx.rotate(b.ha);
    ctx.scale(1 - b.h, 1 + b.h * 0.8);
    ctx.rotate(-b.ha);
    // flat fill: no gradient, highlight or shadow
    ctx.fillStyle = b.isStriker ? INK : `hsl(${b.hue} 85% 56%)`;
    ctx.beginPath();
    ctx.arc(0, 0, b.r, 0, 7);
    ctx.fill();
    ctx.restore();
  }

  function wallSeg(x1: number, y1: number, x2: number, y2: number, id: WallId) {
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (wallFlash[id] > 0.01) {
      ctx.globalAlpha = wallFlash[id];
      ctx.strokeStyle = `hsl(${wallHue[id]} 90% 58%)`;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function draw(t: number) {
    const dpr = canvas.width / (W * scale);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake > 0.2) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    // goal glow and chevrons
    const pulse = 0.5 + 0.5 * Math.sin(t / 260);
    const gg = ctx.createLinearGradient(0, 0, 0, T + 70);
    gg.addColorStop(0, `hsla(${target.hue} 90% 60% / ${0.35 + pulse * 0.2})`);
    gg.addColorStop(1, `hsla(${target.hue} 90% 60% / 0)`);
    ctx.fillStyle = gg;
    ctx.fillRect(GX1, 0, GAP, T + 70);
    ctx.strokeStyle = 'rgba(23,23,28,.28)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < 2; i++) {
      const y = 16 + i * 10 - pulse * 3;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 10, y + 6);
      ctx.lineTo(W / 2, y - 2);
      ctx.lineTo(W / 2 + 10, y + 6);
      ctx.stroke();
    }

    balls.forEach(drawBall);

    for (const p of particles) {
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = `hsl(${p.hue} 90% 58%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // walls, drawn on top so squashed balls tuck under them
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    wallSeg(L - 4, T - 4, L - 4, B + 4, 'l');
    wallSeg(R + 4, T - 4, R + 4, B + 4, 'r');
    wallSeg(L - 4, B + 4, R + 4, B + 4, 'b');
    wallSeg(L - 4, T - 4, GX1, T - 4, 't');
    wallSeg(GX2, T - 4, R + 4, T - 4, 't');
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(GX1, T - 4, 7, 0, 7);
    ctx.arc(GX2, T - 4, 7, 0, 7);
    ctx.fill();

    ctx.font = `800 26px ${FONT}`;
    ctx.textAlign = 'center';
    for (const p of popups) {
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = INK;
      ctx.fillText(p.text, p.x, p.y + p.life * 30);
    }
    ctx.globalAlpha = 1;

    if (playing && !started) {
      ctx.font = `600 15px ${FONT}`;
      ctx.fillStyle = 'rgba(23,23,28,.5)';
      ctx.fillText('Drag to move the black ball', W / 2, H - 40);
    }
    ctx.restore();
  }

  // ---------- loop ----------
  let last = performance.now();
  let acc = 0;
  let raf = 0;

  function reportTime() {
    const s = timeLeft.toFixed(1);
    if (s !== shownTime) {
      shownTime = s;
      cb.onTime(timeLeft);
    }
  }

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    acc += dt;
    while (acc >= STEP) {
      step(STEP);
      acc -= STEP;
    }

    if (playing && started) {
      timeLeft = Math.max(0, timeLeft - dt);
      shot.sinceLast += dt;
      reportTime();
      if (timeLeft === 0) {
        playing = false;
        drag = null;
        blip(392, 0.3, 0.2, 'triangle', -150);
        cb.onEnd(score);
      }
    }
    (Object.keys(wallFlash) as WallId[]).forEach((k) => (wallFlash[k] *= Math.exp(-5 * dt)));
    shake *= Math.exp(-12 * dt);
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 500 * dt;
      p.life -= dt * 1.5;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const p of popups) p.life -= dt * 1.2;
    popups = popups.filter((p) => p.life > 0);

    draw(now);
    raf = requestAnimationFrame(frame);
  }

  // ---------- input ----------
  function pt(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }
  function setDragTarget(e: PointerEvent) {
    if (!drag) return;
    const p = pt(e);
    // the target may sit slightly inside a wall so the ball can be squashed against it,
    // but it can't be dragged out through the opening
    const m = striker.r * 0.55;
    drag.tx = Math.max(L + m, Math.min(R - m, p.x + drag.ox));
    drag.ty = Math.max(T + striker.r, Math.min(B - m, p.y + drag.oy));
  }
  function onDown(e: PointerEvent) {
    if (!playing) return;
    initAudio();
    const p = pt(e);
    drag = { ox: striker.x - p.x, oy: striker.y - p.y, tx: striker.x, ty: striker.y };
    started = true;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  }
  function onMove(e: PointerEvent) {
    setDragTarget(e);
  }
  function onUp() {
    // the ball keeps whatever speed it had, so a flick still throws it
    drag = null;
    canvas.style.cursor = 'grab';
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  window.addEventListener('resize', resize);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    start() {
      initAudio();
      score = 0;
      timeLeft = ROUND_TIME;
      started = false;
      drag = null;
      shot = { wallBounces: 0, streak: 0, sinceLast: 0 };
      particles = [];
      popups = [];
      resetStriker();
      respawnTarget();
      cb.onScore(0);
      reportTime();
      playing = true;
    },
    destroy() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', resize);
      if (ac) void ac.close();
    },
  };
}
