// Vine Link — pipe colors: the classic, fully saturated puzzle set, on a white game board
// (brown stands in for white, which would vanish on white tiles).
// Ordered so small levels use the most distinct colors first. Colorblind mode adds a unique
// symbol on every dot, so color is never the only cue.

export const PALETTE = [
  { name: 'Red', hex: '#FF0000', symbol: 'dot' },
  { name: 'Green', hex: '#008D00', symbol: 'triangle' },
  { name: 'Blue', hex: '#0000FF', symbol: 'star' },
  { name: 'Yellow', hex: '#EEEE00', symbol: 'plus' },
  { name: 'Orange', hex: '#FF8000', symbol: 'diamond' },
  { name: 'Cyan', hex: '#00FFFF', symbol: 'drop' },
  { name: 'Magenta', hex: '#FF00FF', symbol: 'square' },
  { name: 'Pink', hex: '#FF8FC8', symbol: 'heart' },
  { name: 'Purple', hex: '#800080', symbol: 'ring' },
  { name: 'Brown', hex: '#8B5A2B', symbol: 'hexagon' },
  { name: 'Gray', hex: '#A6A6A6', symbol: 'moon' },
  { name: 'Lime', hex: '#00FF00', symbol: 'bars' },
];

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba([r, g, b], a = 1) {
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Pre-computed colors for drawing. */
export const COLORS = PALETTE.map((p) => {
  const rgb = hexToRgb(p.hex);
  return {
    rgb,
    light: mix(rgb, [255, 255, 255], 0.5),
    edge: mix(rgb, [20, 20, 40], 0.38), // outline for pipes and dots on the white board
  };
});
