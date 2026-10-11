// Photographic 1/3-EV ladders for the manual ISO / shutter selectors, clipped to the
// range the chosen camera reports (Camera2 SENSOR_INFO_SENSITIVITY_RANGE and
// SENSOR_INFO_EXPOSURE_TIME_RANGE).

/** ISO third stops, 6 … 25600. */
const ISO_LADDER = [
  6, 8, 10, 12, 16, 20, 25, 32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800,
  1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600,
];

/** Shutter third stops in seconds, 1/8000 … 8 s. */
const SHUTTER_LADDER = [
  1 / 8000, 1 / 6400, 1 / 5000, 1 / 4000, 1 / 3200, 1 / 2500, 1 / 2000, 1 / 1600, 1 / 1250,
  1 / 1000, 1 / 800, 1 / 640, 1 / 500, 1 / 400, 1 / 320, 1 / 250, 1 / 200, 1 / 160, 1 / 125,
  1 / 100, 1 / 80, 1 / 60, 1 / 50, 1 / 40, 1 / 30, 1 / 25, 1 / 20, 1 / 15, 1 / 13, 1 / 10, 1 / 8,
  1 / 6, 1 / 5, 1 / 4, 1 / 3, 1 / 2.5, 1 / 2, 1 / 1.6, 1 / 1.3, 1, 1.3, 1.6, 2, 2.5, 3.2, 4, 5,
  6.4, 8,
];

/** `ladder` entries inside [min, max]; an empty/inverted range falls back to the whole ladder. */
export function stops(ladder: number[], min: number, max: number): number[] {
  if (min > 0 && max > min) return ladder.filter((v) => v >= min && v <= max);
  return ladder;
}

export const isoStops = (minIso: number, maxIso: number): number[] => stops(ISO_LADDER, minIso, maxIso);

/** `LensInfo.exposureTimeRangeNs` is in nanoseconds; the ladder is in seconds. */
export const shutterStops = (minNs: number, maxNs: number): number[] =>
  stops(SHUTTER_LADDER, minNs / 1e9, maxNs / 1e9);

/** `1/250` for fractions of a second, `2s` above one, `Auto` for 0 (the "no manual value" sentinel). */
export function formatShutter(sec: number): string {
  if (sec <= 0) return 'Auto';
  if (sec >= 1) return `${Math.round(sec * 10) / 10}s`;
  return `1/${Math.round(1 / sec)}`;
}

/** Assert-based self-check; run by `npm test` (scripts/selfcheck.mjs). */
export function selfCheck(): void {
  const iso = isoStops(100, 800);
  console.assert(
    iso[0] === 100 && iso[iso.length - 1] === 800 && iso.length === 10,
    'isoStops(100,800)',
    iso.join(','),
  );
  console.assert(isoStops(0, 0).length === ISO_LADDER.length, 'isoStops: no range must keep all stops');

  const sh = shutterStops(1e6, 0.5e9); // 1 ms … 0.5 s
  console.assert(
    sh[0] === 1 / 1000 && sh[sh.length - 1] === 1 / 2,
    'shutterStops bounds',
    sh[0],
    sh[sh.length - 1],
  );
  console.assert(
    sh.every((v, i) => i === 0 || v > sh[i - 1]),
    'shutterStops must ascend',
  );
  console.assert(shutterStops(0, 0).length === SHUTTER_LADDER.length, 'shutterStops: no range');

  console.assert(formatShutter(1 / 250) === '1/250', 'formatShutter(1/250)', formatShutter(1 / 250));
  console.assert(formatShutter(2) === '2s' && formatShutter(0) === 'Auto', 'formatShutter');

  console.log('stops.selfCheck: ok');
}
