/**
 * Bump this bundle's identity so the browser is forced to re-download it.
 *
 * The Web host serves a plugin's client artifact under
 * `/plugins/??<package>/client.js&rev=<graph-hash>-<n>` with
 * `cache-control: public, max-age=31536000, immutable`, and that graph-level
 * rev does NOT change when the file's bytes change. Editing client.js in place
 * therefore leaves every already-loaded page running the old script.
 *
 * Renaming the package changes the URL, which is the only lever available to a
 * locally linked bundle. This is a development-phase workaround only: once the
 * bundle is published as a versioned npm package, a version bump changes the
 * URL by itself and this script is no longer needed.
 *
 * What it rewrites: plugin/package.json `name`, the row in
 * plugin/cordis.patch.yml (`id` + `name`), and — through emit-plugin.mjs — the
 * loader `id` inside plugin/client.js.
 *
 * Usage:
 *   node tools/release.mjs                 # codex -> codex-r1 -> codex-r2 ...
 *   node tools/release.mjs --name <name>   # explicit
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const pkgPath = path.join(root, 'plugin', 'package.json')
const patchPath = path.join(root, 'plugin', 'cordis.patch.yml')

const args = process.argv.slice(2)
const explicit = args.indexOf('--name') === -1 ? null : args[args.indexOf('--name') + 1]

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const previous = pkg.name

const next = explicit ?? (() => {
  const m = /^(.*?)(?:-r(\d+))?$/.exec(previous)
  const base = m[1]
  const n = Number(m[2] ?? 0) + 1
  return `${base}-r${n}`
})()

if (next === previous) {
  console.error(`refusing to "release" ${previous} onto itself`)
  process.exit(1)
}

// The patch row carries the same identity; the loader entry id must change with
// the package name or the two layers disagree about which row is being patched.
const rowId = next.replace(/^@[^/]+\//, '')
const patch = fs.readFileSync(patchPath, 'utf8')
const rewritten = patch
  .replace(/^(\s*- id:\s*).*$/m, `$1${rowId}`)
  .replace(/^(\s*name:\s*').*(')$/m, `$1${next}$2`)
if (rewritten === patch) {
  console.error('cordis.patch.yml: neither a `- id:` nor a quoted `name:` line matched — refusing to write')
  process.exit(1)
}

pkg.name = next
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
fs.writeFileSync(patchPath, rewritten)

// Regenerate client.js so its loader id matches the new package name, then
// verify the SHIPPED artifact. verify-runtime.mjs exits non-zero on any drift,
// so a broken bundle is never renamed-and-installed.
await import('./emit-plugin.mjs')
console.log('')
await import('./verify-runtime.mjs')
console.log('')
// A rename touches the package name, the patch row and the loader id. The
// manifest check is what proves all three moved together.
await import('./verify-manifest.mjs')

console.log('')
console.log(`previous: ${previous}`)
console.log(`next:     ${next}`)
console.log(`row id:   ${rowId}`)
console.log('')
console.log('Now, in order:')
console.log(`  1. plugin_manager action=install_bundle target=${path.join(root, 'plugin')}`)
console.log(`  2. plugin_manager action=remove_bundle target=${previous}`)
console.log('  3. confirm only the new id occupies its slots (cordis_inspect_query -> Slots)')
console.log('')
console.log('The localStorage preference key is version-independent by design, so the')
console.log("user's on/off choice survives the rename. Do not version that key.")
