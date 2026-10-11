import { useEffect, useRef, useState } from 'react';

import { solvePointing, type DetPx, type Fix } from '../lib/astrometry';
import { NAMES } from '../lib/catalog';
import { ofDateCatalog, predictField } from '../lib/field';
import { skyToScreen, type Attitude } from '../lib/pointing';

const D2R = Math.PI / 180;
const MAX_DEG = 22;
const MAG_MATCH = 5;
const PX_PER_DEG0 = 3;
const TOL_MATCH = 2.5;

export type AstroResult = {
  fix: Fix | null;
  correctedAtt: Attitude | null;
  /** Predicted stars in screen px, with their catalog label ('' when unnamed). */
  predictedPx: { x: number; y: number; name: string; mag: number }[];
};

const EMPTY: AstroResult = { fix: null, correctedAtt: null, predictedPx: [] };

export type AstroParams = {
  enabled: boolean;
  blobs: DetPx[];
  att: Attitude | null;
  lat: number | null;
  lstHours: number | null;
  date: Date;
  pxPerDeg0?: number | null;
};

/**
 * Absolute pointing from the star field: match the detected blobs against the
 * predicted catalog stars to recover the boresight correction and the true
 * plate scale. Runs once per camera tick (not per sensor frame).
 */
export function useAstrometry(params: AstroParams): AstroResult {
  const { enabled, blobs } = params;
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  });
  const [res, setRes] = useState<AstroResult>(EMPTY);

  useEffect(() => {
    const p = latest.current;
    const att = p.att;
    if (!enabled || blobs.length < 2 || !att || p.lat == null || p.lstHours == null) {
      setRes(EMPTY);
      return;
    }
    const ofDate = ofDateCatalog(p.date);
    const pred = predictField(ofDate, p.lat, p.lstHours, att.az, att.alt, MAX_DEG, MAG_MATCH);
    const px0 = p.pxPerDeg0 ?? PX_PER_DEG0;
    const fix = solvePointing(pred, blobs, att.roll, px0, TOL_MATCH, att.alt);
    if (!fix) {
      setRes({ fix: null, correctedAtt: null, predictedPx: [] });
      return;
    }
    const correctedAtt = {
      az: att.az + fix.azCorr,
      alt: att.alt + fix.altCorr,
      roll: att.roll,
    };
    const cosA = Math.cos(att.alt * D2R);
    const predictedPx = pred.map((s) => ({
      ...skyToScreen(s.e - fix.azCorr * cosA, s.u - fix.altCorr, att.roll, fix.pxPerDeg),
      name: s.index != null ? (NAMES[s.index] ?? '') : '',
      mag: s.mag,
    }));
    setRes({ fix, correctedAtt, predictedPx });
  }, [enabled, blobs]);

  return res;
}
