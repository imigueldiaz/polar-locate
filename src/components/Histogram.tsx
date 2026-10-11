import { Rect, Svg } from 'react-native-svg';

import { theme } from '../theme';

type Props = {
  /** Normalised bins (0..1), as returned by `histogram()` in src/lib/meter.ts. */
  bins: number[];
  width: number;
  height: number;
};

/** Tiny luminance histogram: left is black, right is blown out. */
export function Histogram({ bins, width, height }: Props) {
  if (!bins.length) return null;
  const step = width / bins.length;
  return (
    <Svg width={width} height={height}>
      {bins.map((v, i) => (
        <Rect
          key={i}
          x={i * step}
          y={height * (1 - v)}
          width={Math.max(1, step - 1)}
          height={Math.max(1, height * v)}
          fill={theme.colors.redDim}
        />
      ))}
    </Svg>
  );
}
