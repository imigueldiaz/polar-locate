import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import * as KeepAwake from 'expo-keep-awake';
import * as Brightness from 'expo-brightness';

import { OptionsPanel } from './src/components/OptionsPanel';
import { Reticle, type Offset } from './src/components/Reticle';
import { usePointing } from './src/hooks/usePointing';
import { usePrefs } from './src/hooks/usePrefs';
import { useStarTrack } from './src/hooks/useStarTrack';
import { useAstrometry } from './src/hooks/useAstrometry';
import { t } from './src/i18n';
import { computeSky, darkness, polarisHourAngle } from './src/lib/astro';
import { formatAngle, formatClock, formatHours, formatLatLon } from './src/lib/format';
import { errorToPole, skyToScreen } from './src/lib/pointing';
import { appendTrace, traceUri } from './src/lib/session';
import { theme } from './src/theme';

type Coords = { lat: number; lon: number; acc: number };
type Perm = 'unknown' | 'granted' | 'denied';

const RETICLE = 300;
const RETICLE_R = RETICLE / 2 - 8;
const FOV_RADIUS_DEG = 5;
const PX_PER_DEG = RETICLE_R / FOV_RADIUS_DEG;
const TOL_DEG = 1.5;
const D2R = Math.PI / 180;

const clampOffset = (o: Offset, max: number): Offset => {
  const len = Math.hypot(o.x, o.y);
  return len > max ? { x: (o.x / len) * max, y: (o.y / len) * max } : o;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
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

  const { prefs, update } = usePrefs();
  const [cameraPerm, requestCamera] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const pointing = usePointing();
  const starTrack = useStarTrack(camRef, cameraOn && !!cameraPerm?.granted, {
    saveFrames: prefs.saveJpegs,
    pxPerDeg: prefs.pxPerDeg,
    tolDeg: prefs.tolDeg,
    calibFrames: prefs.calibFrames,
  });

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
    if (!cameraPerm?.granted) {
      const res = await requestCamera();
      if (!res.granted) return;
    }
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
    enabled: searching && cameraOn && !!cameraPerm?.granted,
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

  const { poleOffset, polarisOffset } = useMemo(() => {
    if (!guidance || !attUse) {
      return { poleOffset: { x: 0, y: 0 }, polarisOffset: { x: 0, y: 0 } };
    }
    const east = guidance.azErr * Math.cos(attUse.alt * D2R);
    const pole = skyToScreen(east, guidance.altErr, roll, PX_PER_DEG);
    let pol = pole;
    if (sky) {
      const pa = sky.driftPA * D2R;
      const d = skyToScreen(
        sky.driftDeg * Math.sin(pa),
        sky.driftDeg * Math.cos(pa),
        roll,
        PX_PER_DEG,
      );
      pol = { x: pole.x + d.x, y: pole.y + d.y };
    }
    return {
      poleOffset: clampOffset(pole, RETICLE_R),
      polarisOffset: clampOffset(pol, RETICLE_R),
    };
  }, [guidance, attUse, sky, roll]);

  const fix = useMemo(() => {
    if (astro.fix && guidance && attUse) {
      const right = guidance.azErr * Math.cos(attUse.alt * D2R);
      return {
        up: guidance.altErr,
        right,
        mag: guidance.distDeg,
        cv: false,
        locked: guidance.distDeg <= TOL_DEG,
      };
    }
    if (cameraOn && starTrack.running && starTrack.found) {
      return {
        up: -starTrack.dy,
        right: starTrack.dx,
        mag: Math.hypot(starTrack.dx, starTrack.dy),
        cv: true,
        locked: starTrack.locked,
      };
    }
    if (guidance && attUse) {
      const right = guidance.azErr * Math.cos(attUse.alt * D2R);
      return {
        up: guidance.altErr,
        right,
        mag: guidance.distDeg,
        cv: false,
        locked: guidance.distDeg <= TOL_DEG,
      };
    }
    return null;
  }, [astro, cameraOn, starTrack, guidance, attUse]);

  const alignedNow = searching && !!fix && fix.locked;

  const guideText = useMemo(() => {
    if (!searching) return t('search.hint');
    if (starTrack.calibrating) {
      return `${t('search.calibrating')} (${starTrack.calibDone}/${starTrack.calibTotal})`;
    }
    if (!fix) return t('guide.noSensor');
    if (fix.locked) return t('guide.aligned');
    const tol = fix.cv ? 0.05 : TOL_DEG;
    const parts: string[] = [];
    if (Math.abs(fix.up) > tol) parts.push(fix.up > 0 ? t('guide.up') : t('guide.down'));
    if (Math.abs(fix.right) > tol) {
      parts.push(fix.right > 0 ? t('guide.right') : t('guide.left'));
    }
    const mag = fix.cv ? `${Math.round(fix.mag * 100)}%` : formatAngle(fix.mag, 1);
    return parts.length ? `${parts.join(' · ')}  ${mag}` : mag;
  }, [fix, searching, starTrack.calibrating, starTrack.calibDone, starTrack.calibTotal]);

  const starScreen = starTrack.found
    ? { x: starTrack.dx * RETICLE_R, y: starTrack.dy * RETICLE_R }
    : null;

  const fixRef = useRef(fix);
  fixRef.current = fix;

  useEffect(() => {
    if (!searching || starTrack.calibrating) return;
    const id = setInterval(() => {
      const f = fixRef.current;
      if (!f || f.locked) return;
      const useV = Math.abs(f.up) >= Math.abs(f.right);
      const positive = useV ? f.up > 0 : f.right > 0;
      const style = useV
        ? Haptics.ImpactFeedbackStyle.Light
        : Haptics.ImpactFeedbackStyle.Heavy;
      const count = positive ? 1 : 2;
      void (async () => {
        for (let i = 0; i < count; i++) {
          await Haptics.impactAsync(style);
          await new Promise((r) => setTimeout(r, 130));
        }
      })();
    }, 1000);
    return () => clearInterval(id);
  }, [searching, starTrack.calibrating]);

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

  const dash = t('common.none');

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <Pressable style={styles.optionsBtn} onPress={() => setOptsOpen(true)}>
        <Text style={styles.optionsBtnText}>{t('options.title')}</Text>
      </Pressable>

      {cameraOn && cameraPerm?.granted && (
        <View style={styles.cameraWrap} pointerEvents="none">
          <CameraView
            ref={camRef}
            style={styles.camera}
            facing="back"
            zoom={zoom}
            autofocus={prefs.afLock ? 'on' : 'off'}
            active
          />
          <View style={styles.cameraDim} />
        </View>
      )}

      <View style={styles.readout}>
        <Text style={styles.title}>{t('app.title')}</Text>
        <Row label={t('readout.coords')} value={formatLatLon(coords?.lat, coords?.lon)} />
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
          label={t('readout.drift')}
          value={
            sky
              ? `${formatAngle(sky.driftDeg, 2)} @ ${formatAngle(sky.driftPA, 0)}`
              : dash
          }
        />
        <Row
          label={t('readout.visibleFrom')}
          value={dark?.from ? formatClock(dark.from) : dash}
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
          field={astro.predictedPx.length ? astro.predictedPx : null}
          gti={prefs.gtiReticle}
          degToPx={PX_PER_DEG}
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
            <Text style={styles.zoomVal}>{Math.round(zoom * 100)}%</Text>
            <Pressable
              style={styles.zoomBtn}
              onPress={() => setZoom((z) => Math.min(1, +(z + 0.05).toFixed(2)))}
            >
              <Text style={styles.zoomBtnText}>+</Text>
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
        onChange={update}
        onShare={shareTraces}
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
    backgroundColor: theme.colors.panel,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.line,
    paddingVertical: theme.space(1),
    paddingHorizontal: theme.space(1.5),
    minWidth: 250,
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
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.space(2),
    marginTop: 2,
  },
  rowLabel: {
    color: theme.colors.textDim,
    fontFamily: theme.mono,
    fontSize: 12,
  },
  rowValue: {
    color: theme.colors.text,
    fontFamily: theme.mono,
    fontSize: 12,
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
    fontSize: 13,
    letterSpacing: 1,
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
