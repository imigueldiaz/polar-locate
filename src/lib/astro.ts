import * as Astronomy from 'astronomy-engine';

const POLARIS_RA_HOURS = 2.530301028;
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
