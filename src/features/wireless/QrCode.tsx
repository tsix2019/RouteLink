import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

import { qrMatrix } from './wifiQr';

/** A QR code drawn as one SVG path (dark modules on a white quiet zone, so cameras read it in dark mode too). */
export function QrCode({ text, size }: { text: string; size: number }) {
  const { path, count } = useMemo(() => {
    const matrix = qrMatrix(text);
    let d = '';
    matrix.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      }),
    );
    return { path: d, count: matrix.length + 8 };
  }, [text]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${count} ${count}`}>
      <Rect width={count} height={count} fill="#ffffff" />
      <Path d={path} fill="#000000" />
    </Svg>
  );
}
