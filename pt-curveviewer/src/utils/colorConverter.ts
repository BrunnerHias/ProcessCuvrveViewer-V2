// ============================================================
// Color Converter: Integer color values → CSS colors
// ============================================================

/**
 * Converts an integer color value (RGB format as used by AMS ZPoint-CI/WDS)
 * to a CSS hex color string.
 *
 * API formula: Color = (Red * 65536) + (Green * 256) + Blue
 * i.e. RGB big-endian: R in bits 16-23, G in bits 8-15, B in bits 0-7
 */
export function intColorToHex(colorInt: number): string {
  if (colorInt === undefined || colorInt === null) return '#000000';
  const n = Math.abs(Math.round(colorInt));
  const r = (n >> 16) & 0xFF;
  const g = (n >> 8) & 0xFF;
  const b = n & 0xFF;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Converts an integer color value to an rgba string with optional alpha.
 *
 * API formula: Color = (Red * 65536) + (Green * 256) + Blue
 */
export function intColorToRgba(colorInt: number, alpha = 1): string {
  if (colorInt === undefined || colorInt === null) return `rgba(0,0,0,${alpha})`;
  const n = Math.abs(Math.round(colorInt));
  const r = (n >> 16) & 0xFF;
  const g = (n >> 8) & 0xFF;
  const b = n & 0xFF;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Maps an AMS ZPoint-CI LineStyle integer (1–10) to an ECharts dash array.
 *
 * | Value | Description               | ECharts dash pattern       |
 * |-------|---------------------------|----------------------------|
 * |   1   | Solid                     | 'solid' (no dash)          |
 * |   2   | Dense dots  ...........   | [2, 2]                     |
 * |   3   | Spaced dots . . . . .     | [2, 4]                     |
 * |   4   | Wide-spaced dots          | [2, 8]                     |
 * |   5   | Short dashes - - - - -    | [6, 4]                     |
 * |   6   | Medium dashes -- -- --    | [10, 4]                    |
 * |   7   | Long dashes --- --- ---   | [14, 4]                    |
 * |   8   | Short dashes, wider gaps  | [6, 8]                     |
 * |   9   | Wide-spaced short dashes  | [6, 14]                    |
 * |  10   | Wide-spaced medium dashes | [10, 10]                   |
 */
export function lineStyleToDash(style: number): number[] | 'solid' {
  switch (style) {
    case 1:  return 'solid';
    case 2:  return [2, 2];
    case 3:  return [2, 4];
    case 4:  return [2, 8];
    case 5:  return [6, 4];
    case 6:  return [10, 4];
    case 7:  return [14, 4];
    case 8:  return [6, 8];
    case 9:  return [6, 14];
    case 10: return [10, 10];
    default: return 'solid';
  }
}

/**
 * Maps an AMS ZPoint-CI LineStyle integer (1–10) to an ECharts borderType string
 * for markArea / markLine borders. ECharts borderType only supports
 * 'solid' | 'dashed' | 'dotted' | number[].
 */
export function lineStyleToBorderType(style: number): string | number[] {
  const dash = lineStyleToDash(style);
  if (dash === 'solid') return 'solid';
  return dash; // ECharts borderType also accepts number[]
}
