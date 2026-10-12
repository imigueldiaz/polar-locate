import { useEffect, useRef, useState } from 'react';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { toByteArray } from 'base64-js';

import { PolarCamera, type GrayFrame } from '../../modules/polar-camera';
import { brightestBlobs, laplacianVariance, stackFrames } from '../lib/detect';
import { pxPerDegFromLens } from '../lib/astrometry';
import { saveFrame } from '../lib/session';
import { frameStats, histogram, initialSettings, type FrameStats } from '../lib/meter';
import { fitSlope, type Sample, type Slope } from '../lib/drift';

export const DECODE_WIDTH = 240;
const THRESHOLD = 60;
const TOL = 0.05;
const DEFAULT_TOL_DEG = 0.5;
const MAX_BLOBS = 8;
const STACK = 3; // frames averaged per detection (multi-frame stacking → better S/N)
const DEFAULT_CALIB = 10; // frames averaged for the initial calibration burst
const DRIFT_WINDOW_MS = 120000; // drift samples kept for the alignment assistant
const JPEG_INTERVAL_MS = 5000; // only for the optional on-disk JPEG record

export type DetPx = { x: number; y: number };

export type StarTrack = {
  running: boolean;
  frames: number;
  /** Measured ISO/shutter from the calibration frames (null until the burst finishes). */
  metered: { iso: number; exposureSec: number } | null;
  /** Coarse normalised luminance histogram of the latest stack (null until the first analyse). */
  hist: number[] | null;
  /** Fraction of blown-out pixels in the latest stack, for the panel warning. */
  clipped: number;
  /** Px per degree of the analysis frames, from the chosen lens' optics (null if unknown). */
  platePxPerDeg: number | null;
  /** Measured walk of the star (px/min) over the last two minutes, for drift alignment. */
  drift: Slope | null;
  found: boolean;
  dx: number;
  dy: number;
  brightness: number;
  locked: boolean;
  /** Tolerancia de bloqueo en las MISMAS unidades normalizadas que `dx`/`dy` (fracción del semicuadro). */
  tolFrac: number;
  focus: number;
  calibrating: boolean;
  calibDone: number;
  calibTotal: number;
  blobs: DetPx[];
  error: string | null;
};

const IDLE: StarTrack = {
  running: false,
  frames: 0,
  metered: null,
  hist: null,
  clipped: 0,
  platePxPerDeg: null,
  drift: null,
  found: false,
  dx: 0,
  dy: 0,
  brightness: 0,
  locked: false,
  tolFrac: TOL,
  focus: 0,
  calibrating: false,
  calibDone: 0,
  calibTotal: 0,
  blobs: [],
  error: null,
};

/** Optional: resolves the absolute path of a freshly captured JPEG, for the on-disk record. */
export type Capture = () => Promise<string>;

export function useStarTrack(
  enabled: boolean,
  options: {
    capture?: Capture | null;
    saveFrames?: boolean;
    pxPerDeg?: number;
    tolDeg?: number;
    calibFrames?: number;
    /** Third-stop ladders of the chosen lens; when given, the calibration frames are metered. */
    ladders?: { iso: number[]; shutter: number[] } | null;
  /** Optics of the chosen lens; with `zoom` they give the frame scale (manual `pxPerDeg` wins). */
  optics?: { focalMm: number; sensorWidthMm: number } | null;
  /** CameraX zoom ratio of the session, which narrows the field the frames cover. */
  zoom?: number;
  } = {},
): StarTrack {
  const [state, setState] = useState<StarTrack>(IDLE);
  const captureRef = useRef<Capture | null>(options.capture ?? null);
  const saveRef = useRef(false);
  const pxRef = useRef(0);
  const tolRef = useRef(DEFAULT_TOL_DEG);
  const calibRef = useRef(DEFAULT_CALIB);
  const laddersRef = useRef<{ iso: number[]; shutter: number[] } | null>(options.ladders ?? null);
  const opticsRef = useRef<{ focalMm: number; sensorWidthMm: number } | null>(options.optics ?? null);
  const zoomRef = useRef(1);

  useEffect(() => {
    captureRef.current = options.capture ?? null;
  }, [options.capture]);

  useEffect(() => {
    saveRef.current = !!options.saveFrames;
    pxRef.current = options.pxPerDeg ?? 0;
    tolRef.current = options.tolDeg && options.tolDeg > 0 ? options.tolDeg : DEFAULT_TOL_DEG;
    calibRef.current =
      options.calibFrames && options.calibFrames > 0 ? options.calibFrames : DEFAULT_CALIB;
    laddersRef.current = options.ladders ?? null;
    opticsRef.current = options.optics ?? null;
    zoomRef.current = options.zoom && options.zoom > 0 ? options.zoom : 1;
  }, [
    options.saveFrames,
    options.pxPerDeg,
    options.tolDeg,
    options.calibFrames,
    options.ladders,
    options.optics,
    options.zoom,
  ]);

  // Detection runs on the module's analysis frames: no still capture, no JPEG decode per tick.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let firstRun = true;
    let frames = 0;
    let w = 0;
    let h = 0;
    const stack: Uint8Array[] = [];
    const drift: Sample[] = [];
    // One-shot exposure measurement over the calibration frames (see src/lib/meter.ts).
    let metered: { iso: number; exposureSec: number } | null = null;
    const stats: FrameStats[] = [];

    const fail = (e: unknown) => {
      if (!cancelled) {
        setState((s) => ({ ...s, running: true, calibrating: false, error: String(e) }));
      }
    };

    const analyze = (window: Uint8Array[]) => {
      try {
        const stacked = stackFrames(window);
        // Same stack for the panel: level histogram + blown-pixel fraction.
        const statsNow = frameStats(stacked);
        const hist = histogram(stacked);
        const found = brightestBlobs(stacked, w, h, THRESHOLD, MAX_BLOBS);
        const cx = w / 2;
        const cy = h / 2;
        const blobs = found.map((b) => ({ x: b.x - cx, y: b.y - cy }));
        const first = found[0];
        if (first) {
          // Same centre-relative px the reticle uses, kept for two minutes for drift alignment.
          drift.push({ t: Date.now(), x: first.x - cx, y: first.y - cy });
          const cutoff = Date.now() - DRIFT_WINDOW_MS;
          while (drift.length && drift[0].t < cutoff) drift.shift();
        }
        const dx = first ? first.x / cx - 1 : 0;
        const dy = first ? first.y / cy - 1 : 0;
        const focus = laplacianVariance(stacked, w, h);
        // Scale of this frame: the manual pref wins, else the optics at the frame's real width
        // (the analysis stream is a different size from the old JPEG decode and is zoomed too).
        const optics = opticsRef.current;
        const px =
          pxRef.current > 0
            ? pxRef.current
            : optics && optics.focalMm > 0 && optics.sensorWidthMm > 0
              ? pxPerDegFromLens(optics.focalMm, optics.sensorWidthMm, w) * zoomRef.current
              : null;
        // La tolerancia en las MISMAS unidades que dx/dy: los grados del prefs escalados por la
        // escala de placa, o la fracción pelada cuando no se conocen las ópticas.
        const tolFrac = px ? (tolRef.current * px) / cx : TOL;
        const locked = !!first && Math.hypot(dx, dy) < tolFrac;
        if (!cancelled) {
          setState((prev) => ({
            running: true,
            frames: prev.frames,
            metered,
            hist,
            clipped: statsNow.clipped,
            platePxPerDeg: px,
            drift: fitSlope(drift),
            found: !!first,
            dx,
            dy,
            brightness: first ? first.brightness : 0,
            locked,
            tolFrac,
            focus,
            calibrating: false,
            calibDone: calibRef.current,
            calibTotal: calibRef.current,
            blobs,
            error: null,
          }));
        }
      } catch (e) {
        fail(e);
      }
    };

    const onFrame = (frame: GrayFrame) => {
      try {
        const size = frame.width * frame.height;
        const gray = toByteArray(frame.gray);
        if (!size || gray.length !== size) {
          throw new Error(`frame ${gray.length} != ${frame.width}x${frame.height}`);
        }
        frames += 1;
        w = frame.width;
        h = frame.height;
        if (firstRun) {
          stack.push(gray);
          stats.push(frameStats(gray));
          if (!cancelled) {
            setState((s) => ({
              ...s,
              running: true,
              frames,
              metered: null,
              calibrating: true,
              calibDone: stack.length,
              calibTotal: calibRef.current,
            }));
          }
          if (stack.length >= calibRef.current) {
            firstRun = false;
            const ladders = laddersRef.current;
            if (ladders && stats.length) {
              const n = stats.length;
              const avg: FrameStats = {
                p99: stats.reduce((a, s) => a + s.p99, 0) / n,
                median: stats.reduce((a, s) => a + s.median, 0) / n,
                clipped: stats.reduce((a, s) => a + s.clipped, 0) / n,
              };
              metered = initialSettings(avg, ladders.iso, ladders.shutter);
            }
            analyze(stack.slice());
          }
          return;
        }
        stack.push(gray);
        while (stack.length > STACK) stack.shift();
        if (stack.length === STACK) analyze(stack.slice());
        if (!cancelled) setState((s) => ({ ...s, frames }));
      } catch (e) {
        fail(e);
      }
    };

    const saveJpeg = async () => {
      const shoot = captureRef.current;
      if (!saveRef.current || !shoot) return;
      try {
        const path = await shoot();
        const uri = path.startsWith('file://') ? path : `file://${path}`;
        const small = await manipulateAsync(
          uri,
          [{ resize: { width: DECODE_WIDTH } }],
          { base64: true, compress: 0.8, format: SaveFormat.JPEG },
        );
        if (small.base64) saveFrame(small.base64, `t=${new Date().toISOString()}`);
      } catch {
        // recording is best-effort: it must never break detection
      }
    };

    const sub = PolarCamera.addListener('onFrame', onFrame);
    const jpeg = setInterval(() => void saveJpeg(), JPEG_INTERVAL_MS);
    // No setState here: the first frame publishes `running`/`frames`, and doing it in the
    // effect body is what react-hooks/set-state-in-effect forbids.
    return () => {
      cancelled = true;
      sub.remove();
      clearInterval(jpeg);
    };
  }, [enabled]);

  // IDLE while disabled, so consumers never see frames from a previous run.
  return enabled ? state : IDLE;
}
