import * as Astronomy from 'astronomy-engine';

const POLARIS_RA_HOURS = 2.530301028;

/** Polaris hour angle (0–24 h) from Local Sidereal Time = its clock position around the pole. */
export function polarisHourAngle(lstHours: number): number {
  return (((lstHours - POLARIS_RA_HOURS) % 24) + 24) % 24;
}
const POLARIS_DEC_DEG = 89.264109444;
const POLARIS_DIST_LY = 433;
const DARK_SUN_ALT = -18;

let polarisDefined = false;
function ensurePolaris(): void {
  if (!polarisDefined) {
    Astronomy.DefineStar(
      Astronomy.Body.Star1,
      POLARIS_RA_HOURS,
      POLARIS_DEC_DEG,
      POLARIS_DIST_LY,
    );
    polarisDefined = true;
  }
}

const deg2rad = (d: number): number => (d * Math.PI) / 180;
const rad2deg = (r: number): number => (r * 180) / Math.PI;
const norm180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

export type Sky = {
  lstHours: number;
  polarisAlt: number;
  polarisAz: number;
  poleAlt: number;
  poleAz: number;
  driftDeg: number;
  driftPA: number;
};

export function computeSky(
  latitude: number,
  longitude: number,
  date: Date,
): Sky {
  ensurePolaris();
  const observer = new Astronomy.Observer(latitude, longitude, 0);
  const lstHours = Astronomy.SiderealTime(date);

  const eq = Astronomy.Equator(Astronomy.Body.Star1, date, observer, true, true);
  const hor = Astronomy.Horizon(date, observer, eq.ra, eq.dec, 'normal');
  const pole = Astronomy.Horizon(date, observer, 0, 90, 'normal');

  const driftDeg = 90 - eq.dec;
  const east = norm180(hor.azimuth - pole.azimuth) * Math.cos(deg2rad(pole.altitude));
  const up = hor.altitude - pole.altitude;
  let driftPA = rad2deg(Math.atan2(east, up));
  if (driftPA < 0) driftPA += 360;

  return {
    lstHours,
    polarisAlt: hor.altitude,
    polarisAz: hor.azimuth,
    poleAlt: pole.altitude,
    poleAz: pole.azimuth,
    driftDeg,
    driftPA,
  };
}

/** Unit vector (east, up) tangent to Polaris' orbit — the direction it is heading. */
export function driftTangent(
  latitude: number,
  longitude: number,
  date: Date,
): { east: number; up: number } {
  // Numérico a propósito: el signo de la tangente depende del hemisferio y de la
  // convención de `driftPA`, y saldría mal si se deduce «a ojo».
  const a = computeSky(latitude, longitude, date);
  const b = computeSky(latitude, longitude, new Date(date.getTime() + 3600 * 1000));
  const radius = (s: Sky) => {
    const pa = deg2rad(s.driftPA);
    return { x: s.driftDeg * Math.sin(pa), y: s.driftDeg * Math.cos(pa) };
  };
  const ra = radius(a);
  const rb = radius(b);
  const dx = rb.x - ra.x;
  const dy = rb.y - ra.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len === 0) return { east: 0, up: 1 };
  return { east: dx / len, up: dy / len };
}

export type Darkness = {
  sunAlt: number;
  isDark: boolean;
  from: Date | null;
  until: Date | null;
};

export function darkness(
  latitude: number,
  longitude: number,
  date: Date,
): Darkness {
  const observer = new Astronomy.Observer(latitude, longitude, 0);
  const eq = Astronomy.Equator(Astronomy.Body.Sun, date, observer, true, true);
  const hor = Astronomy.Horizon(date, observer, eq.ra, eq.dec, 'normal');
  const sunAlt = hor.altitude;
  const isDark = sunAlt < DARK_SUN_ALT;

  const fromStart = isDark ? new Date(date.getTime() - 24 * 3600 * 1000) : date;
  const from = Astronomy.SearchAltitude(
    Astronomy.Body.Sun,
    observer,
    -1,
    fromStart,
    2,
    DARK_SUN_ALT,
  );
  const until = Astronomy.SearchAltitude(
    Astronomy.Body.Sun,
    observer,
    1,
    date,
    2,
    DARK_SUN_ALT,
  );

  return {
    sunAlt,
    isDark,
    from: from ? from.date : null,
    until: until ? until.date : null,
  };
}

export function selfCheck(): void {
  const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;
  const lat = 40.4;
  const lon = -3.7;
  const date = new Date('2026-01-15T22:00:00Z');

  const sky = computeSky(lat, lon, date);
  // De fecha: Polaris se acerca al polo, así que hoy (~2026) son ~0.62°, no los 0.736° de J2000.
  console.assert(sky.driftDeg > 0.4 && sky.driftDeg < 0.9, `driftDeg = ${sky.driftDeg}`);

  const t = driftTangent(lat, lon, date);
  const norm = Math.hypot(t.east, t.up);
  console.assert(near(norm, 1, 1e-9), `tangent norm = ${norm}`);

  // La tangente es la cuerda de 1 h: perpendicular al radio en el punto MEDIO del intervalo.
  const mid = computeSky(lat, lon, new Date(date.getTime() + 1800 * 1000));
  const pa = deg2rad(mid.driftPA);
  const radial = { x: Math.sin(pa), y: Math.cos(pa) };
  const dot = t.east * radial.x + t.up * radial.y;
  // Tolerancia de 1e-3: la órbita no es un círculo perfecto y el radio se aleja algo en 1 h.
  console.assert(near(dot, 0, 1e-3), `tangent·radius = ${dot}`);

  const later = driftTangent(lat, lon, new Date(date.getTime() + 6 * 3600 * 1000));
  console.assert(
    !near(later.east, t.east, 1e-3) || !near(later.up, t.up, 1e-3),
    `tangent does not vary: ${t.east},${t.up} vs ${later.east},${later.up}`,
  );

  console.log('astro.selfCheck: ok');
}
