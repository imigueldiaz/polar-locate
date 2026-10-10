const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const norm180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

/** Sky offset (east, up) in degrees → screen pixel offset (y down), rotated by the roll. */
function skyToScreen(
  east: number,
  up: number,
  rollDeg: number,
  pxPerDeg: number,
): { x: number; y: number } {
  const phi = rollDeg * D2R;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const sx = east * cosP + up * sinP;
  const sy = -east * sinP + up * cosP;
  return { x: sx * pxPerDeg, y: -sy * pxPerDeg };
}

export type SkyStar = { e: number; u: number; mag: number };
export type DetPx = { x: number; y: number };
export type Fix = {
  azCorr: number;
  altCorr: number;
  pxPerDeg: number;
  matches: number;
};

/** Star's altitude/azimuth (degrees) from of-date RA/Dec, observer latitude and LST. */
export function altAzOf(
  raHours: number,
  decDeg: number,
  latDeg: number,
  lstHours: number,
): { az: number; alt: number } {
  const H = (lstHours - raHours) * 15 * D2R;
  const dec = decDeg * D2R;
  const lat = latDeg * D2R;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az = Math.atan2(
    -Math.cos(dec) * Math.sin(H),
    Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(H),
  );
  return { az: ((az * R2D) % 360 + 360) % 360, alt: alt * R2D };
}

/** Sky offset (east, up) of a star relative to the assumed boresight, in degrees. */
export function skyOffset(
  starAz: number,
  starAlt: number,
  assAz: number,
  assAlt: number,
): { e: number; u: number } {
  return {
    e: norm180(starAz - assAz) * Math.cos(starAlt * D2R),
    u: starAlt - assAlt,
  };
}

/** Nominal px-per-degree from the EXIF 35mm-equivalent focal length (36 mm reference width). */
export function pxPerDegFromF35(focal35mm: number, widthPx: number): number {
  return ((widthPx * focal35mm) / 36) * D2R;
}

/**
 * Match detected blobs against predicted catalog stars to recover the boresight
 * correction and the true plate scale. `detected` are pixel offsets from the
 * image centre; `predicted` are sky offsets relative to the *assumed* pointing.
 * Returns null when there is no usable match (fewer than 2 pairs).
 */
export function solvePointing(
  predicted: SkyStar[],
  detected: DetPx[],
  rollDeg: number,
  pxPerDeg0: number,
  tolDeg: number,
  assumedAlt: number,
): Fix | null {
  if (predicted.length < 2 || detected.length < 2) return null;

  const phi = rollDeg * D2R;
  const c = Math.cos(phi);
  const s = Math.sin(phi);

  const detSky = detected.map((p) => ({
    e: (p.x * c + p.y * s) / pxPerDeg0,
    u: (p.x * s - p.y * c) / pxPerDeg0,
  }));

  const fit = (pairs: { p: SkyStar; d: { e: number; u: number } }[]) => {
    const n = pairs.length;
    let dmE = 0;
    let dmU = 0;
    let pmE = 0;
    let pmU = 0;
    for (const { p, d } of pairs) {
      dmE += d.e;
      dmU += d.u;
      pmE += p.e;
      pmU += p.u;
    }
    dmE /= n;
    dmU /= n;
    pmE /= n;
    pmU /= n;
    let sxx = 0;
    let syy = 0;
    let sxp = 0;
    let syp = 0;
    for (const { p, d } of pairs) {
      const de = d.e - dmE;
      const du = d.u - dmU;
      sxx += de * de;
      syy += du * du;
      sxp += de * (p.e - pmE);
      syp += du * (p.u - pmU);
    }
    const denom = sxx + syy;
    if (denom < 1e-9) return null;
    const scale = (sxp + syp) / denom;
    return { scale, te: pmE - scale * dmE, tu: pmU - scale * dmU };
  };

  let scale = 1;
  let te = 0;
  let tu = 0;

  // Initialise from the ratio of point-set spreads (robust to a wrong nominal scale).
  {
    let dE = 0;
    let dU = 0;
    let pE = 0;
    let pU = 0;
    for (const d of detSky) {
      dE += d.e;
      dU += d.u;
    }
    for (const p of predicted) {
      pE += p.e;
      pU += p.u;
    }
    dE /= detSky.length;
    dU /= detSky.length;
    pE /= predicted.length;
    pU /= predicted.length;
    let rD = 0;
    let rP = 0;
    for (const d of detSky) rD += (d.e - dE) ** 2 + (d.u - dU) ** 2;
    for (const p of predicted) rP += (p.e - pE) ** 2 + (p.u - pU) ** 2;
    if (rD > 1e-9) scale = Math.sqrt(rP / rD);
    te = pE - scale * dE;
    tu = pU - scale * dU;
  }

  let pairs: { p: SkyStar; d: { e: number; u: number } }[] = [];
  for (let iter = 0; iter < 6; iter++) {
    const used = new Array(detSky.length).fill(false);
    pairs = [];
    for (const pr of predicted) {
      let best = -1;
      let bestD = tolDeg * tolDeg;
      for (let j = 0; j < detSky.length; j++) {
        if (used[j]) continue;
        const de = scale * detSky[j].e + te - pr.e;
        const du = scale * detSky[j].u + tu - pr.u;
        const dd = de * de + du * du;
        if (dd < bestD) {
          bestD = dd;
          best = j;
        }
      }
      if (best >= 0) {
        used[best] = true;
        pairs.push({ p: pr, d: detSky[best] });
      }
    }
    if (pairs.length < 2) {
      if (iter === 0) return null;
      break;
    }
    const f = fit(pairs);
    if (!f) break;
    scale = f.scale;
    te = f.te;
    tu = f.tu;
  }

  if (pairs.length < 2) return null;
  if (!(scale > 0.05 && scale < 20)) return null;

  return {
    azCorr: te / Math.cos(assumedAlt * D2R),
    altCorr: tu,
    pxPerDeg: pxPerDeg0 / scale,
    matches: pairs.length,
  };
}

export function selfCheck(): void {
  const near = (a: number, b: number, eps: number): boolean => Math.abs(a - b) < eps;

  // altAzOf: equator on the meridian from lat 40 → south, alt 50.
  const a = altAzOf(0, 0, 40, 0);
  console.assert(near(a.az, 180, 1e-6) && near(a.alt, 50, 1e-6), `altAzOf = ${a.az},${a.alt}`);
  // north pole → az 0, alt = latitude.
  const p = altAzOf(0, 90, 40, 0);
  console.assert(near(p.az, 0, 1e-6) && near(p.alt, 40, 1e-6), `pole = ${p.az},${p.alt}`);

  // solvePointing: known true pointing/scale, recovered from an offset guess.
  const azT = 100;
  const altT = 50;
  const azA = 98; // assumed (sensor) boresight
  const altA = 50;
  const roll = 20;
  const sTrue = 5; // px per degree (true)
  const s0 = 4; // nominal, wrong on purpose
  const stars = [96, 97, 98, 102, 103, 104].map((az) => ({ az, alt: altT }));

  const detected = stars.map((st) => {
    const t = skyOffset(st.az, st.alt, azT, altT);
    return skyToScreen(t.e, t.u, roll, sTrue);
  });
  const predicted = stars.map((st) => {
    const o = skyOffset(st.az, st.alt, azA, altA);
    return { e: o.e, u: o.u, mag: 3 };
  });

  const fix = solvePointing(predicted, detected, roll, s0, 3, altA);
  console.assert(!!fix, 'fix not null');
  if (fix) {
    console.assert(fix.matches === stars.length, `matches = ${fix.matches}`);
    console.assert(near(fix.azCorr, azT - azA, 1e-6), `azCorr = ${fix.azCorr}`);
    console.assert(near(fix.altCorr, altT - altA, 1e-6), `altCorr = ${fix.altCorr}`);
    console.assert(near(fix.pxPerDeg, sTrue, 1e-3), `pxPerDeg = ${fix.pxPerDeg}`);
  }

  // pxPerDegFromF35: a ~26 mm-equiv phone lens at 240 px → ~3 px/deg.
  console.assert(near(pxPerDegFromF35(26, 240), 3.025, 0.01), 'pxPerDegFromF35');

  console.log('astrometry.selfCheck: ok');
}
