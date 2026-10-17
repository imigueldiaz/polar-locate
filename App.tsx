import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PermissionsAndroid, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { PolarCamera, PolarCameraView, type LensInfo } from './modules/polar-camera';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import * as Sharing from 'expo-sharing';
import * as KeepAwake from 'expo-keep-awake';
import * as Brightness from 'expo-brightness';

import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';

import { OptionsPanel } from './src/components/OptionsPanel';
import { Histogram } from './src/components/Histogram';
import { fetchSky } from './src/lib/radiance';
import { Reticle, type Offset } from './src/components/Reticle';
import { usePointing } from './src/hooks/usePointing';
import { usePrefs } from './src/hooks/usePrefs';
import { useStarTrack } from './src/hooks/useStarTrack';
import { formatShutter, isoStops, shutterStops } from './src/lib/stops';
import { arcminPerMin, arrow, screwFor } from './src/lib/drift';
import { useAstrometry } from './src/hooks/useAstrometry';
import { t } from './src/i18n';
import { computeSky, darkness, driftTangent, polarisHourAngle } from './src/lib/astro';
import { allowSpeak, decDirFrom, phraseFor, type Words } from './src/lib/voice';
import { formatAngle, formatClock, formatHours, formatLatLon } from './src/lib/format';
import { errorToPole, skyToScreen } from './src/lib/pointing';
import { appendTrace, saveFrame, traceUri } from './src/lib/session';
import { theme } from './src/theme';

type Coords = { lat: number; lon: number; acc: number };
type Perm = 'unknown' | 'granted' | 'denied';
type Calib = {
  phase: 'arm' | 'measure' | 'done' | 'fail';
  before?: { right: number; up: number };
};

const RETICLE = 300;
const HIST_W = 240;
const RETICLE_R = RETICLE / 2 - 8;
const FOV_RADIUS_DEG = 5;
const PX_PER_DEG = RETICLE_R / FOV_RADIUS_DEG;
const TOL_DEG = 1.5;
const D2R = Math.PI / 180;

const clampOffset = (o: Offset, max: number): Offset => {
  const len = Math.hypot(o.x, o.y);
  return len > max ? { x: (o.x / len) * max, y: (o.y / len) * max } : o;
};

function Row({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <View style={[styles.row, wide && styles.rowWide]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function App() {
  const [now, setNow] = useState(new Date());
  const [coords, setCoords] = useState<Coords | null>(null);
  const [perm, setPerm] = useState<Perm>('unknown');
  const [cameraOn, setCameraOn] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [searching, setSearching] = useState(false);
  const [optsOpen, setOptsOpen] = useState(false);
  const [calib, setCalib] = useState<Calib | null>(null);

  const { prefs, update } = usePrefs();
  const [cameraPerm, setCameraPerm] = useState(false);
  const requestCamera = useCallback(async () => {
    const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    const granted = res === PermissionsAndroid.RESULTS.GRANTED;
    setCameraPerm(granted);
    return granted;
  }, []);

  useEffect(() => {
    void (async () => {
      setCameraPerm(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA));
    })();
  }, []);
  const pointing = usePointing();
  // the native module resolves a JPEG path; `enabled` gates the capture loop
  const [lenses, setLenses] = useState<LensInfo[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await PolarCamera.listLensesAsync();
        if (alive) setLenses(list);
      } catch {
        if (alive) setLenses([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Manual settings are pushed whenever they change; the module applies them live when bound.
  useEffect(() => {
    if (!cameraOn || !cameraPerm) return;
    void PolarCamera.setManualAsync({
      iso: prefs.iso,
      exposureSec: prefs.exposureSec,
      infinityFocus: prefs.infinityFocus,
      focusDistance: prefs.focusDistance,
    }).catch(() => undefined);
  }, [
    cameraOn,
    cameraPerm,
    prefs.iso,
    prefs.exposureSec,
    prefs.infinityFocus,
    prefs.focusDistance,
  ]);

  const lens = lenses.find((l) => l.id === prefs.lensId) ?? lenses.find((l) => l.facing === 'back');
  // Third-stop ladders of that lens: the initial metering picks a pair from them.
  const isoLadder = isoStops(lens?.isoRange[0] ?? 0, lens?.isoRange[1] ?? 0);
  const shutterLadder = shutterStops(lens?.exposureTimeRangeNs[0] ?? 0, lens?.exposureTimeRangeNs[1] ?? 0);
  // The capture scale is derived in the hook from each frame's real width (`optics` + `zoom`),
  // not from the old JPEG decode width: the analysis stream has its own size and is zoomed too.
  const zoomRatio = 1 + zoom * 7;

  const capture = useCallback(() => PolarCamera.takePictureAsync(), []);

  const starTrack = useStarTrack(searching && cameraOn && cameraPerm, {
    capture,
    saveFrames: prefs.saveJpegs,
    pxPerDeg: prefs.pxPerDeg,
    optics: { focalMm: lens?.focalLengths[0] ?? 0, sensorWidthMm: lens?.sensorWidthMm ?? 0 },
    zoom: zoomRatio,
    tolDeg: prefs.tolDeg,
    calibFrames: prefs.calibFrames,
    ladders: { iso: isoLadder, shutter: shutterLadder },
  });

  // The meter fills the pair while both are on auto; a manual pick (metered === false) always wins.
  useEffect(() => {
    const m = starTrack.metered;
    if (!searching) return; // only after a calibration burst has run
    if (prefs.metered) {
      // The pair was written by the meter itself, so it may be stale: refresh it, and drop it
      // when this run's frames say "auto" (light frames are better served by the phone's AE).
      if (m) update({ iso: m.iso, exposureSec: m.exposureSec, metered: true });
      else if (prefs.iso > 0 || prefs.exposureSec > 0) {
        update({ iso: 0, exposureSec: 0, metered: false });
      }
      return;
    }
    if (m && prefs.iso <= 0 && prefs.exposureSec <= 0) {
      update({ iso: m.iso, exposureSec: m.exposureSec, metered: true });
    }
  }, [starTrack.metered, searching, prefs.iso, prefs.exposureSec, prefs.metered, update]);

  // A metered pair belongs to the session that measured it (last night's sky is stale), so a
  // stored one is dropped on launch: the panel goes back to plain `Auto` until the next run.
  const meterResetRef = useRef(false);
  useEffect(() => {
    if (meterResetRef.current) return;
    meterResetRef.current = true;
    if (prefs.metered) update({ iso: 0, exposureSec: 0, metered: false });
  }, [prefs.metered, update]);

  // Sharpness of the latest stack, read by the sweep without re-rendering per frame.
  const focusRef = useRef(0);
  useEffect(() => {
    focusRef.current = starTrack.focus;
  }, [starTrack.focus]);

  // Focus sweep: walk LENS_FOCUS_DISTANCE and keep the distance whose frames are sharpest.
  const sweepingRef = useRef(false);
  const [sweeping, setSweeping] = useState(false);
  const measureFocus = useCallback(async () => {
    if (!searching || !cameraOn || !cameraPerm || sweepingRef.current) return;
    sweepingRef.current = true;
    setSweeping(true);
    try {
      let best = -1;
      let bestScore = 0;
      for (let d = 0; d <= 1.0001; d += 0.05) {
        await PolarCamera.setManualAsync({
          iso: prefs.iso,
          exposureSec: prefs.exposureSec,
          infinityFocus: prefs.infinityFocus,
          focusDistance: d,
        });
        await new Promise((r) => setTimeout(r, 500));
        const score = focusRef.current;
        if (score > bestScore) {
          bestScore = score;
          best = d;
        }
      }
      update({ focusDistance: best });
    } finally {
      sweepingRef.current = false;
      setSweeping(false);
    }
  }, [
    searching,
    cameraOn,
    cameraPerm,
    prefs.iso,
    prefs.exposureSec,
    prefs.infinityFocus,
    update,
  ]);

  // Sky brightness from the radiance API: cached, and only re-queried after moving >1 km or
  // once a month. Outside Spain (or offline) the row simply stays empty.
  useEffect(() => {
    if (!coords) return;
    const sky = prefs.sky;
    const movedKm = sky
      ? Math.hypot(
          (coords.lat - sky.lat) * 111,
          (coords.lon - sky.lon) * 111 * Math.cos(coords.lat * D2R),
        )
      : Infinity;
    const stale = !sky || Date.now() - sky.at > 30 * 24 * 3600 * 1000;
    if (!stale && movedKm < 1) return;
    let alive = true;
    void (async () => {
      try {
        const info = await fetchSky(coords.lon, coords.lat);
        if (alive && info) {
          update({
            sky: {
              lat: coords.lat,
              lon: coords.lon,
              bortle: info.bortle,
              bortleClass: info.bortleClass,
              sqm: info.sqm,
              at: Date.now(),
            },
          });
        }
      } catch {
        // offline, rate limited or outside coverage: keep whatever we had
      }
    })();
    return () => {
      alive = false;
    };
  }, [coords, prefs.sky, update]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const start = useCallback(async () => {
    setPerm('unknown');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setPerm('denied');
      return undefined;
    }
    setPerm('granted');
    return Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 1 },
      (loc) =>
        setCoords({
          lat: loc.coords.latitude,
          lon: loc.coords.longitude,
          acc: loc.coords.accuracy ?? 0,
        }),
    );
  }, []);

  const toggleCamera = useCallback(async () => {
    if (cameraOn) {
      setCameraOn(false);
      return;
    }
    if (!cameraPerm && !(await requestCamera())) return;
    setCameraOn(true);
  }, [cameraOn, cameraPerm, requestCamera]);

  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    start().then((s) => {
      sub = s;
    });
    return () => sub?.remove();
  }, [start]);

  const sky = useMemo(
    () => (coords ? computeSky(coords.lat, coords.lon, now) : null),
    [coords, now],
  );
  const dark = useMemo(
    () => (coords ? darkness(coords.lat, coords.lon, now) : null),
    [coords, now],
  );

  const att = pointing.attitude;
  const astro = useAstrometry({
    enabled: searching && cameraOn && cameraPerm,
    blobs: starTrack.blobs,
    att,
    lat: coords?.lat ?? null,
    lstHours: sky?.lstHours ?? null,
    date: now,
    pxPerDeg0: starTrack.platePxPerDeg,
  });
  const attUse = astro.correctedAtt ?? att;
  const poleAlt = sky ? sky.poleAlt : null;
  const guidance = useMemo(
    () => (attUse && poleAlt != null ? errorToPole(attUse, poleAlt) : null),
    [attUse, poleAlt],
  );
  const roll = attUse ? attUse.roll : 0;

  const { poleOffset, polarisOffset, orbit } = useMemo(() => {
    if (!guidance || !attUse) {
      return { poleOffset: { x: 0, y: 0 }, polarisOffset: { x: 0, y: 0 }, orbit: null };
    }
    const east = guidance.azErr * Math.cos(attUse.alt * D2R);
    const pole = skyToScreen(east, guidance.altErr, roll, PX_PER_DEG);
    let pol = pole;
    let orbit: { r: number; tangent: Offset } | null = null;
    if (sky && coords) {
      const pa = sky.driftPA * D2R;
      const d = skyToScreen(
        sky.driftDeg * Math.sin(pa),
        sky.driftDeg * Math.cos(pa),
        roll,
        PX_PER_DEG,
      );
      pol = { x: pole.x + d.x, y: pole.y + d.y };
      const tt = driftTangent(coords.lat, coords.lon, now);
      const t = skyToScreen(tt.east, tt.up, roll, 1);
      orbit = { r: Math.hypot(d.x, d.y), tangent: { x: t.x, y: t.y } };
    }
    return {
      poleOffset: clampOffset(pole, RETICLE_R),
      polarisOffset: clampOffset(pol, RETICLE_R),
      orbit,
    };
  }, [guidance, attUse, sky, coords, now, roll]);

  const fix = useMemo(() => {
    // `up`/`right` en el marco FÍSICO del soporte: "sube" = subir la montura (gravedad),
    // "derecha" = este. Son órdenes para mover la montura, así que NO dependen de cómo esté
    // girado el móvil en la zapata. La flecha sí gira (ver `correction`).
    if (!guidance || !attUse) return null;
    const right = guidance.azErr * Math.cos(attUse.alt * D2R);
    if (astro.fix) {
      return {
        up: guidance.altErr,
        right,
        mag: guidance.distDeg,
        cv: false,
        locked: guidance.distDeg <= TOL_DEG,
        tol: TOL_DEG,
      };
    }
    if (cameraOn && starTrack.running && starTrack.found) {
      return {
        up: -starTrack.dy,
        right: starTrack.dx,
        mag: Math.hypot(starTrack.dx, starTrack.dy),
        cv: true,
        locked: starTrack.locked,
        tol: starTrack.tolFrac,
      };
    }
    return {
      up: guidance.altErr,
      right,
      mag: guidance.distDeg,
      cv: false,
      locked: guidance.distDeg <= TOL_DEG,
      tol: TOL_DEG,
    };
  }, [astro, cameraOn, starTrack, guidance, attUse]);

  const alignedNow = searching && !!fix && fix.locked;

  // La dirección de DEC+ depende de la AR (y de cómo vaya sujeta la cámara), así que una
  // calibración caduca: en ~1,5 h sidéreas el eje ya apunta a otro lado del plano tangente.
  const lstHours = sky ? sky.lstHours : null;
  const decDir = useMemo(() => {
    const d = prefs.decDir;
    if (!d || lstHours == null) return null;
    const diff = (((d.lst - lstHours) % 24) + 24) % 24;
    return Math.min(diff, 24 - diff) <= 1.5 ? d : null;
  }, [prefs.decDir, lstHours]);
  // El efecto de calibración no puede depender de `sky` (cambia cada segundo y reiniciaría
  // sus temporizadores), así que la LST llega por ref.
  const lstRef = useRef<number | null>(null);
  useEffect(() => {
    lstRef.current = lstHours;
  }, [lstHours]);

  // Dos escalas: la CV entrega fracciones del radio de la retícula, los sensores grados. La
  // tolerancia viaja dentro de `fix`, así que anillo, voz y bloqueo no pueden discrepar.
  const tolEff = fix ? fix.tol : TOL_DEG;
  const pxPerUnit = fix?.cv ? RETICLE_R : PX_PER_DEG;
  const tolPx = tolEff * pxPerUnit;
  // La flecha apunta al aro del polo en pantalla: mismo `roll` que los marcadores, así que cae
  // exactamente sobre el aro. En la rama CV la estrella ya viene en fracciones de pantalla.
  const correction = useMemo(() => {
    if (!fix) return null;
    if (fix.cv) return { x: fix.right * RETICLE_R, y: -fix.up * RETICLE_R };
    const s = skyToScreen(fix.right, fix.up, roll, PX_PER_DEG);
    return { x: s.x, y: s.y };
  }, [fix, roll]);

  const words: Words = useMemo(
    () => ({
      up: t('guide.up'),
      down: t('guide.down'),
      left: t('guide.left'),
      right: t('guide.right'),
      fast: t('guide.fast'),
      slow: t('guide.slow'),
      locked: t('guide.sayLocked'),
      speed: t('guide.speed'),
      screw: t('guide.screw'),
      screwAlt: t('guide.screwAlt'),
      dec: t('guide.dec'),
    }),
    [],
  );

  // Pantalla y voz comparten `phraseFor`: no pueden contradecirse.
  const guideText = useMemo(() => {
    if (calib) {
      return calib.phase === 'arm'
        ? t('guide.calibArm')
        : calib.phase === 'measure'
          ? t('guide.calibMeasuring')
          : calib.phase === 'done'
            ? t('guide.calibDone')
            : t('guide.calibFail');
    }
    if (!searching) return t('search.hint');
    if (starTrack.calibrating) {
      return `${t('search.calibrating')} (${starTrack.calibDone}/${starTrack.calibTotal})`;
    }
    if (!fix) return t('guide.noSensor');
    if (fix.locked) return t('guide.aligned');
    const p = phraseFor(
      {
        up: fix.up,
        right: fix.right,
        mag: fix.mag,
        tol: fix.tol,
        locked: fix.locked,
        cv: fix.cv,
      },
      words,
      decDir,
    );
    const dirWord =
      p?.dir === 'up'
        ? words.up
        : p?.dir === 'down'
          ? words.down
          : p?.dir === 'right'
            ? words.right
            : p?.dir === 'left'
              ? words.left
              : '';
    const rateWord = p?.rate === 'fast' ? words.fast : p?.rate === 'slow' ? words.slow : '';
    const parts = [dirWord, rateWord].filter(Boolean).join(' · ');
    const how =
      p?.control === 'dec' && p.synscan != null
        ? `${words.dec}, ${words.speed} ${p.synscan}`
        : p?.control === 'screwAz'
          ? words.screw
          : p?.control === 'screwAlt'
            ? words.screwAlt
            : '';
    const amount = p ? p.amount : fix.mag;
    const mag = fix.cv ? `${Math.round(amount * 100)}%` : formatAngle(amount, 1);
    return [parts, how, mag].filter(Boolean).join('  ');
  }, [
    calib,
    fix,
    searching,
    starTrack.calibrating,
    starTrack.calibDone,
    starTrack.calibTotal,
    words,
    decDir,
  ]);

  const starScreen = starTrack.found
    ? { x: starTrack.dx * RETICLE_R, y: starTrack.dy * RETICLE_R }
    : null;

  const fixRef = useRef(fix);
  fixRef.current = fix;
  const voiceRef = useRef({ lastAt: 0, lastSay: '' });
  const lockedRef = useRef(false);

  // Calibración de una pulsación: DEC+ mueve la puntería en una dirección desconocida, así que
  // se mide el cambio del error tras 3 s de pulsación (1,5 s de margen antes).
  useEffect(() => {
    if (!calib) return;
    if (calib.phase === 'arm') {
      const id = setTimeout(() => {
        const f = fixRef.current;
        if (!f) {
          setCalib({ phase: 'fail' });
          return;
        }
        setCalib({ phase: 'measure', before: { right: f.right, up: f.up } });
      }, 1500);
      return () => clearTimeout(id);
    }
    if (calib.phase === 'measure') {
      const id = setTimeout(() => {
        const f = fixRef.current;
        const before = calib.before;
        if (!f || !before) {
          setCalib({ phase: 'fail' });
          return;
        }
        const d = decDirFrom(before, { right: f.right, up: f.up });
        if (!d) {
          setCalib({ phase: 'fail' });
          return;
        }
        update({ decDir: { ...d, lst: lstRef.current ?? 0 } });
        setCalib({ phase: 'done' });
      }, 3000);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setCalib(null), calib.phase === 'done' ? 2000 : 3000);
    return () => clearTimeout(id);
  }, [calib, update]);

  const startCalib = useCallback(() => {
    void Speech.stop();
    setOptsOpen(false);
    setCalib({ phase: 'arm' });
  }, []);

  useEffect(() => {
    if (!searching || starTrack.calibrating || calib) return;
    const speak = (say: string) => {
      void (async () => {
        await Speech.stop();
        Speech.speak(say, { language: 'es', pitch: 0.9, rate: 1.0 });
      })();
    };
    const id = setInterval(() => {
      const f = fixRef.current;
      if (!f) return;
      const tol = f.tol;
      const ratio = f.mag / tol;

      if (f.locked && !lockedRef.current) {
        // Flanco a bloqueado: un aviso inequívoco, más la palabra.
        lockedRef.current = true;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (prefs.voice) {
          voiceRef.current = { lastAt: Date.now(), lastSay: words.locked };
          speak(words.locked);
        }
        return;
      }
      lockedRef.current = f.locked;
      if (f.locked) return;

      if (prefs.voice) {
        const p = phraseFor(
          { up: f.up, right: f.right, mag: f.mag, tol, locked: false, cv: f.cv },
          words,
          decDir,
        );
        if (p && allowSpeak(Date.now(), p.say, voiceRef.current)) {
          voiceRef.current = { lastAt: Date.now(), lastSay: p.say };
          speak(p.say);
        }
      }

      const style =
        ratio > 6
          ? Haptics.ImpactFeedbackStyle.Heavy
          : ratio > 2
            ? Haptics.ImpactFeedbackStyle.Medium
            : Haptics.ImpactFeedbackStyle.Light;
      const useV = Math.abs(f.up) >= Math.abs(f.right);
      const positive = useV ? f.up > 0 : f.right > 0;
      const count = positive ? 1 : 2;
      void (async () => {
        for (let i = 0; i < count; i++) {
          await Haptics.impactAsync(style);
          await new Promise((r) => setTimeout(r, 130));
        }
      })();
    }, 1000);
    return () => {
      clearInterval(id);
      lockedRef.current = false;
      voiceRef.current = { lastAt: 0, lastSay: '' };
      void Speech.stop();
    };
  }, [searching, starTrack.calibrating, prefs.voice, words, decDir, calib]);

  const shareTraces = useCallback(async () => {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(traceUri(), {
          mimeType: 'application/json',
          dialogTitle: t('options.share'),
        });
      }
    } catch {
      return;
    }
  }, []);

  const astroRef = useRef(astro);
  const attUseRef = useRef(attUse);
  useEffect(() => {
    astroRef.current = astro;
    attUseRef.current = attUse;
  }, [astro, attUse]);

  useEffect(() => {
    if (!prefs.saveTraces || !searching || !cameraOn || !starTrack.running) return;
    const a = astroRef.current;
    appendTrace({
      t: Date.now(),
      found: starTrack.found,
      dx: starTrack.dx,
      dy: starTrack.dy,
      brightness: starTrack.brightness,
      locked: starTrack.locked,
      blobs: starTrack.blobs.length,
      matches: a.fix ? a.fix.matches : null,
      azCorr: a.fix ? a.fix.azCorr : null,
      altCorr: a.fix ? a.fix.altCorr : null,
      pxPerDeg: a.fix ? a.fix.pxPerDeg : null,
      att: attUseRef.current,
    });
  }, [prefs.saveTraces, searching, cameraOn, starTrack]);

  useEffect(() => {
    if (!prefs.nightMode) return;
    let prev: number | null = null;
    void (async () => {
      try {
        prev = await Brightness.getBrightnessAsync();
        await Brightness.setBrightnessAsync(0.05);
      } catch {
        prev = null;
      }
      void KeepAwake.activateKeepAwakeAsync('polar-night');
    })();
    return () => {
      void KeepAwake.deactivateKeepAwake('polar-night');
      if (prev != null) void Brightness.setBrightnessAsync(prev);
    };
  }, [prefs.nightMode]);

  const hourAngle = sky ? polarisHourAngle(sky.lstHours) : null;

  // Star names painted on the reticle: the brightest few by default, all named stars on request.
  const fieldStars = useMemo(() => {
    if (prefs.labels === 'off') return null;
    const named = astro.predictedPx.filter((s) => s.name);
    if (!named.length) return null;
    return prefs.labels === 'all' ? named : [...named].sort((a, b) => a.mag - b.mag).slice(0, 10);
  }, [astro.predictedPx, prefs.labels]);

  // One full-quality JPEG the first time astrometry solves, with the solution and the field's
  // star names written into the file's comment (best effort: it must never break the session).
  const fixSavedRef = useRef(false);
  useEffect(() => {
    const f = astro.fix;
    if (!f || fixSavedRef.current || !prefs.saveFix || !cameraOn || !cameraPerm) return;
    fixSavedRef.current = true;
    void (async () => {
      try {
        const path = await PolarCamera.takePictureAsync();
        const uri = path.startsWith('file://') ? path : `file://${path}`;
        const shot = await manipulateAsync(uri, [], {
          base64: true,
          compress: 1,
          format: SaveFormat.JPEG,
        });
        if (!shot.base64) return;
        const names = astro.predictedPx
          .filter((s) => s.name)
          .map((s) => s.name)
          .join(', ');
        saveFrame(
          shot.base64,
          `astrometria px/deg=${f.pxPerDeg.toFixed(2)} matches=${f.matches} az=${f.azCorr.toFixed(3)} alt=${f.altCorr.toFixed(3)} estrellas: ${names}`,
        );
      } catch {
        return;
      }
    })();
  }, [astro.fix, astro.predictedPx, prefs.saveFix, cameraOn, cameraPerm]);

  const dash = t('common.none');
  // Manual camera state at a glance; the full controls live in Opciones.
  const lensValue = prefs.lensId
    ? `${lens?.focalLengths[0]?.toFixed(1) ?? '?'} mm${lens?.isLogical ? ' · multi' : ''}`
    : t('options.lensAuto');
  // No `~` means the astrometry fit measured it; `~` is still the geometric seed.
  const plateValue = astro.fix
    ? `${astro.fix.pxPerDeg.toFixed(1)}/°`
    : starTrack.platePxPerDeg
      ? `~${starTrack.platePxPerDeg.toFixed(1)}/°`
      : dash;
  // Measured walk of the star and which screw reacts to it (classic drift alignment).
  const drift = starTrack.drift;
  const driftRate =
    drift && starTrack.platePxPerDeg ? arcminPerMin(drift, starTrack.platePxPerDeg) : null;
  const driftValue =
    drift && driftRate != null
      ? `${driftRate.toFixed(1)}′/min ${arrow(drift)}${
          attUse ? (screwFor(attUse.az) === 'altitude' ? ' · alt' : ' · az') : ''
        }`
      : dash;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <Pressable style={styles.optionsBtn} onPress={() => setOptsOpen(true)}>
        <Text style={styles.optionsBtnText}>{t('options.title')}</Text>
      </Pressable>

      {cameraOn && cameraPerm && (
        <View style={styles.cameraWrap} pointerEvents="none">
          <PolarCameraView
            style={styles.camera}
            isActive
            lensId={prefs.lensId || null}
            zoom={1 + zoom * 7}
          />
          <View style={styles.cameraDim} />
        </View>
      )}

      <View style={[styles.readout, cameraOn && styles.readoutClear]}>
        <Text style={styles.title}>{t('app.title')}</Text>
        <Row label={t('readout.coords')} value={formatLatLon(coords?.lat, coords?.lon)} wide />
        <Row
          label={t('readout.accuracy')}
          value={coords ? `±${coords.acc.toFixed(0)} m` : dash}
        />
        <Row label={t('readout.time')} value={formatClock(now)} />
        <Row
          label={t('readout.sidereal')}
          value={sky ? formatHours(sky.lstHours) : dash}
        />
        <Row
          label={t('readout.hourAngle')}
          value={hourAngle != null ? formatHours(hourAngle) : dash}
        />
        <Row
          label={t('readout.polaris')}
          value={
            sky
              ? `${formatAngle(sky.polarisAlt, 1)} · az ${formatAngle(sky.polarisAz, 1)}`
              : dash
          }
        />
        <Row
          label={t('readout.pointing')}
          value={
            attUse
              ? `${formatAngle(attUse.az, 0)} / ${formatAngle(attUse.alt, 0)}`
              : dash
          }
        />
        <Row
          label={t('readout.star')}
          value={
            starTrack.running
              ? starTrack.found
                ? `✓ ${starTrack.brightness}`
                : '–'
              : dash
          }
        />
        <Row
          label={t('readout.focus')}
          value={starTrack.running ? String(Math.round(starTrack.focus)) : dash}
        />
        <Row
          label={t('readout.iso')}
          value={
            prefs.iso > 0
              ? prefs.metered
                ? `${t('options.auto')} (${prefs.iso})`
                : String(prefs.iso)
              : t('options.auto')
          }
        />
        <Row label={t('readout.frames')} value={String(starTrack.frames)} />
        <Row
          label={t('readout.clipped')}
          value={starTrack.running ? `${(starTrack.clipped * 100).toFixed(1)}%` : dash}
        />
        {starTrack.hist ? (
          <View style={styles.histWrap}>
            <Histogram bins={starTrack.hist} width={HIST_W} height={26} />
          </View>
        ) : null}
        <Row
          label={t('readout.shutter')}
          value={
            prefs.exposureSec > 0
              ? prefs.metered
                ? `${t('options.auto')} (${formatShutter(prefs.exposureSec)})`
                : formatShutter(prefs.exposureSec)
              : formatShutter(0)
          }
        />
        <Row label={t('camera.label')} value={lensValue} />
        <Row label={t('readout.plate')} value={plateValue} />
        {starTrack.error ? <Row label={t('readout.capture')} value={starTrack.error} /> : null}
        <Row
          label={t('readout.astro')}
          value={
            astro.fix
              ? `✓ ${astro.fix.matches} · ${formatAngle(astro.fix.pxPerDeg, 1)}/°`
              : cameraOn
                ? '…'
                : dash
          }
        />
        <Row
          label={t('readout.orbit')}
          value={sky ? `${formatAngle(sky.driftDeg, 2)} · ${t('readout.orbitSpeed')}` : dash}
        />
        <Row label={t('readout.imageDrift')} value={driftValue} />
        <Row
          label={t('readout.visibleFrom')}
          value={dark?.from ? formatClock(dark.from) : dash}
        />
        <Row
          label={t('readout.sky')}
          value={
            prefs.sky
              ? `${t('readout.bortle')} ${prefs.sky.bortleClass} · ${prefs.sky.sqm.toFixed(1)}`
              : dash
          }
        />
      </View>

      <View style={styles.reticle} pointerEvents="none">
        <Reticle
          size={RETICLE}
          roll={roll}
          pole={poleOffset}
          polaris={polarisOffset}
          aligned={alignedNow}
          star={starScreen}
          starLocked={starTrack.locked}
          field={fieldStars}
          gti={prefs.gtiReticle}
          degToPx={PX_PER_DEG}
          orbit={orbit}
          tolPx={tolPx}
          correction={correction}
          labels={searching}
        />
      </View>

      {perm === 'denied' && (
        <Pressable style={styles.grant} onPress={start}>
          <Text style={styles.grantText}>
            {t('permission.denied')} {t('common.grant')}
          </Text>
        </Pressable>
      )}

      <View style={styles.bottom} pointerEvents="box-none">
        <Text style={[styles.guide, alignedNow && styles.guideAligned]}>
          {guideText}
        </Text>
        {cameraOn && (
          <View style={styles.zoomRow}>
            <Pressable
              style={styles.zoomBtn}
              onPress={() => setZoom((z) => Math.max(0, +(z - 0.05).toFixed(2)))}
            >
              <Text style={styles.zoomBtnText}>−</Text>
            </Pressable>
            <Text style={styles.zoomVal}>{`x${(1 + zoom * 7).toFixed(1)}`}</Text>
            <Pressable
              style={styles.zoomBtn}
              onPress={() => setZoom((z) => Math.min(1, +(z + 0.05).toFixed(2)))}
            >
              <Text style={styles.zoomBtnText}>+</Text>
            </Pressable>
            {[1, 3, 5].map((r) => (
              <Pressable
                key={r}
                style={styles.zoomPreset}
                onPress={() => setZoom(+((r - 1) / 7).toFixed(2))}
              >
                <Text style={styles.zoomPresetText}>{`${r}×`}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.zoomPreset} onPress={() => void measureFocus()}>
              <Text style={styles.zoomPresetText}>
                {sweeping ? '…' : t('options.focusSweep')}
              </Text>
            </Pressable>
          </View>
        )}
        <Pressable
          style={[styles.toggle, cameraOn && styles.toggleOn]}
          onPress={toggleCamera}
        >
          <Text style={[styles.toggleText, cameraOn && styles.toggleTextOn]}>
            {t('camera.label')} {cameraOn ? t('camera.on') : t('camera.off')}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.toggle, searching && styles.toggleOn]}
          onPress={() => setSearching((v) => !v)}
        >
          <Text style={[styles.toggleText, searching && styles.toggleTextOn]}>
            {t('search.label')} {searching ? t('search.on') : t('search.off')}
          </Text>
        </Pressable>
      </View>

      <OptionsPanel
        visible={optsOpen}
        prefs={prefs}
        lenses={lenses}
        onChange={update}
        onShare={shareTraces}
        onCalibDec={startCalib}
        onClose={() => setOptsOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    paddingTop: 48,
    paddingHorizontal: 16,
  },
  readout: {
    alignSelf: 'flex-start',
    width: '70%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.panel,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.line,
    paddingVertical: theme.space(1),
    paddingHorizontal: theme.space(1),
  },
  // Same fill as `panel`, but see-through so the live camera image shows behind it.
  readoutClear: {
    backgroundColor: 'rgba(24, 0, 3, 0.35)',
  },
  optionsBtn: {
    position: 'absolute',
    top: 48,
    right: 16,
    borderColor: theme.colors.redDim,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: theme.space(0.75),
    paddingHorizontal: theme.space(1.5),
  },
  optionsBtnText: {
    color: theme.colors.text,
    fontFamily: theme.mono,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  title: {
    color: theme.colors.redBright,
    fontFamily: theme.mono,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: theme.space(0.5),
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '48%',
    gap: theme.space(0.5),
    marginTop: 1,
  },
  rowWide: {
    width: '100%',
  },
  histWrap: {
    width: '100%',
    marginTop: 3,
  },
  rowLabel: {
    color: theme.colors.textDim,
    fontFamily: theme.mono,
    fontSize: 10,
  },
  rowValue: {
    color: theme.colors.text,
    fontFamily: theme.mono,
    fontSize: 10,
    flexShrink: 1,
    textAlign: 'right',
  },
  reticle: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  camera: {
    flex: 1,
  },
  cameraDim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  zoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(1.5),
  },
  zoomBtn: {
    borderColor: theme.colors.off,
    borderWidth: 1,
    borderRadius: 999,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomBtnText: {
    color: theme.colors.text,
    fontFamily: theme.mono,
    fontSize: 20,
    lineHeight: 22,
  },
  zoomVal: {
    color: theme.colors.text,
    fontFamily: theme.mono,
    fontSize: 13,
    minWidth: 48,
    textAlign: 'center',
  },
  zoomPreset: {
    borderColor: theme.colors.redDim,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.space(1),
    paddingVertical: theme.space(0.5),
  },
  zoomPresetText: {
    color: theme.colors.text,
    fontFamily: theme.mono,
    fontSize: 12,
  },
  grant: {
    position: 'absolute',
    top: '45%',
    alignSelf: 'center',
    backgroundColor: theme.colors.redDim,
    borderRadius: 6,
    paddingVertical: theme.space(1),
    paddingHorizontal: theme.space(2),
    maxWidth: '80%',
  },
  grantText: {
    color: theme.colors.text,
    fontFamily: theme.mono,
    fontSize: 12,
    textAlign: 'center',
  },
  bottom: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 48,
    gap: theme.space(2),
  },
  guide: {
    color: theme.colors.text,
    fontFamily: theme.mono,
    fontSize: 18,
    letterSpacing: 1,
    textAlign: 'center',
  },
  guideAligned: {
    color: theme.colors.redBright,
    fontWeight: '700',
  },
  toggle: {
    borderColor: theme.colors.off,
    borderWidth: 2,
    borderRadius: 999,
    paddingVertical: theme.space(1),
    paddingHorizontal: theme.space(3),
  },
  toggleOn: {
    borderColor: theme.colors.on,
  },
  toggleText: {
    color: theme.colors.textDim,
    fontFamily: theme.mono,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
  toggleTextOn: {
    color: theme.colors.redBright,
  },
});
