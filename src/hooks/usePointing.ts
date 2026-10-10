import { useEffect, useRef, useState } from 'react';
import { Accelerometer, Magnetometer } from 'expo-sensors';

import { attitude, type Attitude } from '../lib/pointing';

const SMOOTH = 0.2;
const UPDATE_MS = 50;
const EMIT_MS = 50;

type Vec = { x: number; y: number; z: number };

export type Pointing = { ready: boolean; attitude: Attitude | null };

const ema = (prev: Vec | null, next: Vec): Vec =>
  prev
    ? {
        x: prev.x + SMOOTH * (next.x - prev.x),
        y: prev.y + SMOOTH * (next.y - prev.y),
        z: prev.z + SMOOTH * (next.z - prev.z),
      }
    : next;

export function usePointing(): Pointing {
  const [pointing, setPointing] = useState<Pointing>({
    ready: false,
    attitude: null,
  });
  const acc = useRef<Vec | null>(null);
  const mag = useRef<Vec | null>(null);
  const lastEmit = useRef(0);

  useEffect(() => {
    Accelerometer.setUpdateInterval(UPDATE_MS);
    Magnetometer.setUpdateInterval(UPDATE_MS);

    const emit = () => {
      if (!acc.current || !mag.current) return;
      const now = Date.now();
      if (now - lastEmit.current < EMIT_MS) return;
      lastEmit.current = now;
      setPointing({
        ready: true,
        attitude: attitude(acc.current, mag.current),
      });
    };

    const subAcc = Accelerometer.addListener((m) => {
      acc.current = ema(acc.current, m);
      emit();
    });
    const subMag = Magnetometer.addListener((m) => {
      mag.current = ema(mag.current, m);
      emit();
    });

    return () => {
      subAcc.remove();
      subMag.remove();
    };
  }, []);

  return pointing;
}
