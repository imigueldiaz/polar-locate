import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { CameraView } from 'expo-camera';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { toByteArray } from 'base64-js';
import { decode } from 'jpeg-js';

import { pxPerDegFromF35 } from '../lib/astrometry';
import { brightestBlobs, laplacianVariance, stackFrames, toGrayscale } from '../lib/detect';
import { saveFrame } from '../lib/session';

const DECODE_WIDTH = 240;
const INTERVAL_MS = 1100;
const THRESHOLD = 60;
const TOL = 0.05;
const DEFAULT_TOL_DEG = 0.5;
const MAX_BLOBS = 8;
const STACK = 3; // frames averaged per tick (multi-frame stacking → better S/N)
const DEFAULT_CALIB = 10; // frames averaged for the initial calibration burst
const CAPTURE_QUALITY = 0.8; // was 0.4; hard JPEG compression erased faint stars

export type DetPx = { x: number; y: number };

export type StarTrack = {
  running: boolean;
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
  platePxPerDeg: number | null;
  error: string | null;
};

const IDLE: StarTrack = {
  running: false,
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
  platePxPerDeg: null,
  error: null,
};

function focal35FromExif(exif: unknown): number | null {
  if (!exif || typeof exif !== 'object') return null;
  const rec = exif as Record<string, unknown>;
  const key = Object.keys(rec).find((k) => k.toLowerCase() === 'focallengthin35mmfilm');
  const v = key ? rec[key] : undefined;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function useStarTrack(
  cameraRef: RefObject<CameraView | null>,
  enabled: boolean,
  options: { saveFrames?: boolean; pxPerDeg?: number; tolDeg?: number; calibFrames?: number } = {},
): StarTrack {
  const [state, setState] = useState<StarTrack>(IDLE);
  const inFlight = useRef(false);
  const plateRef = useRef<number | null>(null);
  const saveRef = useRef(false);
  const pxRef = useRef(0);
  const tolRef = useRef(DEFAULT_TOL_DEG);
  const calibRef = useRef(DEFAULT_CALIB);

  useEffect(() => {
    saveRef.current = !!options.saveFrames;
    pxRef.current = options.pxPerDeg ?? 0;
    tolRef.current = options.tolDeg && options.tolDeg > 0 ? options.tolDeg : DEFAULT_TOL_DEG;
    calibRef.current = options.calibFrames && options.calibFrames > 0 ? options.calibFrames : DEFAULT_CALIB;
  }, [options.saveFrames, options.pxPerDeg, options.tolDeg, options.calibFrames]);

  useEffect(() => {
    if (!enabled) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    let firstRun = true;

    const tick = async () => {
      if (inFlight.current) return;
      const cam = cameraRef.current;
      if (!cam) return;
      inFlight.current = true;
      const burst = firstRun ? Math.max(1, Math.round(calibRef.current)) : STACK;
      try {
        if (firstRun) {
          setState((s) => ({ ...s, running: true, calibrating: true, calibTotal: burst, calibDone: 0 }));
        }
        const frames: Uint8Array[] = [];
        let w = 0;
        let h = 0;
        let lastBase64: string | null = null;
        for (let k = 0; k < burst; k++) {
          const pic = await cam.takePictureAsync({
            quality: CAPTURE_QUALITY,
            skipProcessing: false,
            shutterSound: false,
            exif: plateRef.current == null,
          });
          if (!pic?.uri) continue;
          const small = await manipulateAsync(
            pic.uri,
            [{ resize: { width: DECODE_WIDTH } }],
            { base64: true, compress: 0.8, format: SaveFormat.JPEG },
          );
          if (!small.base64) continue;
          lastBase64 = small.base64;
          if (plateRef.current == null) {
            const f35 = focal35FromExif(pic.exif);
            if (f35) plateRef.current = pxPerDegFromF35(f35, small.width);
          }
          const raw = decode(toByteArray(small.base64), {
            useTArray: true,
            formatAsRGBA: true,
          });
          const gray = toGrayscale(raw.data, raw.width, raw.height);
          if (!frames.length) {
            w = raw.width;
            h = raw.height;
          }
          if (gray.length === w * h) frames.push(gray);
          if (firstRun && !cancelled) setState((s) => ({ ...s, calibDone: k + 1 }));
        }
        if (!frames.length) throw new Error('sin captura');
        const stacked = stackFrames(frames);
        const found = brightestBlobs(stacked, w, h, THRESHOLD, MAX_BLOBS);
        const cx = w / 2;
        const cy = h / 2;
        const blobs = found.map((b) => ({ x: b.x - cx, y: b.y - cy }));
        const first = found[0];
        const dx = first ? first.x / cx - 1 : 0;
        const dy = first ? first.y / cy - 1 : 0;
        const focus = laplacianVariance(stacked, w, h);
        const px = pxRef.current > 0 ? pxRef.current : plateRef.current;
        const offDeg = px ? Math.hypot(dx * cx, dy * cy) / px : null;
        const locked =
          !!first && (offDeg != null ? offDeg < tolRef.current : Math.hypot(dx, dy) < TOL);
        if (saveRef.current && lastBase64) {
          const comment = `Polaris=${first ? 'si' : 'no'} blobs=${found.length} locked=${locked} dx=${dx.toFixed(3)} dy=${dy.toFixed(3)} t=${new Date().toISOString()}`;
          saveFrame(lastBase64, comment);
        }
        if (!cancelled) {
          setState({
            running: true,
            found: !!first,
            dx,
            dy,
            brightness: first ? first.brightness : 0,
            locked,
            focus,
            calibrating: false,
            calibDone: burst,
            calibTotal: burst,
            blobs,
            platePxPerDeg: plateRef.current,
            error: null,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setState((s) => ({ ...s, running: true, calibrating: false, error: String(e) }));
        }
      } finally {
        inFlight.current = false;
        firstRun = false;
      }
    };

    setState((s) => ({ ...s, running: true }));
    const id = setInterval(tick, INTERVAL_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [cameraRef, enabled]);

  return state;
}
