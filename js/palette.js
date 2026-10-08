// Vine Link — flower palette: the classic bright, fully saturated puzzle colors, ordered so small
// levels get the most distinct hues first. Vines are drawn in the pure color for maximum contrast.
// Colorblind mode never relies on hue alone: every flower also gets a symbol on its seed and a
// unique petal count + petal shape when it blooms.

export const PALETTE = [
  { name: 'Red', hex: '#FF1A1A', symbol: 'dot', petals: 5, shape: 'round' },
  { name: 'Green', hex: '#00D62B', symbol: 'triangle', petals: 3, shape: 'pointed' },
  { name: 'Blue', hex: '#2E6BFF', symbol: 'star', petals: 8, shape: 'thin' },
  { name: 'Yellow', hex: '#FFF200', symbol: 'plus', petals: 4, shape: 'heart' },
  { name: 'Orange', hex: '#FF9900', symbol: 'diamond', petals: 6, shape: 'round' },
  { name: 'Cyan', hex: '#00FFFF', symbol: 'drop', petals: 5, shape: 'pointed' },
  { name: 'Magenta', hex: '#FF1FE6', symbol: 'square', petals: 4, shape: 'round' },
  { name: 'Pink', hex: '#FF8FC8', symbol: 'heart', petals: 6, shape: 'heart' },
  { name: 'Purple', hex: '#B44CFF', symbol: 'ring', petals: 12, shape: 'thin' },
  { name: 'White', hex: '#FFFFFF', symbol: 'hexagon', petals: 6, shape: 'pointed' },
  { name: 'Gray', hex: '#C4C4C4', symbol: 'moon', petals: 7, shape: 'round' },
  { name: 'Lime', hex: '#A6FF1A', symbol: 'bars', petals: 4, shape: 'pointed' },
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
  const flower = hexToRgb(p.hex);
  return {
    flower,
    vine: flower, // pure color: easy to tell apart at a glance
    leaf: mix(flower, [255, 255, 255], 0.3), // leaves in a lighter shade of the vine's own color
    light: mix(flower, [255, 255, 255], 0.45),
    dark: mix(flower, [20, 14, 8], 0.45),
  };
});
