/**
 * Shared color math and ramp construction for the DSH theme presets.
 *
 * DSH's token model is a two-layer indirection: ~99 `--dsw-alias-*` semantic
 * tokens all reference stops of ~77 `--dsw-static-*` palettes, and those static
 * palettes hold the SAME value in light and dark. The modes differ only in which
 * stop each alias reads. So a re-skin means re-laying the static ramps, and the
 * alias layer — hover, active, border and elevation derivations included —
 * follows for free.
 *
 * Ramps are interpolated in Oklab. Stop numbers are treated as a lightness
 * scale (t = stop / 1000), which is how both DSH's stops and Flexoki's base
 * scale are laid out.
 */

// ---------------------------------------------------------------- color math

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

export function hexToRgb(hex) {
  if (typeof hex !== 'string') throw new TypeError(`expected a hex color, got ${JSON.stringify(hex)}`)
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  // 8-digit forms carry alpha; the ramp math works on the opaque triple.
  if (h.length === 8) h = h.slice(0, 6)
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new TypeError(`not a hex color: ${hex}`)
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
}

export const rgbToHex = (rgb) =>
  '#' + rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')

export function rgbToOklab([r, g, b]) {
  const [R, G, B] = [r, g, b].map(srgbToLinear)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function oklabToRgb([L, a, bb]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

const lerp = (a, b, t) => a + (b - a) * t

/** Interpolate two hex colors in Oklab. */
export function mix(from, to, t) {
  const A = rgbToOklab(hexToRgb(from))
  const B = rgbToOklab(hexToRgb(to))
  return rgbToHex(oklabToRgb([0, 1, 2].map((i) => lerp(A[i], B[i], t))))
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio. */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** `a12` -> 12% -> the two-digit alpha suffix DSH writes (`1f`). */
export const alphaSuffix = (pct) => Math.round((pct / 100) * 255).toString(16).padStart(2, '0')

/**
 * Lift `start` toward `toward` until it reaches `targetContrast` against
 * `surface`, or return it unchanged when it already does.
 *
 * Mixing toward the foreground raises contrast monotonically, so a bisection is
 * exact. This is a floor, never a ceiling: a stop that already clears the target
 * is returned untouched, which is what keeps an already-verified preset stable.
 */
export function raiseToContrast(start, toward, surface, targetContrast) {
  if (contrast(start, surface) >= targetContrast) return start
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2
    if (contrast(mix(start, toward, mid), surface) >= targetContrast) hi = mid
    else lo = mid
  }
  return mix(start, toward, hi)
}

// ---------------------------------------------------------------- ramps

/**
 * Build a ramp by interpolating through pinned knots.
 *
 * @param stops  stop numbers that exist for this family
 * @param knots  [stop, color] pins, sorted ascending; must span 0..1000
 */
export function buildRamp(stops, knots) {
  const sorted = [...knots].sort((a, b) => a[0] - b[0])
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i][0] === sorted[i - 1][0]) throw new Error(`duplicate ramp knot at stop ${sorted[i][0]}`)
  }
  const value = (stop) => {
    if (stop <= sorted[0][0]) return sorted[0][1]
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const [s0, c0] = sorted[i]
      const [s1, c1] = sorted[i + 1]
      if (stop >= s0 && stop <= s1) return mix(c0, c1, (stop - s0) / (s1 - s0))
    }
    return sorted[sorted.length - 1][1]
  }
  return Object.fromEntries(stops.map((s) => [s, value(s)]))
}

// ---------------------------------------------------------------- theme files

/**
 * Read a Ghostty-format theme (what Prowl ships 463 of).
 *
 * Each file is self-consistent for its own mode: the light file's palette is
 * tuned for a light background and the dark file's for a dark one, so preset
 * generation reads the matching file per mode rather than transforming one.
 */
export function parseGhosttyTheme(text, label = 'theme') {
  const out = { palette: {}, bg: null, fg: null }
  for (const line of text.split('\n')) {
    const m = /^\s*(palette|background|foreground)\s*=\s*(?:(\d+)=)?(#?[0-9a-fA-F]+)\s*$/.exec(line)
    if (!m) continue
    if (m[1] === 'palette') out.palette[Number(m[2])] = m[3]
    else if (m[1] === 'background') out.bg = m[3]
    else out.fg = m[3]
  }
  if (!out.bg || !out.fg) throw new Error(`${label}: no background/foreground line found`)
  return out
}

/** Ghostty ANSI indices used as preset sources. */
export const ANSI = { red: 1, green: 2, yellow: 3, blue: 4, cyan: 6, magenta: 5 }

// ---------------------------------------------------------------- semantic families

/**
 * Lay one semantic family's stops from a single base color per mode.
 *
 * Tints below the base stop ease toward the mode's surface; shades above it ease
 * toward near-black. The exponents are what keep the lightest stops close to the
 * background, which is how DSH's own ramps (and Tailwind's) are shaped.
 *
 * @param stops     stop labels present for this family, e.g. ['50','100','400-a12']
 * @param baseLight base color in light mode
 * @param baseDark  base color in dark mode
 * @param surfaceLight / surfaceDark  the mode's background, the tint target
 * @param baseStop  the stop treated as "the color itself"
 */
export function buildFamily(stops, baseLight, baseDark, surfaceLight, surfaceDark, baseStop = 500) {
  const numbers = stops.map((s) => Number.parseInt(s, 10)).filter(Number.isFinite)
  const low = Math.min(...numbers)
  const high = Math.max(...numbers)

  const one = (stop, base, surface) => {
    if (stop === baseStop) return base
    if (stop < baseStop) {
      const t = (baseStop - stop) / (baseStop - low || 1)
      return mix(base, surface, 1 - (1 - t) ** 1.5)
    }
    const t = (stop - baseStop) / (high - baseStop || 1)
    return mix(base, '#000000', 0.88 * t ** 1.2)
  }

  const perStop = (label) => {
    const num = Number.parseInt(label, 10)
    if (!Number.isFinite(num)) throw new Error(`stop label ${label} has no leading number`)
    return { light: one(num, baseLight, surfaceLight), dark: one(num, baseDark, surfaceDark) }
  }

  const out = {}
  for (const label of stops) {
    // `-aNN` alpha variants reuse their base stop's color and re-attach alpha.
    const alpha = /-a(\d+)$/.exec(label)
    if (alpha) {
      const baseLabel = label.replace(/-a\d+$/, '')
      const base = perStop(baseLabel)
      const suffix = alphaSuffix(Number(alpha[1]))
      out[label] = { light: base.light + suffix, dark: base.dark + suffix }
      continue
    }
    out[label] = perStop(label)
  }
  return out
}
