export type Blob = { found: boolean; x: number; y: number; brightness: number };

/** Luma (BT.601) of an RGBA buffer → one byte per pixel. */
export function toGrayscale(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    gray[i] = (rgba[o] * 77 + rgba[o + 1] * 150 + rgba[o + 2] * 29) >> 8;
  }
  return gray;
}

/**
 * Element-wise mean of several equally sized grayscale frames (multi-frame
 * stacking): raises signal/noise so faint stars survive detection. Frames must
 * be pixel-aligned (static camera); mismatched lengths are skipped.
 */
export function stackFrames(frames: Uint8Array[]): Uint8Array {
  if (frames.length === 0) return new Uint8Array(0);
  const n = frames[0].length;
  const acc = new Float64Array(n);
  let used = 0;
  for (const f of frames) {
    if (f.length !== n) continue;
    for (let i = 0; i < n; i++) acc[i] += f[i];
    used++;
  }
  const out = new Uint8Array(n);
  if (used === 0) return out;
  for (let i = 0; i < n; i++) out[i] = Math.round(acc[i] / used);
  return out;
}

/**
 * Variance of the discrete Laplacian (a standard sharpness / focus metric):
 * high on crisp star edges, low on a blurred or uniform frame.
 */
export function laplacianVariance(gray: Uint8Array, width: number, height: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * Up to `n` brightest, well-separated star candidates (brightest first), each
 * with its intensity centroid. Ignores a border margin (vignette / UI).
 */
export function brightestBlobs(
  gray: Uint8Array,
  width: number,
  height: number,
  threshold = 0,
  n = 5,
): Blob[] {
  const margin = Math.max(2, Math.floor(Math.min(width, height) * 0.04));
  const win = Math.max(2, Math.floor(Math.min(width, height) * 0.06));
  const work = gray.slice();
  const out: Blob[] = [];

  for (let k = 0; k < n; k++) {
    let maxB = -1;
    let mx = -1;
    let my = -1;
    for (let y = margin; y < height - margin; y++) {
      const row = y * width;
      for (let x = margin; x < width - margin; x++) {
        const v = work[row + x];
        if (v > maxB) {
          maxB = v;
          mx = x;
          my = y;
        }
      }
    }
    if (maxB < threshold) break;

    const cut = maxB * 0.9;
    let sx = 0;
    let sy = 0;
    let c = 0;
    const y0 = Math.max(margin, my - win);
    const y1 = Math.min(height - margin, my + win + 1);
    const x0 = Math.max(margin, mx - win);
    const x1 = Math.min(width - margin, mx + win + 1);
    for (let y = y0; y < y1; y++) {
      const row = y * width;
      for (let x = x0; x < x1; x++) {
        if (work[row + x] >= cut) {
          sx += x;
          sy += y;
          c++;
        }
      }
    }
    out.push({ found: true, x: c ? sx / c : mx, y: c ? sy / c : my, brightness: maxB });

    for (let y = y0; y < y1; y++) {
      const row = y * width;
      for (let x = x0; x < x1; x++) work[row + x] = 0;
    }
  }
  return out;
}

/** Brightest star candidate + its centroid (single-star convenience wrapper). */
export function brightestBlob(
  gray: Uint8Array,
  width: number,
  height: number,
  threshold = 0,
): Blob {
  return (
    brightestBlobs(gray, width, height, threshold, 1)[0] ?? {
      found: false,
      x: width / 2,
      y: height / 2,
      brightness: 0,
    }
  );
}

/** Star position as an offset from the image (boresight) centre, normalised to half-extent. */
export function starOffset(
  x: number,
  y: number,
  width: number,
  height: number,
): { dx: number; dy: number } {
  return { dx: (x - width / 2) / (width / 2), dy: (y - height / 2) / (height / 2) };
}

export function selfCheck(): void {
  const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;
  const width = 40;
  const height = 30;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = 10;
    rgba[i * 4 + 1] = 10;
    rgba[i * 4 + 2] = 10;
    rgba[i * 4 + 3] = 255;
  }
  const put = (x: number, y: number, v: number) => {
    const o = (y * width + x) * 4;
    rgba[o] = v;
    rgba[o + 1] = v;
    rgba[o + 2] = v;
  };
  put(25, 12, 200);
  put(24, 12, 190);
  put(25, 11, 190);
  put(8, 20, 150);

  const gray = toGrayscale(rgba, width, height);
  console.assert(gray[12 * width + 25] === 200, `gray bright = ${gray[12 * width + 25]}`);

  const b = brightestBlob(gray, width, height, 60);
  console.assert(b.found, 'blob found');
  console.assert(near(b.x, 24.8, 0.35) && near(b.y, 11.8, 0.35), `centroid = ${b.x},${b.y}`);

  const many = brightestBlobs(gray, width, height, 60, 3);
  console.assert(many.length === 2, `blobs = ${many.length}`);
  console.assert(near(many[0].brightness, 200), `b0 mag = ${many[0].brightness}`);
  console.assert(near(many[1].x, 8, 0.35) && near(many[1].y, 20, 0.35), `b1 = ${many[1].x},${many[1].y}`);

  const miss = brightestBlob(gray, width, height, 250);
  console.assert(!miss.found, 'threshold rejects');

  const off = starOffset(25, 12, width, height);
  console.assert(near(off.dx, 0.25) && near(off.dy, -0.2), `offset = ${off.dx},${off.dy}`);

  const stacked = stackFrames([new Uint8Array([0, 100, 200, 40]), new Uint8Array([10, 100, 190, 60])]);
  console.assert(
    stacked[0] === 5 && stacked[1] === 100 && stacked[2] === 195 && stacked[3] === 50,
    `stack = ${stacked[0]},${stacked[1]},${stacked[2]},${stacked[3]}`,
  );

  const flat = new Uint8Array(20 * 20);
  console.assert(laplacianVariance(flat, 20, 20) === 0, 'lap flat=0');
  const edge = new Uint8Array(20 * 20);
  for (let y = 0; y < 20; y++) for (let x = 10; x < 20; x++) edge[y * 20 + x] = 255;
  console.assert(laplacianVariance(edge, 20, 20) > 100, 'lap edge>0');

  console.log('detect.selfCheck: ok');
}
