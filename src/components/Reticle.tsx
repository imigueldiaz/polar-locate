import { useMemo } from 'react';
import { Circle, G, Line, Svg } from 'react-native-svg';

import { theme } from '../theme';

export type Offset = { x: number; y: number };

type Props = {
  size: number;
  roll: number;
  pole: Offset;
  polaris: Offset;
  aligned: boolean;
  star?: Offset | null;
  starLocked?: boolean;
  field?: Offset[] | null;
};

export function Reticle({ size, roll, pole, polaris, aligned, star, starLocked, field }: Props) {
  const c = size / 2;
  const r = size / 2 - 8;

  const center = useMemo(() => `${c}, ${c}`, [c]);

  return (
    <Svg width={size} height={size}>
      <G rotation={roll} origin={center}>
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
        <Circle key={i} cx={c + f.x} cy={c + f.y} r={1.5} fill={theme.colors.textDim} />
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
