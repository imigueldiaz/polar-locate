import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { CameraView } from 'expo-camera';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { toByteArray } from 'base64-js';
import { decode } from 'jpeg-js';

import { pxPerDegFromF35 } from '../lib/astrometry';
import { brightestBlobs, toGrayscale } from '../lib/detect';

const DECODE_WIDTH = 240;
const INTERVAL_MS = 1100;
const THRESHOLD = 60;
const TOL = 0.05;
const MAX_BLOBS = 8;

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
        const pic = await cam.takePictureAsync({
          quality: 0.4,
          skipProcessing: false,
          shutterSound: false,
          exif: plateRef.current == null,
        });
        if (!pic?.uri) throw new Error('sin captura');
        const f35 = plateRef.current == null ? focal35FromExif(pic.exif) : null;
        const small = await manipulateAsync(
          pic.uri,
          [{ resize: { width: DECODE_WIDTH } }],
          { base64: true, compress: 0.7, format: SaveFormat.JPEG },
        );
        if (!small.base64) throw new Error('sin base64');
        if (f35) plateRef.current = pxPerDegFromF35(f35, small.width);
        const raw = decode(toByteArray(small.base64), {
          useTArray: true,
          formatAsRGBA: true,
        });
        const gray = toGrayscale(raw.data, raw.width, raw.height);
        const found = brightestBlobs(gray, raw.width, raw.height, THRESHOLD, MAX_BLOBS);
        const cx = raw.width / 2;
        const cy = raw.height / 2;
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
