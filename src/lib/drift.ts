// Drift alignment: how fast the tracked star walks away, and which mount screw reacts to it.
//
// The classic method: a star near the east/west horizon moves if the ALTITUDE axis is off, one near
// the meridian (south/north) if the AZIMUTH axis is off. The sign of the mount's reaction depends on
// the mount, so the advice is "this screw, this much" and, if it gets worse, turn the other way.

export type Sample = {
  /** Milliseconds (Date.now()). */
  t: number;
  /** Centre-relative pixels on the frame; +x right, +y down. */
  x: number;
  y: number;
};

export type Slope = {
  /** Screen px per minute (+x right, +y down). */
  pxPerMinX: number;
  pxPerMinY: number;
  /** Length of the fitted window, in minutes. */
  minutes: number;
};

const ARROWS: Record<string, string> = {
  '0,-1': '\u2191',
  '0,1': '\u2193',
  '-1,0': '\u2190',
  '1,0': '\u2192',
  '-1,-1': '\u2196',
  '1,-1': '\u2197',
  '-1,1': '\u2199',
  '1,1': '\u2198',
};

/** Least-squares slope of x(t) and y(t); null when there is not enough data to mean anything. */
export function fitSlope(samples: Sample[], minMinutes = 0.75): Slope | null {
  if (samples.length < 8) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const minutes = (last.t - first.t) / 60000;
  if (!(minutes >= minMinutes)) return null;
  const n = samples.length;
  let mt = 0;
  let mx = 0;
  let my = 0;
  for (const s of samples) {
    mt += s.t;
    mx += s.x;
    my += s.y;
  }
  mt /= n;
  mx /= n;
  my /= n;
  let tt = 0;
  let tx = 0;
  let ty = 0;
  for (const s of samples) {
    const dt = s.t - mt;
    tt += dt * dt;
    tx += dt * (s.x - mx);
    ty += dt * (s.y - my);
  }
  if (!(tt > 0)) return null;
  return { pxPerMinX: (tx / tt) * 60000, pxPerMinY: (ty / tt) * 60000, minutes };
}

/** Total walk in arcmin per minute, from the frame's px-per-degree scale. */
export function arcminPerMin(slope: Slope, pxPerDeg: number): number | null {
  if (!(pxPerDeg > 0)) return null;
  return (Math.hypot(slope.pxPerMinX, slope.pxPerMinY) / pxPerDeg) * 60;
}

/** Arrow for the direction the star walks on screen; '' when it is not moving. */
export function arrow(slope: Slope, deadbandPx = 0.2): string {
  const x = Math.abs(slope.pxPerMinX) < deadbandPx ? 0 : Math.sign(slope.pxPerMinX);
  const y = Math.abs(slope.pxPerMinY) < deadbandPx ? 0 : Math.sign(slope.pxPerMinY);
  return ARROWS[`${x},${y}`] ?? '';
}

/** Which screw the drift reacts to, from where the camera is pointing. */
export function screwFor(azDeg: number): 'altitude' | 'azimuth' {
  const a = ((azDeg % 360) + 360) % 360;
  const eastWest = Math.min(Math.abs(a - 90), Math.abs(a - 270));
  return eastWest < 45 ? 'altitude' : 'azimuth';
}

/** Assert-based self-check; run by `npm test` (scripts/selfcheck.mjs). */
export function selfCheck(): void {
  const samples: Sample[] = [];
  for (let i = 0; i <= 20; i += 1) samples.push({ t: i * 6000, x: 20 + i, y: 60 - 3 * i });
  const s = fitSlope(samples, 1);
  console.assert(s !== null, 'fitSlope needs data');
  console.assert(!!s && Math.abs(s.pxPerMinX - 10) < 1e-9, 'fitSlope x', s && s.pxPerMinX);
  console.assert(!!s && Math.abs(s.pxPerMinY + 30) < 1e-9, 'fitSlope y', s && s.pxPerMinY);
  console.assert(!!s && Math.abs(s.minutes - 2) < 1e-9, 'fitSlope minutes', s && s.minutes);
  console.assert(fitSlope(samples.slice(0, 3), 1) === null, 'fitSlope too short');
  console.assert(fitSlope(samples, 5) === null, 'fitSlope window too short');
  console.assert(fitSlope([], 1) === null, 'fitSlope empty');

  const scale = arcminPerMin({ pxPerMinX: 10, pxPerMinY: -30, minutes: 2 }, 2);
  console.assert(
    scale !== null && Math.abs(scale - (Math.hypot(10, 30) / 2) * 60) < 1e-9,
    'arcminPerMin value',
    scale,
  );
  console.assert(arcminPerMin({ pxPerMinX: 1, pxPerMinY: 1, minutes: 2 }, 0) === null, 'arcminPerMin scale');

  console.assert(arrow({ pxPerMinX: 5, pxPerMinY: -3, minutes: 1 }) === '\u2197', 'arrow');
  console.assert(arrow({ pxPerMinX: 0.05, pxPerMinY: -0.05, minutes: 1 }) === '', 'arrow deadband');

  console.assert(screwFor(88) === 'altitude' && screwFor(270) === 'altitude', 'screwFor east/west');
  console.assert(screwFor(180) === 'azimuth' && screwFor(0) === 'azimuth', 'screwFor meridian');
  console.assert(screwFor(-90) === 'altitude', 'screwFor wraps');

  console.log('drift.selfCheck: ok');
}
