import { Rotation_EQJ_EQD } from 'astronomy-engine';

import { altAzOf, skyOffset, type SkyStar } from './astrometry';
import { CATALOG } from './catalog';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const N = CATALOG.length / 3;

let cache: { bucket: number; data: Float64Array } | null = null;

/**
 * Precess the J2000 catalog to the equinox of `date` (RA hours, Dec deg, mag),
 * flat triples. Cached for 30 s (precession drifts ~50″/year, so this is ample).
 */
export function ofDateCatalog(date: Date): Float64Array {
  const bucket = Math.floor(date.getTime() / 30000);
  if (cache && cache.bucket === bucket) return cache.data;

  const m = Rotation_EQJ_EQD(date).rot;
  const out = new Float64Array(N * 3);
  for (let i = 0; i < N; i++) {
    const ra = CATALOG[i * 3] * 15 * D2R;
    const dec = CATALOG[i * 3 + 1] * D2R;
    const cd = Math.cos(dec);
    const x = cd * Math.cos(ra);
    const y = cd * Math.sin(ra);
    const z = Math.sin(dec);
    const X = m[0][0] * x + m[0][1] * y + m[0][2] * z;
    const Y = m[1][0] * x + m[1][1] * y + m[1][2] * z;
    const Z = m[2][0] * x + m[2][1] * y + m[2][2] * z;
    let raH = (Math.atan2(Y, X) * R2D) / 15;
    raH = ((raH % 24) + 24) % 24;
    out[i * 3] = raH;
    out[i * 3 + 1] = Math.asin(Math.max(-1, Math.min(1, Z))) * R2D;
    out[i * 3 + 2] = CATALOG[i * 3 + 2];
  }
  cache = { bucket, data: out };
  return out;
}

/**
 * Catalog stars (of-date) within `maxDeg` of the given boresight, as sky
 * offsets relative to it. `magLimit` keeps only stars a phone can see.
 */
export function predictField(
  ofDate: Float64Array,
  latDeg: number,
  lstHours: number,
  attAz: number,
  attAlt: number,
  maxDeg: number,
  magLimit: number,
): SkyStar[] {
  const res: SkyStar[] = [];
  const m2 = maxDeg * maxDeg;
  for (let i = 0; i < ofDate.length; i += 3) {
    const mag = ofDate[i + 2];
    if (mag > magLimit) continue;
    const { az, alt } = altAzOf(ofDate[i], ofDate[i + 1], latDeg, lstHours);
    const o = skyOffset(az, alt, attAz, attAlt);
    // The catalog index rides along so callers can look the star's name up in NAMES[].
    if (o.e * o.e + o.u * o.u <= m2) res.push({ e: o.e, u: o.u, mag, index: i / 3 });
  }
  return res;
}
