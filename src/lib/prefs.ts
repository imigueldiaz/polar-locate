import { File, Paths } from 'expo-file-system';

export type Prefs = {
  saveJpegs: boolean;
  saveTraces: boolean;
  nightMode: boolean;
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
};

export const DEFAULT_PREFS: Prefs = {
  saveJpegs: false,
  saveTraces: false,
  nightMode: false,
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
