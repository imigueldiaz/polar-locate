// Initial exposure metering: from the calibration frames, pick the ISO/shutter pair (photographic
// thirds) that leaves the star field bright enough to detect without blowing it out.
//
// We cannot read what the phone's own AE chose (CameraX does not expose CaptureResult), so the
// meter works on the analysis frames the module already sends: P99 luminance is the bright end
// (stars) and the clipped fraction catches saturation.

export type FrameStats = {
  /** 99th percentile luminance (0-255) — the stars. */
  p99: number;
  /** Median luminance — the sky background. */
  median: number;
  /** Fraction of pixels at 254/255. */
  clipped: number;
};

/** What we aim the stars at: bright enough for `brightestBlobs`, well short of saturation. */
export const TARGET_P99 = 200;
const BAND = 25; // no correction while p99 sits inside TARGET_P99 ± BAND
const MAX_CLIPPED = 0.005;
const MAX_JUMP = 6; // one correction never moves more than 6 thirds (x4 in light)

export function frameStats(gray: Uint8Array): FrameStats {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]] += 1;
  const n = gray.length || 1;
  let acc = 0;
  let p99 = -1;
  let median = -1;
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v];
    if (median < 0 && acc * 2 >= n) median = v;
    if (p99 < 0 && acc >= n * 0.99) p99 = v;
  }
  return {
    p99: p99 < 0 ? 0 : p99,
    median: median < 0 ? 0 : median,
    clipped: (hist[254] + hist[255]) / n,
  };
}

/** Coarse, normalised (0..1) luminance histogram for the panel strip. */
export function histogram(gray: Uint8Array, bins = 32): number[] {
  const out = new Array<number>(Math.max(1, bins)).fill(0);
  if (!gray.length) return out;
  const n = out.length;
  for (let i = 0; i < gray.length; i += 1) out[Math.min(n - 1, (gray[i] * n) >> 8)] += 1;
  let max = 0;
  for (const v of out) if (v > max) max = v;
  return max ? out.map((v) => v / max) : out;
}

/** Thirds to apply: positive = more light, negative = less. Zero inside the target band. */
export function thirdsFor(stats: FrameStats, maxJump: number = MAX_JUMP): number {
  if (stats.clipped > MAX_CLIPPED) return -1;
  if (Math.abs(TARGET_P99 - stats.p99) <= BAND) return 0;
  // A third of a stop is a factor of 2^(1/3), so thirds = 3·log2(target/actual).
  const thirds = Math.round(Math.log2(TARGET_P99 / Math.max(stats.p99, 1)) * 3);
  return Math.max(-maxJump, Math.min(maxJump, thirds));
}

/** Nearest ladder index; the ladders are short so a linear scan is plenty. */
function nearest(values: number[], value: number): number {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (Math.abs(values[i] - value) < Math.abs(values[best] - value)) best = i;
  }
  return best;
}

/**
 * Applies `thirds` to the pair. `prefer` says which ladder takes the move first and which one only
 * gets the leftover stops: 'shutter' (less noise) for corrections, 'iso' (shorter exposure, less
 * smear in the CV) for the initial measurement. Values come from the ladders, so the result is
 * always a real third stop of the chosen camera.
 */
export function nextSettings(
  isoLadder: number[],
  shutterLadder: number[],
  iso: number,
  exposureSec: number,
  thirds: number,
  prefer: 'shutter' | 'iso' = 'shutter',
): { iso: number; exposureSec: number } {
  if (thirds === 0 || !isoLadder.length || !shutterLadder.length) return { iso, exposureSec };
  const first = prefer === 'iso' ? isoLadder : shutterLadder;
  const second = prefer === 'iso' ? shutterLadder : isoLadder;
  const from = prefer === 'iso' ? iso : exposureSec;
  const rest = prefer === 'iso' ? exposureSec : iso;
  const wanted = nearest(first, from) + thirds;
  const clamped = Math.max(0, Math.min(first.length - 1, wanted));
  const leftOver = wanted - clamped;
  const moved = first[clamped];
  const index = Math.max(0, Math.min(second.length - 1, nearest(second, rest) + leftOver));
  const other = second[index];
  return prefer === 'iso'
    ? { iso: moved, exposureSec: other }
    : { iso: other, exposureSec: moved };
}

/**
 * One-shot measurement for the initial calibration: from the frames' brightness, start at the
 * fastest shutter and the lowest ISO and climb ISO first, so the result keeps the exposure short
 * (a long exposure smears the star the CV is trying to centre). `null` when the camera gave no
 * ladders. The ladders clamp the result, so no resolution is lost to a jump bound.
 */
export function initialSettings(
  stats: FrameStats,
  isoLadder: number[],
  shutterLadder: number[],
): { iso: number; exposureSec: number } | null {
  if (!isoLadder.length || !shutterLadder.length) return null;
  return nextSettings(isoLadder, shutterLadder, isoLadder[0], shutterLadder[0], thirdsFor(stats, 99), 'iso');
}

/** Assert-based self-check; run by `npm test` (scripts/selfcheck.mjs). */
export function selfCheck(): void {
  const mostlyDark = new Uint8Array(100); // 90 zeros + 10 pixels at 200 → p99 = 200
  for (let i = 0; i < 10; i += 1) mostlyDark[i] = 200;
  const s1 = frameStats(mostlyDark);
  console.assert(s1.p99 === 200, 'frameStats p99', s1.p99);
  console.assert(s1.median === 0, 'frameStats median', s1.median);
  console.assert(s1.clipped === 0, 'frameStats clipped', s1.clipped);

  const blown = new Uint8Array(1000).fill(255);
  console.assert(frameStats(blown).clipped === 1, 'frameStats all-clipped');
  console.assert(thirdsFor(frameStats(blown)) === -1, 'thirdsFor clipped');

  const band = { p99: TARGET_P99, median: 20, clipped: 0 };
  console.assert(thirdsFor(band) === 0, 'thirdsFor inside band');
  console.assert(thirdsFor({ p99: 50, median: 10, clipped: 0 }) === 6, 'thirdsFor dark → +6');
  console.assert(thirdsFor({ p99: 100, median: 10, clipped: 0 }) === 3, 'thirdsFor −1 stop');

  const iso = [100, 200, 400];
  const sh = [1 / 30, 1 / 25, 1 / 20];
  // Shutter room available → only the shutter moves.
  console.assert(
    JSON.stringify(nextSettings(iso, sh, 100, 1 / 30, 1)) ===
      JSON.stringify({ iso: 100, exposureSec: 1 / 25 }),
    'nextSettings shutter step',
  );
  // Shutter at its end → the rest goes to ISO.
  console.assert(
    JSON.stringify(nextSettings(iso, sh, 100, 1 / 20, 1)) ===
      JSON.stringify({ iso: 200, exposureSec: 1 / 20 }),
    'nextSettings overflow to ISO',
  );
  console.assert(
    JSON.stringify(nextSettings(iso, sh, 100, 1 / 20, 3)) ===
      JSON.stringify({ iso: 400, exposureSec: 1 / 20 }),
    'nextSettings clamps at the ladder ends',
  );
  // Preferring ISO keeps the shutter short.
  console.assert(
    JSON.stringify(nextSettings(iso, sh, 100, 1 / 30, 1, 'iso')) ===
      JSON.stringify({ iso: 200, exposureSec: 1 / 30 }),
    'nextSettings prefer iso',
  );

  const dark = { p99: 100, median: 10, clipped: 0 };
  console.assert(
    JSON.stringify(initialSettings(dark, iso, sh)) === JSON.stringify({ iso: 400, exposureSec: 1 / 25 }),
    'initialSettings climbs ISO first',
  );
  console.assert(initialSettings(dark, [], sh) === null, 'initialSettings without ladders');

  const hist = histogram(new Uint8Array([0, 0, 255, 255]));
  console.assert(hist.length === 32, 'histogram bins', hist.length);
  console.assert(hist[0] === 1 && hist[31] === 1, 'histogram edges', hist[0], hist[31]);
  console.assert(hist[15] === 0, 'histogram empty middle', hist[15]);
  console.assert(histogram(new Uint8Array(0)).length === 32, 'histogram empty frame');
  console.assert(
    histogram(new Uint8Array(4), 8)[0] === 1 &&
      histogram(new Uint8Array(4), 8)
        .slice(1)
        .every((v) => v === 0),
    'histogram flat (all mass in bin 0)',
  );

  console.log('meter.selfCheck: ok');
}
