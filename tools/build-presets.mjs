/**
 * Generate every theme preset from local, authoritative sources — no color value
 * is typed by hand anywhere.
 *
 * Sources:
 *   - /Applications/Prowl.app/Contents/Resources/ghostty/themes/*  (463 themes)
 *   - ~/.codex/config.toml [desktop.appearance{Light,Dark}ChromeTheme]
 *   - baseline-palette.json (tools/extract-palette.mjs) — the stop inventory DSH
 *     actually declares, asserted against lib/ladder.mjs so a DSH upgrade that
 *     changes the inventory fails the build instead of shipping partial coverage.
 *
 * A preset is emitted as its SOURCE ANCHORS plus a small preview, not as a frozen
 * token table: the table is derived by lib/ladder.mjs, the same code the browser
 * inlines, so a custom background/foreground/accent recomputes identically.
 *
 * Each preset is a light/dark theme PAIR because every DSH token carries a
 * { light, dark } value. A Ghostty theme file is self-consistent for its own
 * mode, so generation reads the matching file per mode.
 *
 * Usage: node tools/build-presets.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ANSI, contrast, parseGhosttyTheme } from './lib/ramp.mjs'
import { ACCENT_FAMILY, FAMILY_STOPS, SEMANTIC_FAMILIES, buildTokens } from './lib/ladder.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const THEME_DIR = '/Applications/Prowl.app/Contents/Resources/ghostty/themes'
const CODEX_CONFIG = `${process.env.HOME}/.codex/config.toml`

// ---------------------------------------------------------------- sources

const readTheme = (name) => {
  const file = path.join(THEME_DIR, name)
  if (!fs.existsSync(file)) throw new Error(`theme file not found: ${file}`)
  return parseGhosttyTheme(fs.readFileSync(file, 'utf8'), name)
}

/** Read the [desktop.appearance<Mode>ChromeTheme*] blocks out of the Codex config. */
function readCodexTheme(mode) {
  const header = `[desktop.appearance${mode}ChromeTheme`
  const out = {}
  let inBlock = false
  for (const line of fs.readFileSync(CODEX_CONFIG, 'utf8').split('\n')) {
    const t = line.trim()
    if (t.startsWith('[')) {
      if (inBlock && !t.startsWith(header)) break
      inBlock = t.startsWith(header)
      continue
    }
    if (!inBlock) continue
    // Colors are double-quoted; font stacks are single-quoted.
    const m = /^([A-Za-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(t)
    if (m) out[m[1]] = m[2] ?? m[3]
  }
  if (!out.surface || !out.ink) throw new Error(`Codex ${mode} chrome theme is missing surface/ink`)
  return out
}

const codex = { light: readCodexTheme('Light'), dark: readCodexTheme('Dark') }
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'baseline-palette.json'), 'utf8'))

// ---------------------------------------------------------------- inventory assertion

/**
 * The ladder must cover exactly DSH's declared stops. Anything DSH adds or
 * removes has to surface here rather than as an unstyled token in the UI.
 */
const declared = {}
for (const name of Object.keys(baseline.tokens)) {
  const m = /^--dsw-static-([a-z-]+?)-(\d.*)$/.exec(name)
  if (m) (declared[m[1]] ??= []).push(m[2])
}
for (const labels of Object.values(declared)) labels.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))

const inventoryProblems = []
for (const [family, labels] of Object.entries(declared)) {
  const ours = FAMILY_STOPS[family]
  if (!ours) {
    inventoryProblems.push(`${family}: DSH declares it, the ladder does not`)
    continue
  }
  const missing = labels.filter((l) => !ours.includes(l))
  const extra = ours.filter((l) => !labels.includes(l))
  if (missing.length) inventoryProblems.push(`${family}: ladder is missing ${missing.join(', ')}`)
  if (extra.length) inventoryProblems.push(`${family}: ladder has unknown ${extra.join(', ')}`)
}
for (const family of Object.keys(FAMILY_STOPS)) {
  if (!declared[family]) inventoryProblems.push(`${family}: ladder declares it, DSH does not`)
}
if (inventoryProblems.length) {
  console.error('stop inventory mismatch against baseline-palette.json:')
  for (const p of inventoryProblems) console.error('  ' + p)
  process.exit(1)
}
console.log(`stop inventory: ${Object.keys(declared).length} families, ${Object.values(declared).flat().length} stops — matches DSH`)

// ---------------------------------------------------------------- presets

/**
 * `tuned: true` keeps the Codex app's own endpoints and accent instead of the
 * raw theme file's, so the default preset reproduces what was already shipped
 * and verified rather than silently shifting.
 */
const PRESETS = [
  { id: 'flexoki', label: 'Flexoki', light: 'Flexoki Light', dark: 'Flexoki Dark', tuned: true },
  { id: 'catppuccin', label: 'Catppuccin', light: 'Catppuccin Latte', dark: 'Catppuccin Mocha' },
  { id: 'gruvbox', label: 'Gruvbox', light: 'Gruvbox Light', dark: 'Gruvbox Dark' },
  { id: 'everforest', label: 'Everforest', light: 'Everforest Light Med', dark: 'Everforest Dark Hard' },
  { id: 'github', label: 'GitHub', light: 'GitHub Light Default', dark: 'GitHub Dark Default' },
  { id: 'nord', label: 'Nord', light: 'Nord Light', dark: 'Nord' },
  { id: 'rose-pine', label: 'Rosé Pine', light: 'Rose Pine Dawn', dark: 'Rose Pine Moon' },
  { id: 'kanagawa', label: 'Kanagawa', light: 'Kanagawa Lotus', dark: 'Kanagawa Wave' },
  { id: 'modus', label: 'Modus', light: 'Modus Operandi Tinted', dark: 'Modus Vivendi Tinted' },
  { id: 'atom-one', label: 'Atom One', light: 'Atom One Light', dark: 'Atom One Dark' },
]

function buildSources(spec) {
  const L = readTheme(spec.light)
  const D = readTheme(spec.dark)
  const tuned = spec.tuned
  // `tuned` only redirects the background/foreground/accent endpoints; the
  // semantic families always come from the theme file's own ANSI palette. DSH
  // names the yellow family "amber".
  const FAMILY_ANSI = { red: 'red', green: 'green', amber: 'yellow', blue: 'blue' }
  const at = (name, mode) => {
    const value = (mode === 'light' ? L : D).palette[ANSI[name]]
    if (!value) throw new Error(`${spec.id}: no ANSI ${name} in ${mode === 'light' ? spec.light : spec.dark}`)
    return value
  }
  const sources = {
    lightBg: tuned ? codex.light.surface : L.bg,
    lightFg: tuned ? codex.light.ink : L.fg,
    darkBg: tuned ? codex.dark.surface : D.bg,
    darkFg: tuned ? codex.dark.ink : D.fg,
    // Light mode's lightest color doubles as the "paper" the dark ramp starts
    // from: dark aliases read stop 00 for text on dark surfaces.
    paper: L.bg,
  }
  for (const family of SEMANTIC_FAMILIES) {
    const ansi = FAMILY_ANSI[family]
    sources[family] = { light: at(ansi, 'light'), dark: at(ansi, 'dark') }
  }
  sources[ACCENT_FAMILY] = {
    light: tuned ? codex.light.accent : at('blue', 'light'),
    dark: tuned ? codex.dark.accent : at('blue', 'dark'),
  }
  return sources
}

const presets = PRESETS.map((spec) => {
  const sources = buildSources(spec)
  const tokens = buildTokens(sources)
  const g = (family, label, mode) => {
    const value = tokens[`--dsw-static-${family}-${label}`]
    if (!value) throw new Error(`${spec.id}: missing --dsw-static-${family}-${label}`)
    return value[mode]
  }
  const nb = (stop) => FAMILY_STOPS['neutral-bluish'].find((l) => Number.parseInt(l, 10) === stop)
  return {
    id: spec.id,
    label: spec.label,
    theme: { light: spec.light, dark: spec.dark },
    sources,
    preview: {
      lightBg: g('neutral-bluish', nb(0), 'light'),
      darkBg: g('neutral-bluish', nb(950), 'dark'),
      lightFg: g('neutral-bluish', nb(1000), 'light'),
      darkFg: g('neutral-bluish', nb(50), 'dark'),
      lightAccent: g(ACCENT_FAMILY, '500', 'light'),
      darkAccent: g(ACCENT_FAMILY, '500', 'dark'),
    },
  }
})

// ---------------------------------------------------------------- fonts (preset-independent)

const fonts = {}
if (codex.dark.ui) fonts['--dsw-font-family'] = codex.dark.ui
if (codex.dark.code) fonts['--ds-font-family-code'] = codex.dark.code

// ---------------------------------------------------------------- evidence

const REPORT_STOPS = { primary: [1000, 50], secondary: [700, 300], tertiary: [600, 400] }
/** The light ladder reads no text above stop 700 (750+ are dark-mode surfaces). */
const LIGHT_LADDER = [200, 400, 600, 700, 1000]
const DARK_LADDER = [600, 400, 300, 50]

const nbLabel = (stop) => FAMILY_STOPS['neutral-bluish'].find((l) => Number.parseInt(l, 10) === stop)

const report = presets.map((preset) => {
  const tokens = buildTokens(preset.sources)
  const colour = (stop, mode) => tokens[`--dsw-static-neutral-bluish-${nbLabel(stop)}`][mode]
  const lightBg = colour(0, 'light')
  const darkBg = colour(950, 'dark')

  const checks = {}
  for (const [name, [lightStop, darkStop]] of Object.entries(REPORT_STOPS)) {
    checks[name] = {
      light: Number(contrast(colour(lightStop, 'light'), lightBg).toFixed(2)),
      dark: Number(contrast(colour(darkStop, 'dark'), darkBg).toFixed(2)),
    }
  }
  checks['surface separation (dark 950 vs 875)'] = { dark: Number(contrast(darkBg, colour(875, 'dark')).toFixed(3)) }

  // A ladder that inverts would make "secondary" read stronger than "primary".
  const ladder = (stops, mode, bg) => stops.map((s) => contrast(colour(s, mode), bg))
  const ascending = (xs) => xs.every((v, i) => i === 0 || v >= xs[i - 1] - 1e-6)

  const failures = []
  if (checks.primary.light < 4.5) failures.push('primary light <4.5')
  if (checks.primary.dark < 4.5) failures.push('primary dark <4.5')
  if (checks.secondary.light < 3.0) failures.push('secondary light <3.0')
  if (checks.secondary.dark < 3.0) failures.push('secondary dark <3.0')
  if (checks.tertiary.light < 3.0) failures.push('tertiary light <3.0')
  if (checks.tertiary.dark < 3.0) failures.push('tertiary dark <3.0')
  if (checks['surface separation (dark 950 vs 875)'].dark < 1.1) failures.push('surface separation <1.1')
  if (!ascending(ladder(LIGHT_LADDER, 'light', lightBg))) failures.push('light ladder inverts')
  if (!ascending(ladder(DARK_LADDER, 'dark', darkBg))) failures.push('dark ladder inverts')

  return { preset: preset.id, tokens: Object.keys(tokens).length, checks, failures, pass: failures.length === 0 }
})

const out = {
  generatedAt: new Date().toISOString(),
  sources: { themes: THEME_DIR, codex: CODEX_CONFIG, baseline: 'baseline-palette.json' },
  defaultPreset: 'flexoki',
  familyStops: FAMILY_STOPS,
  fonts,
  presets,
  report,
}

fs.writeFileSync(path.join(root, 'presets.json'), JSON.stringify(out, null, 2) + '\n')

console.log('')
console.log('preset       primary(l/d)   secondary(l/d)  tertiary(l/d)   surf-sep   verdict')
for (const r of report) {
  const c = r.checks
  console.log(
    `${r.preset.padEnd(12)} ` +
      `${String(c.primary.light).padStart(5)}/${String(c.primary.dark).padEnd(5)}  ` +
      `${String(c.secondary.light).padStart(5)}/${String(c.secondary.dark).padEnd(5)}  ` +
      `${String(c.tertiary.light).padStart(5)}/${String(c.tertiary.dark).padEnd(5)}  ` +
      `${String(c['surface separation (dark 950 vs 875)'].dark).padStart(6)}   ` +
      (r.pass ? 'pass' : 'FAIL: ' + r.failures.join(', ')),
  )
}
const failing = report.filter((r) => !r.pass)
console.log('')
console.log(failing.length ? `${failing.length} preset(s) FAIL` : `all ${report.length} presets pass every gate (text 4.5 / large+graphic 3.0 / surface 1.1 / monotonic ladder)`)
console.log(`wrote presets.json (${presets.length} presets, sources only — tokens are derived)`)
