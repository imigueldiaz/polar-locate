import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { CameraView } from 'expo-camera';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { toByteArray } from 'base64-js';
import { decode } from 'jpeg-js';

import { pxPerDegFromF35 } from '../lib/astrometry';
import { brightestBlobs, stackFrames, toGrayscale } from '../lib/detect';

const DECODE_WIDTH = 240;
const INTERVAL_MS = 1100;
const THRESHOLD = 60;
const TOL = 0.05;
const MAX_BLOBS = 8;
const STACK = 3; // frames averaged per tick (multi-frame stacking → better S/N)
const CAPTURE_QUALITY = 0.8; // was 0.4; hard JPEG compression erased faint stars

export type DetPx = { x: number; y: number };

export type StarTrack = {
  running: boolean;
  found: boolean;
  dx: number;
  dy: number;
  brightness: number;
  locked: boolean;
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
): StarTrack {
  const [state, setState] = useState<StarTrack>(IDLE);
  const inFlight = useRef(false);
  const plateRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState(IDLE);
      return;
    }
    let cancelled = false;

    const tick = async () => {
      if (inFlight.current) return;
      const cam = cameraRef.current;
      if (!cam) return;
      inFlight.current = true;
      try {
        const frames: Uint8Array[] = [];
        let w = 0;
        let h = 0;
        for (let k = 0; k < STACK; k++) {
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
        const locked = !!first && Math.hypot(dx, dy) < TOL;
        if (!cancelled) {
          setState({
            running: true,
            found: !!first,
            dx,
            dy,
            brightness: first ? first.brightness : 0,
            locked,
            blobs,
            platePxPerDeg: plateRef.current,
            error: null,
          });
        }
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, running: true, error: String(e) }));
      } finally {
        inFlight.current = false;
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
