import { isClient } from './utils.ts';

export interface BridgeTransport {
  send(data: string): void;
  subscribe(handler: (data: string) => void): () => void;
}

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

declare const document: {
  addEventListener(event: 'message', handler: MessageListener): void;
  removeEventListener(event: 'message', handler: MessageListener): void;
};

const NOOP = (): void => {};

// React Native WebView dispatches native→web messages on different targets per
// platform: iOS fires on `window`, Android fires on `document`. Listening on
// both keeps the transport platform-agnostic without needing runtime platform
// detection. In a normal browser/iframe only `window` receives `message`
// events, so the `document` listener is a harmless no-op there.
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
      document.addEventListener('message', listener);
      return () => {
        window.removeEventListener('message', listener);
        document.removeEventListener('message', listener);
      };
    },
  };
}

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
