import { useMemo } from 'react';
import { Circle, G, Line, Path, Svg, Text as SvgText } from 'react-native-svg';

import { t } from '../i18n';
import { theme } from '../theme';

export type Offset = { x: number; y: number };

/** A predicted catalog star: screen offset plus its label ('' when the catalog has no name). */
export type FieldStar = Offset & { name?: string; mag?: number };

type Props = {
  size: number;
  roll: number;
  pole: Offset;
  polaris: Offset;
  aligned: boolean;
  star?: Offset | null;
  starLocked?: boolean;
  field?: FieldStar[] | null;
  gti?: boolean;
  degToPx?: number;
  /** Polaris' 24 h orbit around the pole: radius in px + unit tangent (screen axes). */
  orbit?: { r: number; tangent: Offset } | null;
  /** Radius of the tolerance ring in px. */
  tolPx?: number;
  /** Which way to move the mount, in screen px (already rolled). */
  correction?: Offset | null;
  /** Paint the small explanatory labels. */
  labels?: boolean;
};

const GTI_FIELD_DEG = 4.25;
const GTI_RING_DEG = [0.7, 0.74, 0.78] as const;

function polar(cx: number, cy: number, radius: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
}

/** Triangular arrow head (closed isosceles) with its tip at (tipX, tipY) pointing along `angleDeg`. */
function head(tipX: number, tipY: number, angleDeg: number, size: number): string {
  const rad = (angleDeg * Math.PI) / 180;
  const bx = tipX - Math.cos(rad) * size;
  const by = tipY - Math.sin(rad) * size;
  const nx = -Math.sin(rad) * (size / 2);
  const ny = Math.cos(rad) * (size / 2);
  return `M ${tipX} ${tipY} L ${bx + nx} ${by + ny} L ${bx - nx} ${by - ny} Z`;
}

function GtiDial({ c, degToPx, maxR }: { c: number; degToPx: number; maxR: number }) {
  const R = Math.min(GTI_FIELD_DEG * degToPx, maxR);
  const ticks = useMemo(() => {
    const out: { x1: number; y1: number; x2: number; y2: number; long: boolean }[] = [];
    for (let d = 0; d < 360; d += 5) {
      const long = d % 30 === 0;
      const a = polar(c, c, R, d);
      const inner = polar(c, c, R - (long ? 14 : 7), d);
      out.push({ x1: inner.x, y1: inner.y, x2: a.x, y2: a.y, long });
    }
    return out;
  }, [c, R]);

  const labels = useMemo(
    () =>
      [0, 3, 6, 9].map((h) => {
        const p = polar(c, c, R - 26, h * 30);
        return { h, x: p.x, y: p.y };
      }),
    [c, R],
  );

  return (
    <G>
      <Circle cx={c} cy={c} r={R} stroke={theme.colors.red} strokeWidth={2} fill="none" />
      {ticks.map((t, i) => (
        <Line
          key={i}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke={t.long ? theme.colors.red : theme.colors.redDim}
          strokeWidth={t.long ? 1.5 : 1}
        />
      ))}
      {labels.map((l) => (
        <SvgText
          key={l.h}
          x={l.x}
          y={l.y}
          fill={theme.colors.redDim}
          fontSize={10}
          fontFamily={theme.mono}
          textAnchor="middle"
        >
          {l.h}
        </SvgText>
      ))}
      {GTI_RING_DEG.map((deg, i) => (
        <Circle
          key={i}
          cx={c}
          cy={c}
          r={deg * degToPx}
          stroke={theme.colors.redDim}
          strokeWidth={1}
          fill="none"
        />
      ))}
    </G>
  );
}

export function Reticle({
  size,
  roll,
  pole,
  polaris,
  aligned,
  star,
  starLocked,
  field,
  gti,
  degToPx,
  orbit,
  tolPx,
  correction,
  labels,
}: Props) {
  const c = size / 2;
  const r = size / 2 - 8;

  const center = useMemo(() => `${c}, ${c}`, [c]);

  // The correction arrow keeps its direction and only its length is clipped to the dial.
  const corr = useMemo(() => {
    if (!correction || aligned) return null;
    const len = Math.hypot(correction.x, correction.y);
    if (!(len > 1e-6)) return null;
    const k = Math.min(Math.max(len, 24), r - 6) / len;
    const x = correction.x * k;
    const y = correction.y * k;
    return { x, y, deg: (Math.atan2(y, x) * 180) / Math.PI };
  }, [correction, aligned, r]);

  return (
    <Svg width={size} height={size}>
      <G rotation={roll} origin={center}>
        {gti && degToPx ? (
          <GtiDial c={c} degToPx={degToPx} maxR={r} />
        ) : (
          <>
            <Circle
              cx={c}
              cy={c}
              r={r}
              stroke={theme.colors.red}
              strokeWidth={2}
              fill="none"
            />
            <Circle
              cx={c}
              cy={c}
              r={size / 5}
              stroke={theme.colors.redDim}
              strokeWidth={2}
              fill="none"
            />
          </>
        )}
        <Line
          x1={c}
          y1={8}
          x2={c}
          y2={size - 8}
          stroke={theme.colors.line}
          strokeWidth={1}
        />
        <Line
          x1={8}
          y1={c}
          x2={size - 8}
          y2={c}
          stroke={theme.colors.line}
          strokeWidth={1}
        />
      </G>

      {tolPx ? (
        <Circle
          cx={c + pole.x}
          cy={c + pole.y}
          r={tolPx}
          stroke={theme.colors.green}
          strokeWidth={1}
          strokeDasharray="3 3"
          fill="none"
        />
      ) : null}

      {orbit ? (
        <Circle
          cx={c + pole.x}
          cy={c + pole.y}
          r={orbit.r}
          stroke={theme.colors.redDim}
          strokeWidth={1}
          strokeDasharray="4 4"
          fill="none"
        />
      ) : null}

      {orbit ? (
        <G>
          <Line
            x1={c + polaris.x}
            y1={c + polaris.y}
            x2={c + polaris.x + orbit.tangent.x * 16}
            y2={c + polaris.y + orbit.tangent.y * 16}
            stroke={theme.colors.red}
            strokeWidth={1.5}
          />
          <Path
            d={head(
              c + polaris.x + orbit.tangent.x * 16,
              c + polaris.y + orbit.tangent.y * 16,
              (Math.atan2(orbit.tangent.y, orbit.tangent.x) * 180) / Math.PI,
              6,
            )}
            fill={theme.colors.red}
          />
        </G>
      ) : null}

      {corr ? (
        <G>
          <Line
            x1={c}
            y1={c}
            x2={c + corr.x}
            y2={c + corr.y}
            stroke={theme.colors.redBright}
            strokeWidth={3}
          />
          <Path d={head(c + corr.x, c + corr.y, corr.deg, 10)} fill={theme.colors.redBright} />
        </G>
      ) : null}

      {labels ? (
        <>
          <SvgText
            x={c + pole.x + 12}
            y={c + pole.y + 3}
            fill={theme.colors.redDim}
            fontSize={9}
            fontFamily={theme.mono}
          >
            {t('reticle.pole')}
          </SvgText>
          <SvgText
            x={c + polaris.x + 6}
            y={c + polaris.y - 6}
            fill={theme.colors.redBright}
            fontSize={9}
            fontFamily={theme.mono}
          >
            {t('reticle.polaris')}
          </SvgText>
          {orbit ? (
            <SvgText
              x={c + pole.x}
              y={c + pole.y + orbit.r + 10}
              fill={theme.colors.redDim}
              fontSize={9}
              fontFamily={theme.mono}
              textAnchor="middle"
            >
              {t('reticle.orbit')}
            </SvgText>
          ) : null}
        </>
      ) : null}

      <Circle cx={c} cy={c} r={2} fill={theme.colors.text} />

      <Circle
        cx={c + pole.x}
        cy={c + pole.y}
        r={aligned ? 12 : 9}
        stroke={aligned ? theme.colors.redBright : theme.colors.red}
        strokeWidth={aligned ? 3 : 2}
        fill="none"
      />
      <Circle
        cx={c + polaris.x}
        cy={c + polaris.y}
        r={4}
        fill={theme.colors.redBright}
      />

      {field?.map((f, i) => (
        <G key={i}>
          <Circle cx={c + f.x} cy={c + f.y} r={1.5} fill={theme.colors.textDim} />
          {f.name ? (
            <SvgText
              x={c + f.x + 4}
              y={c + f.y - 3}
              fill={theme.colors.green}
              fontSize={9}
              fontFamily={theme.mono}
            >
              {f.name}
            </SvgText>
          ) : null}
        </G>
      ))}

      {star && (
        <G>
          <Circle
            cx={c + star.x}
            cy={c + star.y}
            r={11}
            stroke={starLocked ? theme.colors.redBright : theme.colors.text}
            strokeWidth={2}
            fill="none"
          />
          <Circle
            cx={c + star.x}
            cy={c + star.y}
            r={2}
            fill={starLocked ? theme.colors.redBright : theme.colors.text}
          />
        </G>
      )}
    </Svg>
  );
}
