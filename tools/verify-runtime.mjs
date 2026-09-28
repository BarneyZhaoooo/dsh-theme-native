/**
 * Verify the SHIPPED client artifact, not the source tree.
 *
 * The bundle inlines tools/lib/ramp.mjs + tools/lib/ladder.mjs into a plain
 * browser factory. That inlining is the only place the build-time and runtime
 * color math could drift, so this script:
 *
 *   1. extracts the inlined block back out of plugin/client.js and evaluates it,
 *   2. proves it agrees with the source modules on real and synthetic inputs,
 *   3. property-tests custom backgrounds/foregrounds against the documented
 *      floors, ladder monotonicity and completeness, and
 *   4. checks presets.json previews against a fresh recomputation, and
 *   5. guards the override payload shape — a bare string reaching
 *      ctx.theme.overrideTokens throws inside the plugin callback and aborts the
 *      whole web boot with "1 entry did not activate".
 *
 * A static syntax check cannot substitute for this: it would pass on a bundle
 * whose inlined copy had silently diverged.
 *
 * Usage: node tools/verify-runtime.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as ramp from './lib/ramp.mjs'
import * as ladder from './lib/ladder.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const failures = []
const check = (ok, label, detail = '') => {
  if (!ok) failures.push(`${label}${detail ? ' — ' + detail : ''}`)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

// ---------------------------------------------------------------- 1. extract the inlined block

const clientSrc = fs.readFileSync(path.join(root, 'plugin', 'client.js'), 'utf8')
// Staleness gate first: the client half is emitted from one big template literal in
// tools/emit-plugin.mjs, so a stray backtick there aborts the emit and leaves the
// previous bundle in place. Without this check every later assertion would pass
// against that old artifact.
const expectedStamp = createHash('sha1')
  .update(fs.readFileSync(path.join(root, 'tools', 'emit-plugin.mjs')))
  .update(fs.readFileSync(path.join(root, 'presets.json')))
  .digest('hex')
  .slice(0, 12)
const stampedBuild = /^\/\* build ([0-9a-f]{12}) \*\/$/m.exec(clientSrc)?.[1] ?? null
check(
  stampedBuild === expectedStamp,
  'client.js is a fresh emit of the current generator',
  `artifact ${stampedBuild ?? 'unstamped'} vs expected ${expectedStamp} — run node tools/emit-plugin.mjs`,
)
const OPEN = '// >>> inlined:ramp+ladder'
const CLOSE = '// <<< inlined:ramp+ladder'
const start = clientSrc.indexOf(OPEN)
const end = clientSrc.indexOf(CLOSE)
if (start === -1 || end === -1) {
  console.error('could not find the inlined block markers in plugin/client.js')
  process.exit(1)
}
// Take everything after the marker LINE (its remainder is a description).
const bodyStart = clientSrc.indexOf('\n', start) + 1
const inlined = clientSrc.slice(bodyStart, end)

// The block is plain top-level code once `export ` is gone; evaluate it and hand
// back the bindings it declares, which is exactly what the browser factory sees.
const exported = new Function(`
${inlined}
return { mix, contrast, buildRamp, buildFamily, raiseToContrast, neutralRamps, buildTokens, FAMILY_STOPS, NEUTRAL_BLUISH_STOPS, SECONDARY_FLOOR, TERTIARY_FLOOR, ACCENT_FAMILY }
`)()

console.log('1. inlined block')
check(inlined.length > 5000, 'inlined block is present', `${inlined.length} bytes`)
check(/function buildTokens/.test(inlined), 'declares buildTokens')
check(!/^\s*(import|export)\s/m.test(inlined), 'carries no module syntax')

// ---------------------------------------------------------------- 2. agreement with the source

const presetsDoc = JSON.parse(fs.readFileSync(path.join(root, 'presets.json'), 'utf8'))

const sampleInputs = [
  { lightBg: '#f5f3ed', lightFg: '#2f312d', darkBg: '#100f0f', darkFg: '#cecdc3', paper: '#fffcf0' },
  { lightBg: '#ffffff', lightFg: '#000000', darkBg: '#000000', darkFg: '#ffffff', paper: '#ffffff' },
  { lightBg: '#eff1f5', lightFg: '#4c4f69', darkBg: '#1e1e2e', darkFg: '#cdd6f4', paper: '#eff1f5' },
]
const rampNames = ['bluish', 'plain']
console.log('')
console.log('2. inlined vs source modules')
for (const input of sampleInputs) {
  const ours = exported.neutralRamps(input.lightBg, input.lightFg, input.darkBg, input.darkFg, input.paper)
  const theirs = ladder.neutralRamps(input.lightBg, input.lightFg, input.darkBg, input.darkFg, input.paper)
  for (const name of rampNames) {
    const same = JSON.stringify(ours[name]) === JSON.stringify(theirs[name])
    check(same, `neutralRamps(${input.lightBg}…${input.darkBg}) ${name} agrees`)
  }
}
check(
  JSON.stringify(exported.FAMILY_STOPS) === JSON.stringify(ladder.FAMILY_STOPS),
  'FAMILY_STOPS agrees',
)
for (const [family, labels] of Object.entries(ladder.FAMILY_STOPS)) {
  const n = Number.parseInt(labels[0], 10)
  check(
    Number.isFinite(n),
    `${family} stop labels start with a number`,
    `${labels.length} stops`,
  )
}

// ---------------------------------------------------------------- 3. custom color property test

const CUSTOM_CASES = []
for (const preset of presetsDoc.presets) {
  const s = preset.sources
  CUSTOM_CASES.push({ name: `${preset.id} (own anchors)`, sources: s })
  CUSTOM_CASES.push({
    name: `${preset.id} + custom accent`,
    sources: { ...s, [ladder.ACCENT_FAMILY]: { light: '#3d755d', dark: '#4385be' } },
  })
}
CUSTOM_CASES.push({
  name: 'extreme: near-black bg with near-black fg',
  sources: { ...presetsDoc.presets[0].sources, lightBg: '#111111', lightFg: '#1a1a1a' },
})
CUSTOM_CASES.push({
  name: 'extreme: white bg with white fg',
  sources: { ...presetsDoc.presets[0].sources, darkBg: '#eeeeee', darkFg: '#f5f5f5' },
})
CUSTOM_CASES.push({
  name: 'inverted: light theme on a dark background',
  sources: { ...presetsDoc.presets[0].sources, lightBg: '#101010', lightFg: '#f0f0f0' },
})

const nbLabel = (stop) => exported.FAMILY_STOPS['neutral-bluish'].find((l) => Number.parseInt(l, 10) === stop)
const expectedTokenCount = presetsDoc.report[0].tokens

console.log('')
console.log('3. custom-color property test')
let customFailures = 0
for (const testCase of CUSTOM_CASES) {
  const tokens = exported.buildTokens(testCase.sources)
  const problems = []

  if (Object.keys(tokens).length !== expectedTokenCount) {
    problems.push(`produced ${Object.keys(tokens).length} tokens, expected ${expectedTokenCount}`)
  }
  for (const [name, value] of Object.entries(tokens)) {
    if (!value || typeof value.light !== 'string' || typeof value.dark !== 'string') {
      problems.push(`${name} is not a { light, dark } pair`)
      break
    }
  }

  const at = (stop, mode) => tokens[`--dsw-static-neutral-bluish-${nbLabel(stop)}`][mode]
  const lightBg = at(0, 'light')
  const darkBg = at(950, 'dark')
  const primary = { light: exported.contrast(at(1000, 'light'), lightBg), dark: exported.contrast(at(50, 'dark'), darkBg) }

  // Documented behaviour: the ladder keeps its order, and each floored tier
  // reaches min(floor, budget * factor). A pathological pair cannot invent
  // contrast it does not have, which is why the UI warns instead.
  const ascending = (xs) => xs.every((v, i) => i === 0 || v >= xs[i - 1] - 1e-6)
  if (!ascending([200, 400, 600, 700, 1000].map((s) => exported.contrast(at(s, 'light'), lightBg)))) {
    problems.push('light ladder inverts')
  }
  if (!ascending([600, 400, 300, 50].map((s) => exported.contrast(at(s, 'dark'), darkBg)))) {
    problems.push('dark ladder inverts')
  }
  for (const mode of ['light', 'dark']) {
    const secondary = exported.contrast(at(mode === 'light' ? 700 : 300, mode), mode === 'light' ? lightBg : darkBg)
    const floor = Math.min(exported.SECONDARY_FLOOR, primary[mode] * 0.95)
    if (secondary < floor - 0.02) problems.push(`${mode} secondary ${secondary.toFixed(2)} below floor ${floor.toFixed(2)}`)
    const tertiary = exported.contrast(at(mode === 'light' ? 600 : 400, mode), mode === 'light' ? lightBg : darkBg)
    const tfloor = Math.min(exported.TERTIARY_FLOOR, primary[mode] * 0.65)
    if (tertiary < tfloor - 0.02) problems.push(`${mode} tertiary ${tertiary.toFixed(2)} below floor ${tfloor.toFixed(2)}`)
  }

  // Determinism: the browser memoises by input, so equal inputs must be equal.
  if (JSON.stringify(exported.buildTokens(testCase.sources)) !== JSON.stringify(tokens)) {
    problems.push('not deterministic across calls')
  }

  if (problems.length) customFailures += 1
  console.log(`  ${problems.length ? 'FAIL' : 'ok  '}  ${testCase.name}` +
    (problems.length ? `\n        ${problems.join('\n        ')}` : `  (light ${primary.light.toFixed(2)}:1, dark ${primary.dark.toFixed(2)}:1)`))
}
check(customFailures === 0, 'every custom-color case holds its documented invariants')

// ---------------------------------------------------------------- 4. previews match a fresh recompute

console.log('')
console.log('4. shipped previews vs recompute')
for (const preset of presetsDoc.presets) {
  const tokens = exported.buildTokens(preset.sources)
  const g = (family, label, mode) => tokens[`--dsw-static-${family}-${label}`][mode]
  const nb = (stop) => nbLabel(stop)
  const expected = {
    lightBg: g('neutral-bluish', nb(0), 'light'),
    darkBg: g('neutral-bluish', nb(950), 'dark'),
    lightFg: g('neutral-bluish', nb(1000), 'light'),
    darkFg: g('neutral-bluish', nb(50), 'dark'),
    lightAccent: g(ladder.ACCENT_FAMILY, '500', 'light'),
    darkAccent: g(ladder.ACCENT_FAMILY, '500', 'dark'),
  }
  check(JSON.stringify(expected) === JSON.stringify(preset.preview), `${preset.id} preview is not stale`)
}

// ---------------------------------------------------------------- 5. override payload contract

console.log('')
console.log('5. override payload shape')
// The payload must be the ramp helper's output and nothing else: that helper is the
// only producer of { light, dark } pairs, and a bare string anywhere in the payload
// throws inside the plugin callback, which aborts the whole web boot.
check(
  /overrideTokens\(PACKAGE,\s*tokensFor\(preset, customValues\(\)\)\)/.test(clientSrc),
  'the theme payload is exactly the pair-producing ramp output',
)
// The faces are not theme tokens: they are one stylesheet rule, so they must be
// plain family lists rather than { light, dark } pairs.
check(
  clientSrc.includes("'body{--dsw-font-family:'") && clientSrc.includes("';--ds-font-family-code:'"),
  'both faces are written as a single stylesheet rule',
)
const fontEntries = Object.entries(presetsDoc.fonts ?? {})
check(fontEntries.length > 0, 'presets.json ships font stacks', `${fontEntries.length} entries`)
for (const [name, value] of fontEntries) {
  const usable = typeof value === 'string'
    || (value !== null && typeof value === 'object'
      && typeof value.light === 'string' && typeof value.dark === 'string')
  check(usable, `fonts["${name}"] is a string or a { light, dark } pair`)
}

// ---------------------------------------------------------------- verdict

console.log('')
if (failures.length) {
  console.log(`FAILED (${failures.length})`)
  for (const f of failures) console.log('  ' + f)
  process.exit(1)
}
console.log(`all runtime checks pass — ${CUSTOM_CASES.length} custom-color cases, ${presetsDoc.presets.length} presets`)
