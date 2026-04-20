declare const window: unknown;

/**
 * Returns `true` when running in a browser-like environment (where `window`
 * is defined), and `false` during server-side rendering or other non-DOM
 * runtimes such as Node.js.
 *
 * Uses a `typeof` check so that referencing an undeclared global does not
 * throw a `ReferenceError` on SSR.
 */
export function isClient(): boolean {
  return typeof window !== 'undefined';
}
