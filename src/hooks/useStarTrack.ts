import { useEffect, useRef, useState } from 'react';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { toByteArray } from 'base64-js';

import { PolarCamera, type GrayFrame } from '../../modules/polar-camera';
import { brightestBlobs, laplacianVariance, stackFrames } from '../lib/detect';
import { saveFrame } from '../lib/session';
import { frameStats, initialSettings, type FrameStats } from '../lib/meter';

export const DECODE_WIDTH = 240;
const THRESHOLD = 60;
const TOL = 0.05;
const DEFAULT_TOL_DEG = 0.5;
const MAX_BLOBS = 8;
const STACK = 3; // frames averaged per detection (multi-frame stacking → better S/N)
const DEFAULT_CALIB = 10; // frames averaged for the initial calibration burst
const JPEG_INTERVAL_MS = 5000; // only for the optional on-disk JPEG record

export type DetPx = { x: number; y: number };

export type StarTrack = {
  running: boolean;
  frames: number;
  /** Measured ISO/shutter from the calibration frames (null until the burst finishes). */
  metered: { iso: number; exposureSec: number } | null;
  found: boolean;
  dx: number;
  dy: number;
  brightness: number;
  locked: boolean;
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
  found: false,
  dx: 0,
  dy: 0,
  brightness: 0,
  locked: false,
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
  } = {},
): StarTrack {
  const [state, setState] = useState<StarTrack>(IDLE);
  const captureRef = useRef<Capture | null>(options.capture ?? null);
  const saveRef = useRef(false);
  const pxRef = useRef(0);
  const tolRef = useRef(DEFAULT_TOL_DEG);
  const calibRef = useRef(DEFAULT_CALIB);
  const laddersRef = useRef<{ iso: number[]; shutter: number[] } | null>(options.ladders ?? null);

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
  }, [options.saveFrames, options.pxPerDeg, options.tolDeg, options.calibFrames, options.ladders]);

  // Detection runs on the module's analysis frames: no still capture, no JPEG decode per tick.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let firstRun = true;
    let frames = 0;
    let w = 0;
    let h = 0;
    const stack: Uint8Array[] = [];
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
        const found = brightestBlobs(stacked, w, h, THRESHOLD, MAX_BLOBS);
        const cx = w / 2;
        const cy = h / 2;
        const blobs = found.map((b) => ({ x: b.x - cx, y: b.y - cy }));
        const first = found[0];
        const dx = first ? first.x / cx - 1 : 0;
        const dy = first ? first.y / cy - 1 : 0;
        const focus = laplacianVariance(stacked, w, h);
        const px = pxRef.current > 0 ? pxRef.current : null;
        const offDeg = px ? Math.hypot(dx * cx, dy * cy) / px : null;
        const locked =
          !!first && (offDeg != null ? offDeg < tolRef.current : Math.hypot(dx, dy) < TOL);
        if (!cancelled) {
          setState((prev) => ({
            running: true,
            frames: prev.frames,
            metered,
            found: !!first,
            dx,
            dy,
            brightness: first ? first.brightness : 0,
            locked,
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
