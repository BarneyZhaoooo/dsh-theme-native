/**
 * The token ladder: DSH's stop inventory and the one function that turns source
 * anchors into the full `--dsw-static-*` payload.
 *
 * This module is shared verbatim between the build tools and the browser: the
 * bundle generator strips the `export ` keywords and inlines it, so a custom
 * color recomputed at runtime goes through exactly the code that produced the
 * shipped presets. If the two ever diverged, tools/verify-runtime.mjs fails.
 *
 * A preset is therefore stored as its SOURCE ANCHORS (background, foreground and
 * one base color per semantic family), not as a frozen token table — the table
 * is a derived value that any background/foreground/accent edit can regenerate.
 */
import { buildFamily, buildRamp, contrast, mix, raiseToContrast } from './ramp.mjs'

/**
 * Stop labels exactly as DSH declares them in its own stylesheets.
 * tools/build-presets.mjs asserts these against baseline-palette.json, so a DSH
 * upgrade that adds or removes a stop fails the build instead of silently
 * shipping a partially-covered theme.
 */
export const FAMILY_STOPS = {
  'neutral-bluish': ['00', '50', '60', '75', '100', '150', '200', '300', '400', '500', '600', '700', '750', '800', '850', '875', '900', '950', '1000'],
  neutral: ['00', '50', '100', '150', '200', '250', '300', '400', '500', '550', '600', '700', '800', '850', '900', '1000'],
  red: ['50', '100', '400', '400-a12', '500', '600', '600-a08', '900'],
  green: ['100', '400', '500', '500-a08', '500-a12', '900'],
  amber: ['100', '400', '500', '600', '900'],
  blue: ['50', '50p', '75', '100', '300', '400', '450', '500', '600', '800', '900', '950'],
  deepseek: ['50', '100', '200', '300', '400', '450', '500', '600', '700-delete', '800', '900'],
}

export const NEUTRAL_BLUISH_STOPS = FAMILY_STOPS['neutral-bluish'].map(Number)
export const PLAIN_NEUTRAL_STOPS = FAMILY_STOPS.neutral.map(Number)

/** Families whose base color comes from the theme's ANSI palette. */
export const SEMANTIC_FAMILIES = ['red', 'green', 'amber', 'blue']

/** The accent family is separate: it is the user-facing 强调色 control. */
export const ACCENT_FAMILY = 'deepseek'

/**
 * Contrast floors for the text ladder.
 *
 * Presets inherit their theme's contrast budget, and several themes ship a soft
 * foreground, which pushed secondary/tertiary text below what DSH's own defaults
 * deliver. The ladder is therefore floored at WCAG AA body text (4.5) for the
 * secondary tier and at the large-text/graphic tier (3.0) for tertiary, clamped
 * by the theme's own budget so a low-contrast theme degrades proportionally
 * instead of becoming unreachable.
 */
export const SECONDARY_FLOOR = 4.5
export const TERTIARY_FLOOR = 3.0

const STATIC = (family, label) => `--dsw-static-${family}-${label}`

/** Build the two neutral ramps for a background/foreground pair. */
export function neutralRamps(lightBg, lightFg, darkBg, darkFg, paper) {
  const bluishLight = buildRamp(NEUTRAL_BLUISH_STOPS, [
    [0, lightBg],
    [200, mix(lightBg, lightFg, 0.18)],
    [500, mix(lightBg, lightFg, 0.5)],
    [700, mix(lightBg, lightFg, 0.72)],
    [1000, lightFg],
  ])
  // Dark aliases read stop 50 as primary text and 950 as the base background,
  // so the ramp has to pass through both rather than run end to end.
  const bluishDark = buildRamp(NEUTRAL_BLUISH_STOPS, [
    [0, paper],
    [50, darkFg],
    [500, mix(darkFg, darkBg, 0.5)],
    [800, mix(darkFg, darkBg, 0.82)],
    [950, darkBg],
    [1000, '#000000'],
  ])

  for (const [ramp, bg, fg, secondaryStop, tertiaryStop, primaryStop] of [
    [bluishLight, lightBg, lightFg, 700, 600, 1000],
    [bluishDark, darkBg, darkFg, 300, 400, 50],
  ]) {
    const budget = contrast(ramp[primaryStop], bg)
    ramp[secondaryStop] = raiseToContrast(ramp[secondaryStop], fg, bg, Math.min(SECONDARY_FLOOR, budget * 0.95))
    ramp[tertiaryStop] = raiseToContrast(ramp[tertiaryStop], fg, bg, Math.min(TERTIARY_FLOOR, budget * 0.65))
  }

  const plainLight = buildRamp(PLAIN_NEUTRAL_STOPS, [
    [0, mix(lightBg, '#ffffff', 0.35)],
    [500, mix(lightBg, lightFg, 0.5)],
    [1000, mix(lightFg, '#000000', 0.15)],
  ])
  const plainDark = buildRamp(PLAIN_NEUTRAL_STOPS, [
    [0, paper],
    [50, darkFg],
    [500, mix(darkFg, darkBg, 0.5)],
    [950, darkBg],
    [1000, '#000000'],
  ])

  return { bluish: { light: bluishLight, dark: bluishDark }, plain: { light: plainLight, dark: plainDark } }
}

/**
 * Turn a preset's source anchors into its complete token payload.
 *
 * @param sources see the shape written by tools/build-presets.mjs: raw colors
 *                only, never derived tokens.
 */
export function buildTokens(sources) {
  const { lightBg, lightFg, darkBg, darkFg, paper, accent } = sources
  const ramps = neutralRamps(lightBg, lightFg, darkBg, darkFg, paper)
  const tokens = {}

  for (const [family, rampKey] of [['neutral-bluish', 'bluish'], ['neutral', 'plain']]) {
    const stops = family === 'neutral' ? PLAIN_NEUTRAL_STOPS : NEUTRAL_BLUISH_STOPS
    const ramp = ramps[rampKey]
    for (const stop of stops) {
      const label = FAMILY_STOPS[family].find((l) => Number.parseInt(l, 10) === stop)
      if (label === undefined) throw new Error(`${family}: no label for stop ${stop}`)
      tokens[STATIC(family, label)] = { light: ramp.light[stop], dark: ramp.dark[stop] }
    }
  }

  for (const family of [...SEMANTIC_FAMILIES, ACCENT_FAMILY]) {
    const base = sources[family]
    if (!base) throw new Error(`sources.${family} is missing`)
    const built = buildFamily(FAMILY_STOPS[family], base.light, base.dark, lightBg, darkBg)
    for (const [label, value] of Object.entries(built)) {
      // DSH ships a `50p` twin of `50`; nudge it so the two stops stay distinct.
      tokens[STATIC(family, label)] = label.endsWith('p')
        ? { light: mix(value.light, lightFg, 0.04), dark: mix(value.dark, darkFg, 0.04) }
        : value
    }
  }

  return tokens
}
