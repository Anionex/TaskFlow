/**
 * Detects whether the app is running inside the Tauri desktop shell
 * (as opposed to the plain web build).
 *
 * In Tauri v2 the runtime injects `window.__TAURI_INTERNALS__`; some setups
 * also expose `window.__TAURI__`. We check both so detection is robust.
 */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}
