export const formatCoord = (v: number, digits = 5): string => v.toFixed(digits);

export const formatLatLon = (
  lat?: number | null,
  lon?: number | null,
): string => {
  if (lat == null || lon == null) return '—';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${formatCoord(Math.abs(lat))}° ${ns}  ${formatCoord(Math.abs(lon))}° ${ew}`;
};

export const formatClock = (d: Date): string =>
  d.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export const formatAngle = (deg: number, digits = 3): string =>
  `${deg.toFixed(digits)}°`;

const pad2 = (n: number): string => n.toString().padStart(2, '0');

export const formatHours = (hours: number): string => {
  const total = Math.round((((hours % 24) + 24) % 24) * 3600) % 86400;
  return `${pad2(Math.floor(total / 3600))}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`;
};
