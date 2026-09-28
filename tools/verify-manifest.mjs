/**
 * Verify the bundle against the contract the Harness plugin manager reads.
 *
 * verify-runtime.mjs proves the SHIPPED client artifact behaves; this script
 * proves the package is installable at all. Both matter, and they fail
 * independently: a bundle can hold a correct client.js and still be rejected
 * because the patch, the icon, or the display metadata is malformed.
 *
 * The requirements checked here come from the plugin-development reference
 * shipped inside the DSH app ("Bundles and Host plugins"), not from community
 * convention:
 *
 *   - a package is a bundle only when `dsh.bundle.patch` names a patch file,
 *   - display text lives in `locale/<lang>.json` under `meta.title` /
 *     `meta.description`, and the icon is a top-level `icon` path relative to
 *     the manifest, SVG/PNG/JPEG/WebP, at most 256 KiB,
 *   - `exports` must expose `./package.json` and `./locale/*.json`, and
 *   - the Client half needs a `dsh.client` section.
 *
 * The row id in the patch, the loader id inside client.js, and the package
 * name are the same identity in three places. A rename that misses one of them
 * leaves two layers disagreeing about which row is being patched, so the three
 * are cross-checked here.
 *
 * Usage: node tools/verify-manifest.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const pluginDir = path.join(root, 'plugin')

const failures = []
const check = (ok, label, detail = '') => {
  if (!ok) failures.push(`${label}${detail ? ' — ' + detail : ''}`)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const exists = (file) => fs.existsSync(file)

// ---------------------------------------------------------------- manifest

const pkg = readJson(path.join(pluginDir, 'package.json'))
check(typeof pkg.name === 'string' && pkg.name.length > 0, 'package.json declares a name', pkg.name)
check(
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version ?? ''),
  'version is valid semver',
  pkg.version,
)
check(typeof pkg.description === 'string' && pkg.description.length > 0, 'description is present')
check(pkg.type === 'module', 'type is "module"')

// ---------------------------------------------------------------- bundle patch

const patchRel = pkg.dsh?.bundle?.patch
check(typeof patchRel === 'string' && patchRel.length > 0, 'dsh.bundle.patch is declared', patchRel)

const patchPath = typeof patchRel === 'string' ? path.join(pluginDir, patchRel) : null
check(Boolean(patchPath && exists(patchPath)), 'the declared patch file exists', patchRel)

let patchRows = []
if (patchPath && exists(patchPath)) {
  const patch = fs.readFileSync(patchPath, 'utf8')
  const rowId = /^\s*- id:\s*(\S+)\s*$/m.exec(patch)?.[1] ?? null
  const rowName = /^\s*name:\s*'([^']+)'\s*$/m.exec(patch)?.[1] ?? null
  patchRows = rowId ? [rowId] : []
  check(rowName === pkg.name, 'the patch row mounts this package', `${rowName ?? 'missing'} vs ${pkg.name}`)
  check(
    rowId !== null && pkg.name.replace(/^@[^/]+\//, '') === rowId,
    'the patch row id matches the package name',
    `${rowId ?? 'missing'} vs ${pkg.name.replace(/^@[^/]+\//, '')}`,
  )
}

// ---------------------------------------------------------------- icon

const iconRel = pkg.icon
check(typeof iconRel === 'string' && iconRel.length > 0, 'a top-level icon is declared', iconRel)
if (typeof iconRel === 'string' && iconRel.length > 0) {
  const iconPath = path.join(pluginDir, iconRel)
  const iconExt = path.extname(iconRel).toLowerCase()
  check(['.svg', '.png', '.jpg', '.jpeg', '.webp'].includes(iconExt), 'the icon is an accepted type', iconExt)
  check(!path.isAbsolute(iconRel), 'the icon path is relative')
  check(
    path.relative(pluginDir, iconPath).split(path.sep).every((part) => part !== '..'),
    'the icon does not escape the package directory',
  )
  if (exists(iconPath)) {
    const size = fs.statSync(iconPath).size
    check(size <= 256 * 1024, 'the icon is within the 256 KiB limit', `${size} bytes`)
    check(!fs.lstatSync(iconPath).isSymbolicLink(), 'the icon is not a symlink')
  } else {
    check(false, 'the icon file exists', iconRel)
  }
}

// ---------------------------------------------------------------- display metadata

for (const lang of ['en', 'zh']) {
  const file = path.join(pluginDir, 'locale', `${lang}.json`)
  if (!exists(file)) {
    check(false, `locale/${lang}.json exists`)
    continue
  }
  let meta = null
  try {
    meta = readJson(file).meta
  } catch (error) {
    check(false, `locale/${lang}.json parses`, error.message)
    continue
  }
  const ok = meta !== null && typeof meta === 'object'
    && typeof meta.title === 'string' && meta.title.length > 0
    && typeof meta.description === 'string' && meta.description.length > 0
  check(ok, `locale/${lang}.json carries meta.title and meta.description`)
}

// ---------------------------------------------------------------- exports and files

const exportsKeys = Object.keys(pkg.exports ?? {})
for (const key of ['.', './client', './package.json', './locale/*.json']) {
  check(exportsKeys.includes(key), `exports declares "${key}"`)
}

const files = pkg.files ?? []
for (const needed of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/*.json']) {
  check(files.includes(needed), `files includes "${needed}"`)
}

// ---------------------------------------------------------------- client section

const client = pkg.dsh?.client
check(client !== undefined, 'dsh.client is declared')
check(client?.platform === 'web', 'dsh.client.platform is "web"', client?.platform)
check(typeof client?.immediately === 'boolean', 'dsh.client.immediately is a boolean')
check(Array.isArray(client?.inject), 'dsh.client.inject is an array', Array.isArray(client?.inject) ? `${client.inject.length} entries` : '')

// ---------------------------------------------------------------- identity

const clientPath = path.join(pluginDir, 'client.js')
if (exists(clientPath)) {
  const clientSrc = fs.readFileSync(clientPath, 'utf8')
  const loaderId = /__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/.exec(clientSrc)?.[1] ?? null
  check(loaderId === pkg.name, 'client.js registers the loader id equal to the package name', `${loaderId ?? 'missing'} vs ${pkg.name}`)
  check(clientSrc.includes(`const PACKAGE = "${pkg.name}"`), 'client.js carries the package name for overrideTokens')
} else {
  check(false, 'client.js exists')
}

// ---------------------------------------------------------------- verdict

console.log('')
if (failures.length) {
  console.log(`FAILED (${failures.length})`)
  for (const failure of failures) console.log('  ' + failure)
  process.exit(1)
}
console.log(`manifest checks pass — ${pkg.name}@${pkg.version}, ${patchRows.length} row`)
