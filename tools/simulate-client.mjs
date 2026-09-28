/**
 * Run the SHIPPED client half in Node with a fake React and a fake host context.
 *
 * tools/verify-runtime.mjs proves the payload SHAPE; this proves the plugin
 * actually survives `apply`. The failure it guards against is expensive to find
 * otherwise: a throw inside the plugin callback is caught by the cordis fiber,
 * never reaches the crash log's console capture, and the host reports only
 * "1 entry did not activate" while refusing to start the whole web app.
 *
 * Usage: node tools/simulate-client.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const source = fs.readFileSync(path.join(root, 'plugin', 'client.js'), 'utf8')

let failures = 0
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

const store = new Map()
const listeners = new Map()
let registration = null

function makeDocument() {
  const elements = new Map()
  const head = {
    children: [],
    appendChild(node) {
      head.children.push(node)
      if (node.id) elements.set(node.id, node)
      return node
    },
  }
  return {
    head,
    body: { hasAttribute: () => false, setAttribute: () => {}, removeAttribute: () => {}, style: {} },
    createElement(tag) {
      if (tag === 'canvas') return { getContext: () => null }
      return {
        id: '',
        dataset: {},
        textContent: '',
        remove() {
          const index = head.children.indexOf(this)
          if (index >= 0) head.children.splice(index, 1)
          if (this.id) elements.delete(this.id)
        },
      }
    },
    getElementById: (id) => elements.get(id) ?? null,
  }
}

const windowShim = {
  __ModuleLoader__: { load: (value) => { registration = value } },
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
  addEventListener: (type, handler) => {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type).add(handler)
  },
  removeEventListener: (type, handler) => listeners.get(type)?.delete(handler),
  dispatchEvent: (event) => { for (const handler of listeners.get(event.type) ?? []) handler(event) },
}
class FakeEvent {
  constructor(type) { this.type = type }
}
const context = {
  window: windowShim,
  localStorage: windowShim.localStorage,
  document: makeDocument(),
  Event: FakeEvent,
  console,
}
vm.createContext(context)
new vm.Script(source, { filename: 'plugin/client.js' }).runInContext(context)
if (registration === null) {
  console.log('FAILED — client.js never called window.__ModuleLoader__.load')
  process.exit(1)
}

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
}
const module = registration.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error('unexpected require: ' + specifier)
})

const payloads = []
let sectionComponent = null
const ctx = {
  theme: { overrideTokens: (id, tokens) => { payloads.push({ id, tokens }); return () => {} } },
  effect: (fn) => { fn() },
  slots: {
    inject: (name, factory) => {
      const registration = factory()
      if (registration && typeof registration.component === 'function') sectionComponent = registration.component
    },
    register: (spec, component) => ({ spec, component }),
  },
}

try {
  module.apply(ctx)
  check(true, 'apply() runs without throwing')
} catch (error) {
  check(false, 'apply() runs without throwing', error.message)
}

check(payloads.length === 1, 'apply pushes exactly one override layer', String(payloads.length))
const fontSheet = () => context.document.getElementById('codex-theme-fonts')

// The render path is not covered by apply(): a typo in the panel would only show up
// as a broken settings section in the live app. Run the component once.
check(sectionComponent !== null, 'the settings section registers a component')
if (sectionComponent !== null) {
  try {
    sectionComponent()
    check(true, 'the settings section renders without throwing')
  } catch (error) {
    check(false, 'the settings section renders without throwing', error.message)
  }
}

const inspect = (payload, label) => {
  const entries = Object.entries(payload.tokens)
  const bad = entries.filter(([, value]) => (
    value === null || typeof value !== 'object'
    || typeof value.light !== 'string' || typeof value.dark !== 'string'
  ))
  check(bad.length === 0, `${label}: every token is a { light, dark } pair`, `${entries.length} tokens`)
  if (bad.length) console.log('     offending:', bad.map(([key, value]) => key + '=' + JSON.stringify(value)).join(', '))
}

if (payloads.length > 0) inspect(payloads[0], 'default')
check(fontSheet() !== null, 'apply installs the font stylesheet')
check(
  (fontSheet()?.textContent ?? '').includes('--dsw-font-family')
    && (fontSheet()?.textContent ?? '').includes('--ds-font-family-code'),
  'the stylesheet declares both faces',
)

store.set('codex-theme:font', 'jetbrains')
for (const handler of listeners.get('codex-theme:changed') ?? []) handler(new FakeEvent('codex-theme:changed'))
// The whole point of the code-face stylesheet: a font change must NOT republish the
// theme, because that re-renders the application and made the page jump.
check(payloads.length === 1, 'a font change does not republish the theme', String(payloads.length))
check(
  (fontSheet()?.textContent ?? '').includes('JetBrainsMono'),
  'the code face follows the chosen family',
)

store.set('codex-theme:enabled', '0')
for (const handler of listeners.get('codex-theme:changed') ?? []) handler(new FakeEvent('codex-theme:changed'))
check(payloads.length === 1, 'disabling pushes no new layer')
check(fontSheet() === null, 'disabling removes the font stylesheet')

console.log('')
if (failures > 0) {
  console.log(`FAILED (${failures})`)
  process.exit(1)
}
console.log('client simulation passed')
