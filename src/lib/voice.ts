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
  speed: string;
  /** Tornillo de azimut de la base. */
  screw: string;
  screwAlt: string;
  dec: string;
};

/** Correction in SCREEN axes (already rolled): `up`/`right` > 0 mean move the mount up/right. */
export type FixIn = {
  up: number;
  right: number;
  mag: number;
  tol: number;
  locked: boolean;
  /** Visión por computador: `mag` es una fracción del radio, no grados → sin velocidad. */
  cv?: boolean;
};

export type Phrase = {
  dir: 'up' | 'down' | 'left' | 'right' | '';
  rate: 'fast' | 'slow' | '';
  /** Botón que corrige: eje DEC de la montura, o el tornillo de la base. */
  control: 'dec' | 'screwAz' | 'screwAlt' | null;
  /** Rate de SynScan (0–9) que conviene pulsar; null sin eje DEC (CV o tornillo). */
  synscan: number | null;
  /** Grados (o fracción del radio en CV) del error que corrige ese control. */
  amount: number;
  say: string;
};

/** Dirección de la puntería en la que DEC+ mueve: ejes (este, altitud). */
export type DecDir = { right: number; up: number };

/**
 * Velocidad de SynScan en °/s para los rates 0…9 (múltiplos de 15,04″/s; el 9 es el
 * máximo de la montura, ≈3,4 °/s en una GTi). Tabla de los manuales SynScan V4/V5.
 */
export const SYNSCAN_DEG_S = [0.0021, 0.0042, 0.033, 0.067, 0.133, 0.267, 0.533, 1.67, 2.5, 3.4];
/** Segundos de pulsación que queremos para cubrir el error de una vez. */
const HOLD_S = 1.2;

/** Rate de SynScan que cubre `mag` grados en ~HOLD_S s sin pasarse de largo. */
export function synscanRate(mag: number): number {
  const want = Math.abs(mag) / HOLD_S;
  for (let r = SYNSCAN_DEG_S.length - 1; r >= 0; r--) {
    if (SYNSCAN_DEG_S[r] <= want) return r;
  }
  return 0;
}

const norm180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * Dirección en la que DEC+ mueve la puntería, a partir de dos muestras del ERROR (no del
 * pointing). Con la cámara al polo DEC mueve 1:1, pero en qué dirección del plano tangente
 * depende de la AR y del montaje, así que no se puede deducir: se mide.
 */
export function decDirFrom(
  before: { right: number; up: number },
  after: { right: number; up: number },
  minDeg = 0.5,
): DecDir | null {
  if (![before.right, before.up, after.right, after.up].every(Number.isFinite)) return null;
  let dRight = after.right - before.right;
  if (Math.abs(dRight) > 180) dRight = norm180(dRight); // el error de acimut cruza el norte
  const dUp = after.up - before.up;
  const len = Math.hypot(dRight, dUp);
  if (!(len >= minDeg)) return null;
  // El pointing se movió -(after-before): el error disminuye en la dirección en que se movió.
  return { right: -dRight / len, up: -dUp / len };
}

const dirOf = (right: number, up: number): Phrase['dir'] =>
  Math.abs(up) >= Math.abs(right) ? (up > 0 ? 'up' : 'down') : right > 0 ? 'right' : 'left';

/**
 * One instruction at a time: the mount has two screws and the user moves one per turn.
 * `decDir` es la dirección calibrada de DEC+; sin ella sólo se puede dar la velocidad.
 */
export function phraseFor(f: FixIn, w: Words, decDir?: DecDir | null): Phrase | null {
  if (![f.up, f.right, f.mag].every(Number.isFinite) || !(f.tol > 0)) return null;
  if (f.locked) {
    return { dir: '', rate: '', control: null, synscan: null, amount: f.mag, say: w.locked };
  }

  const sensors = f.cv !== true;
  const ratio = f.mag / f.tol;
  const rate: Phrase['rate'] = ratio > 6 ? 'fast' : ratio < 2 ? 'slow' : '';
  const rateWord = rate === 'fast' ? w.fast : rate === 'slow' ? w.slow : '';
  const say = (dir: Phrase['dir'], how: string) =>
    [dir === 'up' ? w.up : dir === 'down' ? w.down : dir === 'right' ? w.right : w.left, rateWord, how]
      .filter(Boolean)
      .join(', ');

  // Con la calibración, el error se parte en lo que DEC+ corrige y lo que queda para el tornillo.
  if (sensors && decDir && Number.isFinite(decDir.right) && Number.isFinite(decDir.up)) {
    const n = Math.hypot(decDir.right, decDir.up);
    if (n > 0) {
      const d = { right: decDir.right / n, up: decDir.up / n };
      const along = f.right * d.right + f.up * d.up;
      const across = { right: f.right - along * d.right, up: f.up - along * d.up };
      if (Math.abs(along) >= Math.hypot(across.right, across.up)) {
        const amount = Math.abs(along);
        if (amount <= f.tol) return null; // dentro de tolerancia: silencio
        const dir = dirOf(along * d.right, along * d.up);
        const synscan = synscanRate(amount);
        return {
          dir,
          rate,
          control: 'dec',
          synscan,
          amount,
          say: say(dir, `${w.dec}, ${w.speed} ${synscan}`),
        };
      }
      const amount = Math.hypot(across.right, across.up);
      if (amount <= f.tol) return null;
      const dir = dirOf(across.right, across.up);
      const control = Math.abs(across.right) >= Math.abs(across.up) ? 'screwAz' : 'screwAlt';
      return {
        dir,
        rate,
        control,
        synscan: null,
        amount,
        say: say(dir, control === 'screwAz' ? w.screw : w.screwAlt),
      };
    }
  }

  // Sin calibración (o en la rama CV) sólo se sabe el eje: vertical ≈ eje DEC, horizontal ≈ tornillo.
  const useV = Math.abs(f.up) >= Math.abs(f.right);
  const v = useV ? f.up : f.right;
  if (Math.abs(v) <= f.tol) return null; // dentro de tolerancia: silencio
  const dir = dirOf(f.right, f.up);
  const control: Phrase['control'] = !sensors ? null : useV ? 'dec' : 'screwAz';
  const synscan = sensors && useV ? synscanRate(f.mag) : null;
  const how = !sensors ? '' : useV ? `${w.dec}, ${w.speed} ${synscan}` : w.screw;
  return { dir, rate, control, synscan, amount: f.mag, say: say(dir, how) };
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
    speed: 'velocidad',
    screw: 'tornillo de azimut',
    screwAlt: 'tornillo de altitud',
    dec: 'eje DEC',
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
    phraseFor({ up: 5, right: 0, mag: 5, tol: 0.5, locked: false }, w)?.say ===
      'sube, rápido, eje DEC, velocidad 9',
    'phrase text',
  );

  // Rate de SynScan: el que cubre el error en ~1,2 s sin pasarse.
  console.assert(synscanRate(4) === 8, `rate at 4° = ${synscanRate(4)}`);
  console.assert(synscanRate(1) === 6, `rate at 1° = ${synscanRate(1)}`);
  console.assert(synscanRate(0.1) === 3, `rate at 0.1° = ${synscanRate(0.1)}`);
  console.assert(synscanRate(0) === 0, `rate at 0° = ${synscanRate(0)}`);
  const az = phraseFor({ up: 0.2, right: -0.9, ...base }, w);
  console.assert(az?.control === 'screwAz' && az?.synscan === null, 'azimuth uses the screw');
  console.assert(az?.say === 'izquierda, rápido, tornillo de azimut', `azimuth text = ${az?.say}`);
  const cv = phraseFor({ up: 5, right: 0, mag: 5, tol: 0.5, locked: false, cv: true }, w);
  console.assert(cv?.control === null && cv?.synscan === null, 'CV names no control');
  console.assert(cv?.amount === 5, `CV amount = ${cv?.amount}`);

  // Calibración de DEC: el error baja 2° en altitud → DEC+ sube.
  const dd = decDirFrom({ right: 2, up: 2 }, { right: 2, up: 0 });
  console.assert(dd != null && Math.abs(dd.up - 1) < 1e-9 && Math.abs(dd.right) < 1e-9, `decDir up = ${dd?.up}`);
  console.assert(decDirFrom({ right: 0, up: 0 }, { right: 0.1, up: 0.1 }) === null, 'too little motion');
  console.assert(decDirFrom({ right: 0, up: NaN }, { right: 1, up: 1 }) === null, 'NaN samples');
  // Acimut cruzando el norte: 179,9° → −179,9° es moverse 0,2° al este, no 359,8° al oeste.
  const wrap = decDirFrom({ right: 179.9, up: 0 }, { right: -179.9, up: 1 });
  console.assert(wrap != null && wrap.up < -0.9, `wrap lands above = ${wrap?.up}`);

  const decUp = { right: 0, up: 1 };
  const onDec = phraseFor({ up: 5, right: 0, mag: 5, tol: 0.5, locked: false }, w, decUp);
  console.assert(onDec?.control === 'dec', `calibrated vertical = ${onDec?.control}`);
  console.assert(onDec?.amount === 5 && onDec?.synscan === synscanRate(5), 'calibrated amount/rate');
  console.assert(onDec?.say === 'sube, rápido, eje DEC, velocidad 9', `calibrated text = ${onDec?.say}`);

  // DEC+ hacia el este: no corrige la altitud (tornillo) pero sí el acimut.
  const decEast = { right: 1, up: 0 };
  const altErr = phraseFor({ up: 2, right: 0, mag: 2, tol: 0.5, locked: false }, w, decEast);
  console.assert(altErr?.control === 'screwAlt', `DEC east, alt error = ${altErr?.control}`);
  console.assert(altErr?.say === 'sube, tornillo de altitud', `alt screw text = ${altErr?.say}`);
  const azErr = phraseFor({ up: 0, right: 2, mag: 2, tol: 0.5, locked: false }, w, decEast);
  console.assert(azErr?.control === 'dec' && azErr?.amount === 2, 'DEC east fixes azimuth');
  console.assert(azErr?.dir === 'right', `DEC east direction = ${azErr?.dir}`);

  const st = { lastAt: 1000, lastSay: 'sube' };
  console.assert(!allowSpeak(2000, 'sube', st), 'same phrase too soon');
  console.assert(allowSpeak(7100, 'sube', st), 'same phrase after 6 s');
  console.assert(allowSpeak(3600, 'baja', st), 'new phrase after 2.5 s');
  console.assert(!allowSpeak(3400, 'baja', st), 'new phrase too soon');
  console.assert(!allowSpeak(9999, '', st), 'empty phrase');
  console.assert(allowSpeak(1, 'sube', { lastAt: 0, lastSay: '' }), 'first phrase always allowed');

  console.log('voice.selfCheck: ok');
}
