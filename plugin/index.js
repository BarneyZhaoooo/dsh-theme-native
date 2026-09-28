/**
 * Host half of the Codex-theme bundle.
 *
 * The plugin is presentation-only and lives entirely in the Client half: there
 * is no host state, no Config, and nothing model-facing. The empty apply() is
 * what makes the loader row valid — the Client module owns every effect.
 */
export function apply() {}
