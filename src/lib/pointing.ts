export type Vec3 = { x: number; y: number; z: number };

export type Attitude = {
  az: number;
  alt: number;
  roll: number;
};

export type Guidance = {
  azErr: number;
  altErr: number;
  distDeg: number;
};

const deg2rad = (d: number): number => (d * Math.PI) / 180;
const rad2deg = (r: number): number => (r * 180) / Math.PI;

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

const normalize = (a: Vec3): Vec3 => {
  const len = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
};

export const norm180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Camera pointing + screen roll from raw sensor vectors.
 * @param upDev  Earth "up" (gravity) direction expressed in device coords
 *               (normalized accelerometer *including* gravity, i.e. `-a`).
 * @param magDev Earth magnetic field in device coords (magnetometer, any unit).
 * Device frame: +X screen-right, +Y screen-up, +Z out of the screen (toward user);
 * the rear camera looks along -Z.
 */
export function attitude(upDev: Vec3, magDev: Vec3): Attitude {
  const up = normalize(upDev);

  // Magnetic north projected onto the horizontal plane, expressed in device coords.
  const proj = dot(magDev, up);
  const north = normalize({
    x: magDev.x - proj * up.x,
    y: magDev.y - proj * up.y,
    z: magDev.z - proj * up.z,
  });

  const east = cross(north, up); // ENU: east = north × up

  const camDev: Vec3 = { x: 0, y: 0, z: -1 };
  const cEast = dot(east, camDev);
  const cNorth = dot(north, camDev);
  const cUp = dot(up, camDev);

  const alt = rad2deg(Math.asin(clamp(cUp, -1, 1)));
  let az = rad2deg(Math.atan2(cEast, cNorth));
  if (az < 0) az += 360;

  const roll = rad2deg(Math.atan2(up.x, up.y));

  return { az, alt, roll };
}

/** Angular error from the current pointing to the true celestial pole (az = 0 / north, alt = latitude). */
export function errorToPole(att: Attitude, poleAlt: number): Guidance {
  const altErr = poleAlt - att.alt;
  const azErr = norm180(0 - att.az);
  const distDeg = Math.hypot(azErr * Math.cos(deg2rad(att.alt)), altErr);
  return { azErr, altErr, distDeg };
}

/**
 * Map a sky offset (east, up) in degrees, as seen through the camera, to screen
 * pixels relative to the reticle centre. `rollDeg` is `Attitude.roll`.
 */
export function skyToScreen(
  east: number,
  up: number,
  rollDeg: number,
  pxPerDeg: number,
): { x: number; y: number } {
  const phi = deg2rad(rollDeg);
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const sx = east * cosP + up * sinP;
  const sy = -east * sinP + up * cosP;
  return { x: sx * pxPerDeg, y: -sy * pxPerDeg };
}

export function selfCheck(): void {
  const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

  // Held vertically, facing north at the horizon.
  const a1 = attitude({ x: 0, y: 1, z: 0 }, { x: 0, y: 0.3, z: -1 });
  console.assert(near(a1.az, 0), `az north = ${a1.az}`);
  console.assert(near(a1.alt, 0), `alt horizon = ${a1.alt}`);
  console.assert(near(a1.roll, 0), `roll upright = ${a1.roll}`);

  // Same pose but the phone rolled 90° clockwise: world-up is now to the device's left.
  const a2 = attitude({ x: -1, y: 0, z: 0 }, { x: 0, y: 0.3, z: -1 });
  console.assert(near(a2.roll, -90), `roll 90cw = ${a2.roll}`);

  // Camera pointing straight north and 45° up: earth-up has a component into -Z.
  const s = Math.SQRT1_2;
  const a3 = attitude({ x: 0, y: s, z: -s }, { x: 0, y: 0.3, z: -1 });
  console.assert(near(a3.alt, 45, 1e-4), `alt 45 = ${a3.alt}`);
  console.assert(near(a3.az, 0, 1e-4), `az north45 = ${a3.az}`);

  // skyToScreen: unrotated, east → +x (right), up → -y (screen up).
  const p = skyToScreen(2, 3, 0, 10);
  console.assert(near(p.x, 20) && near(p.y, -30), `sky0 = ${p.x},${p.y}`);

  console.log('pointing.selfCheck: ok');
}
