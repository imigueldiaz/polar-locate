// Sky brightness ("radiancia") of the user's own radiance API: VIIRS monthly composites,
// Spain only. PostgREST RPC, public read-only, per-IP rate limited (5 req/s, burst 10), so
// callers must cache and never poll per frame.
//
// Live shape for { lon_param, lat_param, product_filter: 'vcmslcfg' } (array of ONE object):
//   { elevation_m, radiance, sqm, bortle, bortle_class, mean_sqm, mean_bortle, year, month, product }

const ENDPOINT = 'https://radiance.ethicalcoding.zone/radiance/api/rpc/get_point_data';
/** Coverage of the dataset (Spain + margins); outside it the API has no row. */
const BBOX = { west: -12, south: 34, east: 5, north: 44.5 };

export type SkyInfo = {
  /** Continuous Bortle 1-9 as the API reports it. */
  bortle: number;
  /** Integer Bortle class 1-9. */
  bortleClass: number;
  /** Sky brightness in mag/arcsec². */
  sqm: number;
  /** VIIRS radiance in nW·cm⁻²·sr⁻¹. */
  radiance: number;
  /** SRTM elevation in metres. */
  elevationM: number;
  /** Composite year/month the value comes from. */
  year: number;
  month: number;
};

export function covers(lat: number, lon: number): boolean {
  return lat >= BBOX.south && lat <= BBOX.north && lon >= BBOX.west && lon <= BBOX.east;
}

/** The radiance project's own conversion: SQM = 21.58 − 2.5·log10(radiance). */
export function sqmFromRadiance(radiance: number): number | null {
  return radiance > 0 ? 21.58 - 2.5 * Math.log10(radiance) : null;
}

/** SQM (mag/arcsec²) → Bortle class 1-9, with the project's boundary table. */
const SQM_CLASS = [22, 21.89, 21.69, 20.49, 19.5, 18.94, 18, 17, 16];

export function bortleClassFromSqm(sqm: number): number {
  for (let i = 0; i < SQM_CLASS.length; i += 1) if (sqm >= SQM_CLASS[i]) return i + 1;
  return 9;
}

/** Row → `SkyInfo`; `null` when the API answered with no usable row. */
export function parseSky(rows: unknown): SkyInfo | null {
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const sqm = num(r.sqm) || sqmFromRadiance(num(r.radiance)) || 0;
  if (sqm <= 0) return null;
  return {
    bortle: Math.round(num(r.bortle) * 10) / 10,
    bortleClass: num(r.bortle_class) || bortleClassFromSqm(sqm),
    sqm: Math.round(sqm * 100) / 100,
    radiance: num(r.radiance),
    elevationM: num(r.elevation_m),
    year: num(r.year),
    month: num(r.month),
  };
}

/** One point query; throws on HTTP errors (the caller caches and backs off). */
export async function fetchSky(lon: number, lat: number): Promise<SkyInfo | null> {
  if (!covers(lat, lon)) return null;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Profile': 'api' },
    body: JSON.stringify({ lon_param: lon, lat_param: lat, product_filter: 'vcmslcfg' }),
  });
  if (!res.ok) throw new Error(`radiance HTTP ${res.status}`);
  return parseSky(await res.json());
}

/** Assert-based self-check; run by `npm test` (scripts/selfcheck.mjs). */
export function selfCheck(): void {
  console.assert(covers(40.4, -3.6) && !covers(48.8, 2.3), 'radiance covers');

  console.assert(sqmFromRadiance(1) === 21.58, 'sqmFromRadiance 1');
  console.assert(Math.abs((sqmFromRadiance(10) ?? 0) - 19.08) < 1e-9, 'sqmFromRadiance 10');
  console.assert(sqmFromRadiance(0) === null, 'sqmFromRadiance 0');

  console.assert(bortleClassFromSqm(22) === 1, 'bortle class 1');
  console.assert(bortleClassFromSqm(21.7) === 3, 'bortle class 3');
  console.assert(bortleClassFromSqm(17.26) === 8, 'bortle class 8');
  console.assert(bortleClassFromSqm(12) === 9, 'bortle class 9');

  // The exact row the live API returned for 40.4022 / -3.6295.
  const live = parseSky([
    {
      elevation_m: 689,
      radiance: 53.59000015258789,
      sqm: 17.26,
      bortle: 8.24,
      bortle_class: 9,
      year: 2026,
      month: 8,
      product: 'vcmslcfg',
    },
  ]);
  console.assert(live?.bortleClass === 9 && live?.sqm === 17.26, 'parseSky live row');
  console.assert(live?.elevationM === 689 && live?.year === 2026, 'parseSky live extras');
  console.assert(parseSky([]) === null && parseSky(null) === null, 'parseSky empty');
  // No `sqm` in the row: it must be derived from radiance.
  console.assert(parseSky([{ radiance: 10 }])?.sqm === 19.08, 'parseSky derives sqm');

  console.log('radiance.selfCheck: ok');
}
