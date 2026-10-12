import { File, Paths } from 'expo-file-system';

/** Last sky-brightness reading (radiance API) with where and when it was taken. */
export type SkyCache = {
  lat: number;
  lon: number;
  bortle: number;
  bortleClass: number;
  sqm: number;
  /** Epoch ms of the reading. */
  at: number;
};

export type Prefs = {
  saveJpegs: boolean;
  saveTraces: boolean;
  nightMode: boolean;
  /** Speak the correction words through the device TTS. */
  voice: boolean;
  gtiReticle: boolean;
  lensId: string;
  infinityFocus: boolean;
  /** Focus distance in dioptres measured by the sweep (-1 = not measured). */
  focusDistance: number;
  iso: number;
  exposureSec: number;
  /** True when iso/exposureSec came from the initial metering (shown as `Auto (n)`). */
  metered: boolean;
  pxPerDeg: number;
  tolDeg: number;
  calibFrames: number;
  sky: SkyCache | null;
  /** Star-name labels on the reticle: none, the brightest few, or every named star in the field. */
  labels: 'off' | 'few' | 'all';
  /** Save one full-quality JPEG the first time astrometry solves (comment = solution + names). */
  saveFix: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  saveJpegs: false,
  saveTraces: false,
  nightMode: false,
  voice: true,
  gtiReticle: true,
  lensId: '',
  infinityFocus: false,
  focusDistance: -1,
  iso: 0,
  exposureSec: 0,
  metered: false,
  pxPerDeg: 0,
  tolDeg: 0.5,
  calibFrames: 10,
  sky: null,
  labels: 'few',
  saveFix: true,
};

export function loadPrefs(): Prefs {
  try {
    const file = new File(Paths.document, 'prefs.json');
    if (!file.exists) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(file.textSync()) as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: Prefs): void {
  try {
    new File(Paths.document, 'prefs.json').write(JSON.stringify(p));
  } catch {
    return;
  }
}
