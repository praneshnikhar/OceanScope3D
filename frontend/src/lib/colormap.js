const PALETTES = {
  thermal: [
    [4, 6, 26],
    [50, 12, 90],
    [120, 28, 109],
    [187, 55, 84],
    [237, 105, 37],
    [252, 181, 25],
    [252, 255, 164],
  ],
  ocean: [
    [13, 27, 62],
    [24, 69, 118],
    [31, 116, 158],
    [53, 168, 158],
    [133, 208, 163],
    [222, 245, 197],
  ],
  diverging: [
    [49, 54, 149],
    [97, 143, 227],
    [178, 216, 240],
    [247, 247, 247],
    [252, 200, 155],
    [239, 129, 74],
    [165, 15, 21],
  ],
}

export function samplePalette(name, t) {
  const stops = PALETTES[name] || PALETTES.thermal
  const x = Math.min(1, Math.max(0, t))
  const scaled = x * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(scaled))
  const f = scaled - i
  const a = stops[i]
  const b = stops[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

export function colorFor(name, value, min, max) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  if (max === min) return samplePalette(name, 0)
  return samplePalette(name, (value - min) / (max - min))
}

export const PALETTE_NAMES = Object.keys(PALETTES)
