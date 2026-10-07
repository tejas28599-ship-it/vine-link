// Vine Link — flower palette. Ordered so small levels get the most distinct hues first.
// Colorblind mode never relies on hue alone: every flower also gets a symbol on its seed and a
// unique petal count + petal shape when it blooms.

export const PALETTE = [
  { name: 'Poppy', hex: '#F2545B', symbol: 'dot', petals: 5, shape: 'round' },
  { name: 'Cornflower', hex: '#3D7DF2', symbol: 'triangle', petals: 3, shape: 'pointed' },
  { name: 'Sunflower', hex: '#FFD43B', symbol: 'star', petals: 8, shape: 'thin' },
  { name: 'Clover', hex: '#34C76F', symbol: 'plus', petals: 4, shape: 'heart' },
  { name: 'Marigold', hex: '#FF8C2E', symbol: 'diamond', petals: 6, shape: 'round' },
  { name: 'Morning Glory', hex: '#3FD3E6', symbol: 'drop', petals: 5, shape: 'pointed' },
  { name: 'Orchid', hex: '#B06CF5', symbol: 'square', petals: 4, shape: 'round' },
  { name: 'Peony', hex: '#FF8FC7', symbol: 'heart', petals: 6, shape: 'heart' },
  { name: 'Daisy', hex: '#F7F3E8', symbol: 'ring', petals: 12, shape: 'thin' },
  { name: 'Ruby', hex: '#C2185B', symbol: 'hexagon', petals: 6, shape: 'pointed' },
  { name: 'Lime', hex: '#C4F04A', symbol: 'moon', petals: 7, shape: 'round' },
  { name: 'Wheat', hex: '#D9B38C', symbol: 'bars', petals: 4, shape: 'pointed' },
];

export const STEM = '#6FBF4F';
export const LEAF = '#7BCB57';

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
  const stem = hexToRgb(STEM);
  return {
    flower,
    vine: mix(flower, stem, 0.22), // green stem tinted with the flower's color
    leaf: mix(hexToRgb(LEAF), flower, 0.28),
    light: mix(flower, [255, 255, 255], 0.45),
    dark: mix(flower, [20, 14, 8], 0.45),
  };
});
