/**
 * La instrucción hablada de la guía: qué decir y cuándo. Pura —sin `expo-speech`
 * ni `react-native`— para que node la importe desde `scripts/selfcheck.mjs`.
 */

export type Words = {
  up: string;
  down: string;
  left: string;
  right: string;
  fast: string;
  slow: string;
  locked: string;
};

/** Correction in SCREEN axes (already rolled): `up`/`right` > 0 mean move the mount up/right. */
export type FixIn = { up: number; right: number; mag: number; tol: number; locked: boolean };

export type Phrase = {
  dir: 'up' | 'down' | 'left' | 'right' | '';
  rate: 'fast' | 'slow' | '';
  say: string;
};

/** One instruction at a time: the mount has two screws and the user moves one per turn. */
export function phraseFor(f: FixIn, w: Words): Phrase | null {
  if (!(f.tol > 0)) return null;
  if (![f.up, f.right, f.mag].every(Number.isFinite)) return null;
  if (f.locked) return { dir: '', rate: '', say: w.locked };

  const useV = Math.abs(f.up) >= Math.abs(f.right);
  const v = useV ? f.up : f.right;
  if (Math.abs(v) <= f.tol) return null; // dentro de tolerancia: silencio

  const dir: Phrase['dir'] = useV
    ? v > 0
      ? 'up'
      : 'down'
    : v > 0
      ? 'right'
      : 'left';
  const ratio = f.mag / f.tol;
  const rate: Phrase['rate'] = ratio > 6 ? 'fast' : ratio < 2 ? 'slow' : '';
  const dirWord = dir === 'up' ? w.up : dir === 'down' ? w.down : dir === 'right' ? w.right : w.left;
  const rateWord = rate === 'fast' ? w.fast : rate === 'slow' ? w.slow : '';
  return { dir, rate, say: [dirWord, rateWord].filter(Boolean).join(', ') };
}

/** Throttle: never repeat the same words closer than 6 s; a change waits 2.5 s. */
export function allowSpeak(
  nowMs: number,
  say: string,
  st: { lastAt: number; lastSay: string },
): boolean {
  if (!say || !Number.isFinite(nowMs)) return false;
  if (st.lastAt === 0) return true;
  const same = say === st.lastSay;
  return nowMs - st.lastAt >= (same ? 6000 : 2500);
}

export function selfCheck(): void {
  const w: Words = {
    up: 'sube',
    down: 'baja',
    left: 'izquierda',
    right: 'derecha',
    fast: 'rápido',
    slow: 'suave',
    locked: 'para, centrado',
  };
  const base = { mag: 5, tol: 0.5, locked: false };

  const a = phraseFor({ up: 0.9, right: 0.2, ...base }, w);
  console.assert(a?.dir === 'up', `dominant axis = ${a?.dir}`);
  const b = phraseFor({ up: -0.9, right: -0.2, ...base }, w);
  console.assert(b?.dir === 'down', `negative up = ${b?.dir}`);
  const c = phraseFor({ up: 0.2, right: -0.9, ...base }, w);
  console.assert(c?.dir === 'left', `dominant right = ${c?.dir}`);

  console.assert(phraseFor({ up: 5, right: 0, mag: 5, tol: 0.5, locked: false }, w)?.rate === 'fast', 'ratio 10 fast');
  console.assert(phraseFor({ up: 0.75, right: 0, mag: 0.75, tol: 0.5, locked: false }, w)?.rate === 'slow', 'ratio 1.5 slow');
  console.assert(phraseFor({ up: 2, right: 0, mag: 2, tol: 0.5, locked: false }, w)?.rate === '', 'ratio 4 no rate');

  const locked = phraseFor({ up: 0, right: 0, mag: 0, tol: 0.5, locked: true }, w);
  console.assert(locked?.say === w.locked, `locked = ${locked?.say}`);
  console.assert(phraseFor({ up: 1, right: 1, mag: 1, tol: 0, locked: false }, w) === null, 'tol 0 is null');
  console.assert(
    phraseFor({ up: 0.4, right: 0, mag: 0.4, tol: 0.5, locked: false }, w) === null,
    'inside tolerance is silent',
  );
  console.assert(
    phraseFor({ up: NaN, right: 0, mag: 1, tol: 0.5, locked: false }, w) === null,
    'NaN is null',
  );
  console.assert(
    phraseFor({ up: 5, right: 0, mag: 5, tol: 0.5, locked: false }, w)?.say === 'sube, rápido',
    'phrase text',
  );

  const st = { lastAt: 1000, lastSay: 'sube' };
  console.assert(!allowSpeak(2000, 'sube', st), 'same phrase too soon');
  console.assert(allowSpeak(7100, 'sube', st), 'same phrase after 6 s');
  console.assert(allowSpeak(3600, 'baja', st), 'new phrase after 2.5 s');
  console.assert(!allowSpeak(3400, 'baja', st), 'new phrase too soon');
  console.assert(!allowSpeak(9999, '', st), 'empty phrase');
  console.assert(allowSpeak(1, 'sube', { lastAt: 0, lastSay: '' }), 'first phrase always allowed');

  console.log('voice.selfCheck: ok');
}
