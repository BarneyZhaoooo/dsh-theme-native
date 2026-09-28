/**
 * Extract the DSH theme token palette (light + dark) from the installed
 * @deepseek-ai/dsh-client-ui-theme client bundle.
 *
 * The palette is not a data file: dsh-client-ui-theme ships its sheets as CSS
 * strings inside lib/client.js, each declaring `--dsw-*` custom properties on
 * `body` (light) and `body[data-ds-dark-theme]` (dark). This script rebuilds
 * the token -> { light, dark } table from that build artifact so no color value
 * is ever copied into a document by hand.
 *
 * Usage:
 *   ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
 *     tools/extract-palette.mjs [--out baseline.json]
 *
 * The Electron binary is used only because it is the one Node on this machine
 * whose fs can read inside app.asar.
 */
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_BUNDLE =
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'

const args = process.argv.slice(2)
const outFlag = args.indexOf('--out')
const outPath = outFlag === -1 ? null : args[outFlag + 1]
const bundlePath = args.find((a) => a.startsWith('/') && a.endsWith('.js')) ?? DEFAULT_BUNDLE

const source = fs.readFileSync(bundlePath, 'utf8')

/** Pull every `var <name>_css_default = "…"` literal out of the bundle. */
function extractCssLiterals(text) {
  const sheets = []
  const marker = /[A-Za-z0-9_$]+\s*=\s*"/g
  for (const match of text.matchAll(marker)) {
    const start = match.index + match[0].length
    let i = start
    let value = ''
    while (i < text.length) {
      const ch = text[i]
      if (ch === '\\') {
        value += text[i + 1]
        i += 2
        continue
      }
      if (ch === '"') break
      if (ch === '\n') break // not a single-line literal; bail out
      value += ch
      i += 1
    }
    if (value.includes('--dsw-')) sheets.push({ name: match[0].slice(0, -3).trim(), css: value })
  }
  return sheets
}

/** Parse `selector{decls}` pairs. Good enough for these flat sheets. */
function parseRules(css) {
  const rules = []
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    rules.push({ selector: m[1].trim(), body: m[2] })
  }
  return rules
}

const isDark = (selector) => /data-ds-dark-theme/.test(selector)

const tokens = new Map() // name -> { light, dark, sheets }
const perSheet = []

for (const sheet of extractCssLiterals(source)) {
  let count = 0
  for (const rule of parseRules(sheet.css)) {
    // Only palette-bearing selectors: body / html[data-platform] wrappers.
    if (!/^(body|html\[data-platform[^\]]*\]\s*body)/.test(rule.selector)) continue
    const dark = isDark(rule.selector)
    for (const m of rule.body.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*([^;]+)/g)) {
      const name = m[1]
      const value = m[2].trim()
      const entry = tokens.get(name) ?? { light: null, dark: null, sheets: new Set() }
      // Later sheets win, matching the bundle's import order.
      entry[dark ? 'dark' : 'light'] = value
      entry.sheets.add(sheet.name)
      tokens.set(name, entry)
      count += 1
    }
  }
  if (count) perSheet.push({ sheet: sheet.name, declarations: count })
}

const out = {
  source: bundlePath,
  extractedAt: new Date().toISOString(),
  sheets: perSheet,
  total: tokens.size,
  paired: [...tokens.values()].filter((t) => t.light && t.dark).length,
  lightOnly: [...tokens.entries()].filter(([, t]) => t.light && !t.dark).map(([n]) => n),
  darkOnly: [...tokens.entries()].filter(([, t]) => t.dark && !t.light).map(([n]) => n),
  tokens: Object.fromEntries(
    [...tokens.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, t]) => [name, { light: t.light, dark: t.dark, sheets: [...t.sheets] }]),
  ),
}

if (outPath) {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
  fs.writeFileSync(path.resolve(outPath), JSON.stringify(out, null, 2) + '\n')
  console.log(`wrote ${outPath}`)
}

console.log(`sheets with palette: ${perSheet.length}`)
console.log(`tokens: ${out.total}  paired(light+dark): ${out.paired}`)
if (out.lightOnly.length) console.log(`light-only (${out.lightOnly.length}): ${out.lightOnly.join(', ')}`)
if (out.darkOnly.length) console.log(`dark-only (${out.darkOnly.length}): ${out.darkOnly.join(', ')}`)
