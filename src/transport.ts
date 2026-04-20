export interface BridgeTransport {
  send(data: string): void;
  subscribe(handler: (data: string) => void): () => void;
}

import { isClient } from './utils.ts';

// Minimal structural typing for the global `window` object. Declared locally so
// this package can be consumed in both DOM and non-DOM TypeScript projects
// without requiring `lib: ["dom"]`.
interface MessageLikeEvent {
  readonly data: unknown;
  readonly origin?: string;
}

type MessageListener = (event: MessageLikeEvent) => void;

declare const window: {
  readonly ReactNativeWebView?: { postMessage(data: string): void };
  addEventListener(event: 'message', handler: MessageListener): void;
  removeEventListener(event: 'message', handler: MessageListener): void;
};

const NOOP = (): void => {};

/**
 * Transport for web code running inside a React Native WebView.
 *
 * Security notes:
 * - This transport listens for `message` events on `window` and is intentionally
 *   permissive about origins, because React Native WebView's `postMessage` does
 *   not expose a meaningful `event.origin`.
 * - Cross-origin messages are filtered out by the `__bridge: 1` marker in the
 *   wire protocol, but if you need stricter isolation (e.g. the page embeds
 *   third-party iframes), implement a custom transport that validates
 *   `event.origin` and/or `event.source`.
 */
export function webViewTransport(): BridgeTransport {
  return {
    send(data) {
      if (!isClient()) return;
      window.ReactNativeWebView?.postMessage(data);
    },
    subscribe(handler) {
      if (!isClient()) return NOOP;
      const listener: MessageListener = (event) => {
        if (typeof event.data === 'string') {
          handler(event.data);
        }
      };
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    },
  };
}

/**
 * Transport for cross-iframe / window communication via `postMessage`.
 *
 * When `origin` is provided and not `'*'`, incoming messages whose `event.origin`
 * does not match are discarded. Outgoing messages use the same origin as the
 * `targetOrigin` argument to `postMessage`.
 */
export function iframeTransport(
  target: { postMessage(data: string, origin: string): void },
  origin: string = '*',
): BridgeTransport {
  return {
    send(data) {
      target.postMessage(data, origin);
    },
    subscribe(handler) {
      if (!isClient()) return NOOP;
      const listener: MessageListener = (event) => {
        if (origin !== '*' && event.origin !== origin) return;
        if (typeof event.data === 'string') {
          handler(event.data);
        }
      };
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    },
  };
}
